/**
 * BCP-008-02 compliance tests for NcSenderMonitor (Scenario-03 artefacts).
 *
 * Mirrors statically-testable checks from BCP0080201Test.py + BCP008Test.py.
 * IS-05 activation/deactivation tests are out of scope (MANUAL).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { OID_ROOT } from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import {
  NC_OBJECT_METHOD,
  NC_BLOCK_METHOD,
  NC_SENDER_MONITOR_METHOD,
} from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { loadEntities, loadDatatypes, loadTree } from '../../../src/config/modelLoader.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { UceEngine } from '../../../src/engine/UceEngine.js';
import { Is12Client } from '../../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type { NcBlockMemberDescriptor } from '../../../src/adapters/nmos-is12/ms05/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../../Scenarios/Scenario-03');
const MODEL_DIR = resolve(SCENARIO_DIR, 'model');
const MAPPING_DIR = resolve(SCENARIO_DIR, 'mapping');

let _nextPort = 49700;
function allocPort(): number { return _nextPort++; }

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

const P = {
  overallStatus:             { level: 3, index: 1 },
  statusReportingDelay:      { level: 3, index: 3 },
  linkStatus:                { level: 4, index: 1 },
  transmissionStatus:        { level: 4, index: 4 },
  externalSynchronizationStatus: { level: 4, index: 7 },
  essenceStatus:             { level: 4, index: 11 },
  synchronizationSourceId:   { level: 4, index: 10 },
  autoResetCountersAndMessages: { level: 4, index: 14 },
  touchpoints:               { level: 1, index: 7 },
};

enum NcOverallStatus { Inactive = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }
enum NcLinkStatus { AllUp = 1, SomeDown = 2, AllDown = 3 }
enum NcTransmissionStatus { Inactive = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }
enum NcSynchronizationStatus { NotUsed = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }
enum NcEssenceStatus { Inactive = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }

describe('BCP-008-02 — NcSenderMonitor compliance', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;
  let monitorOid: number;

  beforeAll(async () => {
    const port = allocPort();
    const entities = loadEntities(resolve(MODEL_DIR, 'entities.yaml'));
    const datatypes = loadDatatypes(resolve(MODEL_DIR, 'datatypes.yaml'));
    const tree = loadTree(resolve(MODEL_DIR, 'tree.yaml'), entities, datatypes);
    const bus = new UceBus();
    const engine = new UceEngine({ tree, bus });
    engine.start();

    const ctx: AdapterContext = {
      bus, tree, types: datatypes, entities,
      logger: makeLogger(),
      config: { wsPort: port, host: '0.0.0.0', mapping: resolve(MAPPING_DIR, 'egress.is12.json') },
    };

    adapter = new Is12EgressAdapter('is12-bcp0080201');
    await adapter.init(ctx);
    await adapter.start();
    client = await Is12Client.connect(port);

    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByClassId,
      arguments: { classId: [1, 2, 2, 2], includeDerived: true, recurse: true },
    });
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    monitorOid = found[0]!.oid;
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('classId (1p1) is [1,2,2,2]', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 1 } },
    });
    expect((resp.responses[0]?.result as { value: unknown }).value).toEqual([1, 2, 2, 2]);
  });

  it('statusReportingDelay (3p3) defaults to 3', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: P.statusReportingDelay },
    });
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(3);
  });

  it('overallStatus (3p1) is derived Inactive when transmission/essence inactive', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: P.overallStatus },
    });
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(NcOverallStatus.Inactive);
  });

  it('domain statuses are valid enum values', async () => {
    const checks: { id: { level: number; index: number }; allowed: number[] }[] = [
      { id: P.linkStatus, allowed: Object.values(NcLinkStatus) as number[] },
      { id: P.transmissionStatus, allowed: Object.values(NcTransmissionStatus) as number[] },
      { id: P.externalSynchronizationStatus, allowed: Object.values(NcSynchronizationStatus) as number[] },
      { id: P.essenceStatus, allowed: Object.values(NcEssenceStatus) as number[] },
    ];
    for (const { id, allowed } of checks) {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id },
      });
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(allowed).toContain(v);
    }
  });

  it('GetTransmissionErrorCounters (4m1) returns empty array', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_SENDER_MONITOR_METHOD.GetTransmissionErrorCounters,
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown[] }).value).toHaveLength(0);
  });

  it('ResetCountersAndMessages (4m2) returns OK', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_SENDER_MONITOR_METHOD.ResetCountersAndMessages,
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
  });

  it('synchronizationSourceId (4p10) is not empty string', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: P.synchronizationSourceId },
    });
    const v = (resp.responses[0]?.result as { value: unknown }).value;
    expect(v).not.toBe('');
  });

  it('touchpoints (1p7) has single x-nmos sender touchpoint', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: P.touchpoints },
    });
    const tps = (resp.responses[0]?.result as { value: { contextNamespace: string; resource: { resourceType: string; id: string } }[] }).value;
    expect(tps).toHaveLength(1);
    expect(tps[0]!.contextNamespace).toBe('x-nmos');
    expect(tps[0]!.resource.resourceType).toBe('sender');
    expect(tps[0]!.resource.id).toBe('9bfe1101-5513-45fa-ae3b-7e668e317bd5');
  });

  it('enabled (2p1) returns true per BCP-008-02 NcWorker inheritance', async () => {
    const resp = await client.command({
      oid: monitorOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 2, index: 1 } },
    });
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(true);
  });
});
