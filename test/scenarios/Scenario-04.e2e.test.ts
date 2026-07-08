/**
 * E21.T14 — Scenario-04 end-to-end: IS-12 ingress (client) ↔ MQTT egress bidirectional userLabel sync.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { stringify } from 'yaml';

import { MqttEgressAdapter } from '../../src/adapters/mqtt/MqttEgressAdapter.js';
import { Is12EgressAdapter } from '../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { Is12IngressAdapter } from '../../src/adapters/nmos-is12/Is12IngressAdapter.js';
import { OID_ROOT } from '../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_OBJECT_METHOD } from '../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../src/adapters/nmos-is12/ms05/types.js';
import { loadBridgeConfig } from '../../src/config/loader.js';
import { loadEntities, loadDatatypes, loadTree } from '../../src/config/modelLoader.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { UceEngine } from '../../src/engine/UceEngine.js';
import { loadEgressMapping, loadIngressMapping } from '../../src/mapping/loadMapping.js';
import { getFreePort } from '../helpers/getFreePort.js';
import { Is12Client } from '../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../src/adapters/Adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../Scenarios/Scenario-04');

// ---------------------------------------------------------------------------
// Mock MQTT
// ---------------------------------------------------------------------------

type FakeMqttClient = {
  published: { topic: string; payload: string; opts?: { qos?: number; retain?: boolean } }[];
  on: ReturnType<typeof vi.fn>;
  subscribeAsync: ReturnType<typeof vi.fn>;
  publishAsync: ReturnType<typeof vi.fn>;
  endAsync: ReturnType<typeof vi.fn>;
  _emit: (event: string, ...args: unknown[]) => void;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
};

function makeFakeMqttClient(): FakeMqttClient {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const published: FakeMqttClient['published'] = [];
  const client: FakeMqttClient = {
    published,
    subscribeAsync: vi.fn().mockResolvedValue(undefined),
    publishAsync: vi.fn().mockImplementation((topic: string, payload: string, opts?: { qos?: number; retain?: boolean }) => {
      published.push({ topic, payload: payload.toString(), opts });
      return Promise.resolve();
    }),
    endAsync: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return client;
    }),
    _emit(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
    _handlers: handlers,
  };
  return client;
}

let fakeMqtt: FakeMqttClient = makeFakeMqttClient();
vi.mock('mqtt', () => ({
  connectAsync: vi.fn().mockImplementation(() => Promise.resolve(fakeMqtt)),
}));

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

// ---------------------------------------------------------------------------
// Upstream IS-12 device fixture (remote NCP server)
// ---------------------------------------------------------------------------

function writeUpstreamDeviceFiles(dir: string): void {
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, 'model'), { recursive: true });
  mkdirSync(resolve(dir, 'mapping'), { recursive: true });

  writeFileSync(resolve(dir, 'model/entities.yaml'), stringify({
    entities: [{
      entity_name: 'Block',
      properties: [{ id: 'userLabel', type: 'string', read_only: false, observable: true }],
      methods: [],
    }],
  }));
  writeFileSync(resolve(dir, 'model/datatypes.yaml'), 'datatypes: []\n');
  writeFileSync(resolve(dir, 'model/tree.yaml'), stringify({
    location: 'root',
    entity_def: 'Block',
    properties: [{ id: 'userLabel', value: 'device-initial' }],
    children: [],
  }));
  writeFileSync(resolve(dir, 'mapping/egress.is12.yaml'), stringify({
    version: 1,
    classes: [{
      entityDef: 'Block',
      classId: [1, 1],
      properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
      methods: [],
    }],
  }));
}

// ---------------------------------------------------------------------------
// E21.T14 — Scenario-04 e2e
// ---------------------------------------------------------------------------

describe('E21.T14 — Scenario-04 e2e bidirectional userLabel sync', () => {
  let upstreamPort: number;
  let upstreamAdapter: Is12EgressAdapter;
  let upstreamClient: Is12Client;
  let ingressAdapter: Is12IngressAdapter;
  let egressAdapter: MqttEgressAdapter;
  let engine: UceEngine;
  let bus: UceBus;

  beforeAll(async () => {
    fakeMqtt = makeFakeMqttClient();
    upstreamPort = await getFreePort();

    const upstreamDir = resolve(SCENARIO_DIR, '.upstream-fixture');
    writeUpstreamDeviceFiles(upstreamDir);

    const upstreamEntities = loadEntities(resolve(upstreamDir, 'model/entities.yaml'));
    const upstreamTypes = loadDatatypes(resolve(upstreamDir, 'model/datatypes.yaml'));
    const upstreamTree = loadTree(resolve(upstreamDir, 'model/tree.yaml'), upstreamEntities, upstreamTypes);
    const upstreamMapping = resolve(upstreamDir, 'mapping/egress.is12.yaml');

    const upstreamBus = new UceBus();
    const upstreamEngine = new UceEngine({ tree: upstreamTree, bus: upstreamBus });
    upstreamEngine.start();

    upstreamAdapter = new Is12EgressAdapter('upstream-device');
    const upstreamCtx: AdapterContext = {
      bus: upstreamBus,
      tree: upstreamTree,
      types: upstreamTypes,
      entities: upstreamEntities,
      logger: makeLogger(),
      config: { wsPort: upstreamPort, mapping: upstreamMapping },
    };
    await upstreamAdapter.init(upstreamCtx);
    await upstreamAdapter.start();

    upstreamClient = await Is12Client.connect(upstreamPort);
    await upstreamClient.subscribe([OID_ROOT]);

    const entities = loadEntities(resolve(SCENARIO_DIR, 'model/entities.yaml'));
    const types = loadDatatypes(resolve(SCENARIO_DIR, 'model/datatypes.yaml'));
    const tree = loadTree(resolve(SCENARIO_DIR, 'model/tree.yaml'), entities, types);

    bus = new UceBus();
    engine = new UceEngine({ tree, bus });
    engine.start();

    const wsUrl = `ws://127.0.0.1:${upstreamPort}`;
    ingressAdapter = new Is12IngressAdapter('is12-ingress');
    egressAdapter = new MqttEgressAdapter('mqtt-egress');

    const ingressCtx: AdapterContext = {
      bus, tree, types, entities, logger: makeLogger(),
      config: {
        wsUrl,
        rootOid: OID_ROOT,
        mapping: resolve(SCENARIO_DIR, 'mapping/ingress.is12.yaml'),
        reconnectPeriodMs: 500,
        reconnectMaxMs: 2000,
      },
    };
    const egressCtx: AdapterContext = {
      bus, tree, types, entities, logger: makeLogger(),
      config: {
        url: 'mqtt://localhost:1883',
        mapping: resolve(SCENARIO_DIR, 'mapping/egress.mqtt.yaml'),
        subscriptions: [{ topicFilter: 'bridge/root/userLabel/set', qos: 1 }],
        publish: { qos: 1, retain: true },
      },
    };

    await ingressAdapter.init(ingressCtx);
    await egressAdapter.init(egressCtx);
    await ingressAdapter.start();
    await egressAdapter.start();

    // Allow initial sync
    await new Promise((r) => setTimeout(r, 200));
    fakeMqtt.published.length = 0;
  }, 30_000);

  afterAll(async () => {
    await ingressAdapter?.stop();
    await egressAdapter?.stop();
    await upstreamClient?.close();
    await upstreamAdapter?.stop();
    engine?.stop();
  });

  it('loads committed Scenario-04 artefacts', () => {
    expect(loadBridgeConfig(resolve(SCENARIO_DIR, 'bridge.yaml')).ingress.protocol).toBe('nmos-is12');
    expect(loadEgressMapping(resolve(SCENARIO_DIR, 'mapping/ingress.is12.yaml')).classes[0]?.entityDef).toBe('Block');
    expect(loadIngressMapping(resolve(SCENARIO_DIR, 'mapping/egress.mqtt.yaml')).rules).toHaveLength(1);
  });

  it('IS-12 device userLabel change → retained MQTT publish', async () => {
    await upstreamClient.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: 'from-device' },
    });

    await new Promise((r) => setTimeout(r, 300));

    const retained = fakeMqtt.published.find((p) => p.topic === 'bridge/root/userLabel');
    expect(retained).toBeDefined();
    expect(retained!.payload).toBe('from-device');
    expect(retained!.opts?.retain).toBe(true);

    const uce = engine.tree.findById('root');
    expect(uce.ok).toBe(true);
    if (!uce.ok) return;
    const prop = uce.node.getProperty('userLabel');
    expect(prop.ok).toBe(true);
    if (prop.ok) expect(prop.value).toBe('from-device');
  });

  it('MQTT set-topic publish → IS-12 device userLabel updated', async () => {
    fakeMqtt._emit('message', 'bridge/root/userLabel/set', Buffer.from('from-mqtt'));

    await new Promise((r) => setTimeout(r, 500));

    const resp = await upstreamClient.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: string }).value).toBe('from-mqtt');
  });
});
