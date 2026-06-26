/**
 * Regression: derived overallStatus notifications must reflect the incoming
 * domain-status value, not the stale tree snapshot (MQTT publishes
 * PropertyChangedOp before the engine applies the update).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { OID_ROOT } from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_BLOCK_METHOD } from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import type { NcBlockMemberDescriptor } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { loadEntities, loadDatatypes, loadTree } from '../../../src/config/modelLoader.js';
import { makePropertyChangedOp } from '../../../src/engine/bus/operations.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { Is12Client } from '../../helpers/Is12Client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../../Scenarios/Scenario-03');
const MODEL_DIR = resolve(SCENARIO_DIR, 'model');
const MAPPING_DIR = resolve(SCENARIO_DIR, 'mapping');

let _nextPort = 49500;
function allocPort(): number { return _nextPort++; }

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

describe('derived overallStatus notification timing', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;
  let bus: UceBus;
  let monitorOid: number;

  beforeAll(async () => {
    const port = allocPort();
    const entities = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const datatypes = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    const tree = loadTree(resolve(MODEL_DIR, 'tree.yaml'), entities, datatypes);

    // Seed active receiver path without going through the engine queue.
    const node = tree.findById('root/receiver-monitors/rx-monitor-01');
    if (node.ok) {
      node.node.forceSetProperty('connectionStatus', 1);
      node.node.forceSetProperty('externalSynchronizationStatus', 1);
      node.node.forceSetProperty('streamStatus', 1);
    }

    bus = new UceBus();
    const ctx: AdapterContext = {
      bus,
      tree,
      types: datatypes,
      entities,
      logger: makeLogger(),
      config: { wsPort: port, host: '127.0.0.1', mapping: resolve(MAPPING_DIR, 'egress.is12.json') },
    };

    adapter = new Is12EgressAdapter('is12-overall-notif');
    await adapter.init(ctx);
    await adapter.start();
    client = await Is12Client.connect(port);

    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByClassId,
      arguments: { classId: [1, 2, 2, 1], includeDerived: true, recurse: true },
    });
    monitorOid = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value[0]!.oid;

    await client.subscribe([monitorOid]);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('overallStatus notification uses the new domain value before the engine applies it', async () => {
    // Simulate MQTT ingress: PropertyChangedOp is published before UceEngine updates the tree.
    bus.publish(makePropertyChangedOp({
      origin: 'mqtt-ingress',
      correlationId: 'overall-notif-regression',
      nodeId: 'root/receiver-monitors/rx-monitor-01',
      property: 'streamStatus',
      changeType: 'valueChanged',
      value: 3,
    }));

    const domainNotif = await client.nextNotification(1000);
    expect(domainNotif.notifications[0]!.eventData.propertyId).toEqual({ level: 4, index: 11 });
    expect(domainNotif.notifications[0]!.eventData.value).toBe(3);

    const overallNotif = await client.nextNotification(1000);
    expect(overallNotif.notifications[0]!.eventData.propertyId).toEqual({ level: 3, index: 1 });
    expect(overallNotif.notifications[0]!.eventData.value).toBe(3);
  });
});
