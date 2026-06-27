/**
 * E19 — Scenario-03: dual monitors, per-domain-status MQTT, BCP-008-02 sender.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Is12EgressAdapter } from '../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { OID_ROOT } from '../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import {
  NC_OBJECT_METHOD,
  NC_BLOCK_METHOD,
  NC_SENDER_MONITOR_METHOD,
} from '../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../src/adapters/nmos-is12/ms05/types.js';
import { loadBridgeConfig } from '../../src/config/loader.js';
import { loadEntities, loadDatatypes, loadTree } from '../../src/config/modelLoader.js';
import { makeSetPropertyOp } from '../../src/engine/bus/operations.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { UceEngine } from '../../src/engine/UceEngine.js';
import { EgressMappingSchema, IngressMappingSchema } from '../../src/mapping/types.js';
import { Is12Client } from '../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../src/adapters/Adapter.js';
import type { NcBlockMemberDescriptor } from '../../src/adapters/nmos-is12/ms05/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../Scenarios/Scenario-03');
const MODEL_DIR = resolve(SCENARIO_DIR, 'model');
const MAPPING_DIR = resolve(SCENARIO_DIR, 'mapping');

let _nextPort = 49600;
function allocPort(): number { return _nextPort++; }

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    }).once('error', reject);
  });
}

describe('E19.T4 — Scenario-03 model', () => {
  it('loads entities for both monitor types and block containers', () => {
    const reg = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    expect(reg.has('ReceiverMonitor')).toBe(true);
    expect(reg.has('SenderMonitor')).toBe(true);
    expect(reg.has('SenderMonitorsBlock')).toBe(true);
  });

  it('tree has receiver-monitors and sender-monitors branches', () => {
    const entities = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const datatypes = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    const tree = loadTree(resolve(MODEL_DIR, 'tree.yaml'), entities, datatypes);
    expect(tree.findById('root/receiver-monitors/rx-monitor-01').ok).toBe(true);
    expect(tree.findById('root/sender-monitors/tx-monitor-01').ok).toBe(true);
  });
});

describe('E19.T5 — Scenario-03 ingress mapping', () => {
  it('has 10 rules for domain statuses + sync source ids', () => {
    const raw = JSON.parse(readFileSync(resolve(MAPPING_DIR, 'ingress.mqtt.json'), 'utf8')) as unknown;
    const mapping = IngressMappingSchema.parse(raw);
    expect(mapping.rules).toHaveLength(10);
  });
});

describe('E19.T6+T7 — Scenario-03 egress + bridge.yaml', () => {
  it('egress maps SenderMonitor to [1,2,2,2]', () => {
    const raw = JSON.parse(readFileSync(resolve(MAPPING_DIR, 'egress.is12.json'), 'utf8')) as unknown;
    const mapping = EgressMappingSchema.parse(raw);
    const cls = mapping.classes.find((c) => c.entityDef === 'SenderMonitor');
    expect(cls!.classId).toEqual([1, 2, 2, 2]);
    expect(mapping.instances).toHaveLength(2);
  });

  it('bridge.yaml parses; IS-04 registration disabled', () => {
    const cfg = loadBridgeConfig(resolve(SCENARIO_DIR, 'bridge.yaml'), { MQTT_BROKER_URL: 'mqtt://localhost:1883' });
    const is12 = cfg.egress[0]!.config as { is04?: { registration?: { enabled?: boolean } } };
    expect(is12.is04?.registration?.enabled).toBe(false);
  });
});

describe('E19.T10 — Scenario-03 live IS-12 + IS-04', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;
  let port: number;
  let bus: UceBus;
  let rxOid: number;
  let txOid: number;

  beforeAll(async () => {
    port = allocPort();
    const entities = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const datatypes = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    const tree = loadTree(resolve(MODEL_DIR, 'tree.yaml'), entities, datatypes);
    bus = new UceBus();
    const engine = new UceEngine({ tree, bus });
    engine.start();

    const ctx: AdapterContext = {
      bus, tree, types: datatypes, entities,
      logger: makeLogger(),
      config: {
        wsPort: port,
        host: '127.0.0.1',
        mapping: resolve(MAPPING_DIR, 'egress.is12.json'),
        is04: {
          nodeApi: { enabled: true, httpPort: port, host: '127.0.0.1' },
          registration: { enabled: false },
        },
      },
    };

    adapter = new Is12EgressAdapter('is12-scenario-03');
    await adapter.init(ctx);
    await adapter.start();
    client = await Is12Client.connect(port);

    const find = async (classId: number[]) => {
      const resp = await client.command({
        oid: OID_ROOT,
        methodId: NC_BLOCK_METHOD.FindMembersByClassId,
        arguments: { classId, includeDerived: true, recurse: true },
      });
      return (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value[0]!.oid;
    };
    rxOid = await find([1, 2, 2, 1]);
    txOid = await find([1, 2, 2, 2]);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('IS-12 touchpoints reference external sender/receiver UUIDs', async () => {
    const rxResp = await client.command({
      oid: rxOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 7 } },
    });
    const rxTps = (rxResp.responses[0]?.result as {
      value: { contextNamespace: string; resource: { resourceType: string; id: string } }[];
    }).value;
    expect(rxTps).toHaveLength(1);
    expect(rxTps[0]!.contextNamespace).toBe('x-nmos');
    expect(rxTps[0]!.resource.resourceType).toBe('receiver');
    expect(rxTps[0]!.resource.id).toBe('6b73a87b-1234-0000-0000-000000000001');

    const txResp = await client.command({
      oid: txOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 7 } },
    });
    const txTps = (txResp.responses[0]?.result as {
      value: { contextNamespace: string; resource: { resourceType: string; id: string } }[];
    }).value;
    expect(txTps).toHaveLength(1);
    expect(txTps[0]!.resource.resourceType).toBe('sender');
    expect(txTps[0]!.resource.id).toBe('9bfe1101-5513-45fa-ae3b-7e668e317bd5');
  });

  it('local IS-04 Node API does not host sender/receiver resources', async () => {
    const sendersList = await httpGet(port, '/x-nmos/node/v1.3/senders/');
    expect(sendersList.status).toBe(200);
    expect(JSON.parse(sendersList.body)).toEqual([]);

    const receiversList = await httpGet(port, '/x-nmos/node/v1.3/receivers/');
    expect(receiversList.status).toBe(200);
    expect(JSON.parse(receiversList.body)).toEqual([]);

    const senderRes = await httpGet(port, '/x-nmos/node/v1.3/senders/9bfe1101-5513-45fa-ae3b-7e668e317bd5');
    expect(senderRes.status).toBe(404);

    const receiverRes = await httpGet(port, '/x-nmos/node/v1.3/receivers/6b73a87b-1234-0000-0000-000000000001');
    expect(receiverRes.status).toBe(404);
  });

  it('Get connectionStatus (4p4) on receiver after bus update', async () => {
    bus.publish(makeSetPropertyOp({
      origin: 'test',
      correlationId: 'c1',
      nodeId: 'root/receiver-monitors/rx-monitor-01',
      property: 'connectionStatus',
      value: 1,
    }));
    await new Promise((r) => setTimeout(r, 30));
    const resp = await client.command({
      oid: rxOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 4, index: 4 } },
    });
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(1);
  });

  it('derived overallStatus on receiver becomes Healthy when active domains healthy', async () => {
    bus.publish(makeSetPropertyOp({
      origin: 'test',
      correlationId: 'c2',
      nodeId: 'root/receiver-monitors/rx-monitor-01',
      property: 'streamStatus',
      value: 1,
    }));
    await new Promise((r) => setTimeout(r, 30));
    const resp = await client.command({
      oid: rxOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(1);
  });

  it('GetTransmissionErrorCounters on sender returns []', async () => {
    const resp = await client.command({
      oid: txOid,
      methodId: NC_SENDER_MONITOR_METHOD.GetTransmissionErrorCounters,
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown[] }).value).toHaveLength(0);
  });
});
