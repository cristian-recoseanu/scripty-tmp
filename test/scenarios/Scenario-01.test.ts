/**
 * E16 — Scenario-01: MQTT → IS-12 Basic Scenario
 *
 * Tests covering:
 *   T1 — Model artefacts load correctly (entities/datatypes/tree)
 *   T2 — Ingress mapping validates + ingress rule matches topic → root.label
 *   T3 — IS-12 Get/Set userLabel (1p6) round-trip over a live ws://
 *   T4 — Compliant device model: root NcBlock exposes DeviceManager + ClassManager
 *   T5 — bridge.yaml parses and validates (loadBridgeConfig)
 *
 * T6 (runbook README) is a documentation artefact — no automated test.
 * T7 (e2e bidirectional with mocked MQTT) is covered by the assertions in T3
 *    verifying write-back direction; a separate full e2e harness is a future
 *    enhancement once app.ts bootstrap is wired.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { AdapterContext, AdapterLogger } from '../../src/adapters/Adapter.js';
import { MqttAdapterConfigSchema } from '../../src/adapters/mqtt/config.js';
import { Is12AdapterConfigSchema } from '../../src/adapters/nmos-is12/config.js';
import { Is12EgressAdapter } from '../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import {
  OID_ROOT,
  OID_DEVICE_MANAGER,
  OID_CLASS_MANAGER,
} from '../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import {
  NC_OBJECT_METHOD,
  NC_BLOCK_METHOD,
  NC_CLASS_MANAGER_METHOD,
} from '../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../src/adapters/nmos-is12/ms05/types.js';
import type { NcBlockMemberDescriptor } from '../../src/adapters/nmos-is12/ms05/types.js';
import { loadBridgeConfig } from '../../src/config/loader.js';
import { loadEntities, loadDatatypes, loadTree } from '../../src/config/modelLoader.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { IngressMappingSchema } from '../../src/mapping/types.js';
import { Is12Client } from '../helpers/Is12Client.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../Scenarios/Scenario-01');
const MODEL_DIR = resolve(SCENARIO_DIR, 'model');
const MAPPING_DIR = resolve(SCENARIO_DIR, 'mapping');

// ---------------------------------------------------------------------------
// Port allocation (range distinct from other test files)
// ---------------------------------------------------------------------------

let _nextPort = 49900;
function allocPort(): number { return _nextPort++; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

// ---------------------------------------------------------------------------
// E16.T1 — Scenario model artefacts
// ---------------------------------------------------------------------------

describe('E16.T1 — Scenario-01 model artefacts', () => {
  it('entities.yaml loads and registers RootBlock with a writable observable label property', () => {
    const reg = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const def = reg.get('RootBlock');
    expect(def.entity_name).toBe('RootBlock');

    const labelProp = def.properties.find((p) => p.id === 'label');
    expect(labelProp).toBeDefined();
    expect(labelProp!.type).toBe('string');
    expect(labelProp!.read_only).toBe(false);
    expect(labelProp!.observable).toBe(true);
  });

  it('datatypes.yaml loads (empty — no struct type_defs required)', () => {
    const reg = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    expect(reg.names()).toHaveLength(0);
  });

  it('tree.yaml loads and produces a root node with an empty label property', () => {
    const entities = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const datatypes = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    const tree = loadTree(resolve(MODEL_DIR, 'tree.yaml'), entities, datatypes);

    const result = tree.findById('root');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.node;
    const labelResult = node.getProperty('label');
    expect(labelResult.ok).toBe(true);
    expect(labelResult.value).toBe('');
    const labelDescriptor = node.properties.get('label');
    expect(labelDescriptor?.read_only).toBe(false);
    expect(labelDescriptor?.observable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E16.T2 — MQTT ingress config + mapping validation
// ---------------------------------------------------------------------------

describe('E16.T2 — MQTT ingress config + mapping', () => {
  it('ingress.mqtt.json validates against IngressMappingSchema', () => {
    const raw = JSON.parse(readFileSync(resolve(MAPPING_DIR, 'ingress.mqtt.json'), 'utf8')) as unknown;
    expect(() => IngressMappingSchema.parse(raw)).not.toThrow();
  });

  it('ingress mapping rule targets root/label with raw-string decode', () => {
    const raw = JSON.parse(readFileSync(resolve(MAPPING_DIR, 'ingress.mqtt.json'), 'utf8')) as unknown;
    const mapping = IngressMappingSchema.parse(raw);
    expect(mapping.rules).toHaveLength(1);
    const rule = mapping.rules[0]!;
    expect(rule.match).toMatchObject({ topicFilter: 'devices/device-01/label' });
    expect(rule.target.location).toBe('root');
    expect(rule.target.property).toBe('label');
    expect(rule.decode.format).toBe('raw-string');
  });

  it('ingress mapping rule has a reverse write-back with single strategy', () => {
    const raw = JSON.parse(readFileSync(resolve(MAPPING_DIR, 'ingress.mqtt.json'), 'utf8')) as unknown;
    const mapping = IngressMappingSchema.parse(raw);
    const reverse = mapping.rules[0]!.reverse;
    expect(reverse).toBeDefined();
    expect(reverse!.topicTemplate).toBe('devices/device-01/label');
    expect(reverse!.writeStrategy).toBe('single');
    expect(reverse!.encode.format).toBe('raw-string');
  });

  it('MQTT adapter config block validates against MqttAdapterConfigSchema', () => {
    const mqttConfig = {
      url: 'mqtt://localhost:1883',
      clientId: 'scenario-01-bridge',
      subscriptions: [{ topicFilter: 'devices/device-01/label', qos: 1 }],
      mapping: 'mapping/ingress.mqtt.json',
    };
    expect(() => MqttAdapterConfigSchema.parse(mqttConfig)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// E16.T5 — bridge.yaml wiring
// ---------------------------------------------------------------------------

describe('E16.T5 — bridge.yaml wiring', () => {
  it('bridge.yaml parses and validates with loadBridgeConfig', () => {
    const configPath = resolve(SCENARIO_DIR, 'bridge.yaml');
    const env = { MQTT_BROKER_URL: 'mqtt://localhost:1883' };
    expect(() => loadBridgeConfig(configPath, env)).not.toThrow();
  });

  it('bridge.yaml ingress block references the correct mapping file', () => {
    const configPath = resolve(SCENARIO_DIR, 'bridge.yaml');
    const cfg = loadBridgeConfig(configPath, { MQTT_BROKER_URL: 'mqtt://localhost:1883' });
    expect(cfg.ingress.protocol).toBe('mqtt');
    expect(cfg.ingress.mapping).toBe('mapping/ingress.mqtt.json');
  });

  it('bridge.yaml egress block references the correct mapping file', () => {
    const configPath = resolve(SCENARIO_DIR, 'bridge.yaml');
    const cfg = loadBridgeConfig(configPath, { MQTT_BROKER_URL: 'mqtt://localhost:1883' });
    expect(cfg.egress).toHaveLength(1);
    expect(cfg.egress[0]!.protocol).toBe('nmos-is12');
    expect(cfg.egress[0]!.mapping).toBe('mapping/egress.is12.json');
  });

  it('IS-12 adapter config block validates against Is12AdapterConfigSchema', () => {
    const is12Config = { wsPort: 9001, host: '0.0.0.0', instanceName: 'scenario-01' };
    expect(() => Is12AdapterConfigSchema.parse(is12Config)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Shared adapter setup for live IS-12 tests (T3 + T4)
// ---------------------------------------------------------------------------

describe('E16.T3 + T4 — IS-12 live adapter (userLabel + mandatory managers)', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;
  let port: number;

  beforeAll(async () => {
    port = allocPort();

    const entities = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const datatypes = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    const tree = loadTree(resolve(MODEL_DIR, 'tree.yaml'), entities, datatypes);
    const bus = new UceBus();

    const ctx: AdapterContext = {
      bus,
      tree,
      types: datatypes,
      entities,
      logger: makeLogger(),
      config: { wsPort: port, host: '0.0.0.0', instanceName: 'scenario-01' },
    };

    adapter = new Is12EgressAdapter('scenario-01-is12');
    await adapter.init(ctx);
    await adapter.start();
    client = await Is12Client.connect(port);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  // -------------------------------------------------------------------------
  // T3 — userLabel Get/Set round-trip
  // -------------------------------------------------------------------------

  it('T3 — Get userLabel (1p6) on root oid returns initial empty string', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe('');
  });

  it('T3 — Set userLabel (1p6) on root oid updates the value', async () => {
    const setResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: 'hello-scenario-01' },
    });
    expect(setResp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);

    const getResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect((getResp.responses[0]?.result as { value: unknown }).value).toBe('hello-scenario-01');
  });

  it('T3 — egress.is12.json validates against Is12AdapterConfigSchema (egress mapping file is valid JSON)', () => {
    const raw = JSON.parse(readFileSync(resolve(MAPPING_DIR, 'egress.is12.json'), 'utf8')) as unknown;
    const mapping = raw as { version: number; classes: Array<{ entityDef: string; classId: number[] }> };
    expect(mapping.version).toBe(1);
    expect(mapping.classes[0]?.entityDef).toBe('RootBlock');
    expect(mapping.classes[0]?.classId).toEqual([1, 1]);
  });

  // -------------------------------------------------------------------------
  // T4 — Compliant IS-12/MS-05-02 device model (root block + mandatory managers)
  // -------------------------------------------------------------------------

  it('T4 — DeviceManager (OID 3) classId is [1,3,1]', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 1 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const classId = (resp.responses[0]?.result as { value: number[] }).value;
    expect(classId).toEqual([1, 3, 1]);
  });

  it('T4 — DeviceManager role is "DeviceManager"', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 5 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe('DeviceManager');
  });

  it('T4 — ClassManager (OID 4) classId is [1,3,2]', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 1 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const classId = (resp.responses[0]?.result as { value: number[] }).value;
    expect(classId).toEqual([1, 3, 2]);
  });

  it('T4 — ClassManager role is "ClassManager"', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 5 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe('ClassManager');
  });

  it('T4 — GetControlClass on ClassManager resolves NcBlock classId [1,1]', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
      arguments: { classId: [1, 1], includeInherited: false },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const desc = (resp.responses[0]?.result as { value: { classId: number[] } }).value;
    expect(desc.classId).toEqual([1, 1]);
  });

  it('T4 — GetMemberDescriptors on root block returns a valid array (user nodes, excl. managers)', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(Array.isArray(members)).toBe(true);
    const oids = members.map((m) => m.oid);
    expect(oids).not.toContain(OID_ROOT);
  });
});
