/**
 * E22.T6 — Scenario-05 end-to-end: MQTT ingress ↔ MQTT egress bidirectional topic relay.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { MqttEgressAdapter } from '../../src/adapters/mqtt/MqttEgressAdapter.js';
import { MqttIngressAdapter } from '../../src/adapters/mqtt/MqttIngressAdapter.js';
import { loadBridgeConfig } from '../../src/config/loader.js';
import { loadEntities, loadDatatypes, loadTree } from '../../src/config/modelLoader.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { UceEngine } from '../../src/engine/UceEngine.js';
import { loadIngressMapping } from '../../src/mapping/loadMapping.js';

import type { AdapterContext, AdapterLogger } from '../../src/adapters/Adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../Scenarios/Scenario-05');

const SOURCE_BROKER = 'mqtt://source-broker:1883';
const DEST_BROKER = 'mqtt://dest-broker:1884';

type FakeMqttClient = {
  published: { topic: string; payload: string; opts?: { retain?: boolean } }[];
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
    publishAsync: vi.fn().mockImplementation((topic: string, payload: string, opts?: { retain?: boolean }) => {
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

const mqttClients = new Map<string, FakeMqttClient>();

vi.mock('mqtt', () => ({
  connectAsync: vi.fn().mockImplementation((url: string) => {
    let client = mqttClients.get(url);
    if (client === undefined) {
      client = makeFakeMqttClient();
      mqttClients.set(url, client);
    }
    return Promise.resolve(client);
  }),
}));

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

describe('E22.T6 — Scenario-05 e2e MQTT↔MQTT bidirectional relay', () => {
  let ingressAdapter: MqttIngressAdapter;
  let egressAdapter: MqttEgressAdapter;
  let engine: UceEngine;
  let sourceClient: FakeMqttClient;
  let destClient: FakeMqttClient;

  beforeAll(async () => {
    mqttClients.clear();
    sourceClient = makeFakeMqttClient();
    destClient = makeFakeMqttClient();
    mqttClients.set(SOURCE_BROKER, sourceClient);
    mqttClients.set(DEST_BROKER, destClient);

    const entities = loadEntities(resolve(SCENARIO_DIR, 'model/entities.yaml'));
    const types = loadDatatypes(resolve(SCENARIO_DIR, 'model/datatypes.yaml'));
    const tree = loadTree(resolve(SCENARIO_DIR, 'model/tree.yaml'), entities, types);

    const bus = new UceBus();
    engine = new UceEngine({ tree, bus });
    engine.start();

    ingressAdapter = new MqttIngressAdapter('mqtt-ingress');
    egressAdapter = new MqttEgressAdapter('mqtt-egress');

    const baseCtx = {
      bus, tree, types, entities, logger: makeLogger(),
    } satisfies Omit<AdapterContext, 'config'>;

    await ingressAdapter.init({
      ...baseCtx,
      config: {
        url: SOURCE_BROKER,
        mapping: resolve(SCENARIO_DIR, 'mapping/ingress.mqtt.yaml'),
        subscriptions: [{ topicFilter: 'plant/source/value', qos: 1 }],
      },
    });
    await egressAdapter.init({
      ...baseCtx,
      config: {
        url: DEST_BROKER,
        mapping: resolve(SCENARIO_DIR, 'mapping/egress.mqtt.yaml'),
        subscriptions: [{ topicFilter: 'plant/dest/value/set', qos: 1 }],
        publish: { qos: 1, retain: true },
      },
    });
    await ingressAdapter.start();
    await egressAdapter.start();
    destClient.published.length = 0;
  }, 30_000);

  afterAll(async () => {
    await ingressAdapter?.stop();
    await egressAdapter?.stop();
    engine?.stop();
  });

  it('loads committed Scenario-05 artefacts', () => {
    const cfg = loadBridgeConfig(resolve(SCENARIO_DIR, 'bridge.yaml'), {
      MQTT_SOURCE_BROKER_URL: SOURCE_BROKER,
      MQTT_DEST_BROKER_URL: DEST_BROKER,
    });
    expect(cfg.ingress.protocol).toBe('mqtt');
    expect(cfg.egress[0]?.protocol).toBe('mqtt');
    expect(cfg.egress[0]?.config).toMatchObject({
      subscriptions: [{ topicFilter: 'plant/dest/value/set', qos: 1 }],
    });
    expect(loadIngressMapping(resolve(SCENARIO_DIR, 'mapping/ingress.mqtt.yaml')).rules[0]?.reverse).toBeDefined();
  });

  it('uses independent broker connections for ingress and egress', async () => {
    const { connectAsync } = await import('mqtt');
    expect(connectAsync).toHaveBeenCalledWith(SOURCE_BROKER, expect.any(Object));
    expect(connectAsync).toHaveBeenCalledWith(DEST_BROKER, expect.any(Object));
  });

  it('relays source topic publish to destination topic via UCE', async () => {
    sourceClient._emit('message', 'plant/source/value', Buffer.from('relay-payload'));

    await new Promise((r) => setTimeout(r, 200));

    const uce = engine.tree.findById('root');
    expect(uce.ok).toBe(true);
    if (uce.ok) {
      const prop = uce.node.getProperty('value');
      expect(prop.ok).toBe(true);
      if (prop.ok) expect(prop.value).toBe('relay-payload');
    }

    const destPub = destClient.published.find((p) => p.topic === 'plant/dest/value');
    expect(destPub?.payload).toBe('relay-payload');
    expect(destPub?.opts?.retain).toBe(true);
    expect(sourceClient.published).toHaveLength(0);
  });

  it('relays destination set-topic publish to source topic via UCE', async () => {
    destClient.published.length = 0;
    sourceClient.published.length = 0;

    destClient._emit('message', 'plant/dest/value/set', Buffer.from('from-dest'));

    await new Promise((r) => setTimeout(r, 300));

    const uce = engine.tree.findById('root');
    expect(uce.ok).toBe(true);
    if (uce.ok) {
      const prop = uce.node.getProperty('value');
      expect(prop.ok).toBe(true);
      if (prop.ok) expect(prop.value).toBe('from-dest');
    }

    const sourcePub = sourceClient.published.find((p) => p.topic === 'plant/source/value');
    expect(sourcePub?.payload).toBe('from-dest');

    const destState = destClient.published.find((p) => p.topic === 'plant/dest/value');
    expect(destState?.payload).toBe('from-dest');
    expect(destState?.opts?.retain).toBe(true);
  });
});
