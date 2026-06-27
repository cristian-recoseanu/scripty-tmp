/**
 * BCP-008-01 compliance tests for NcReceiverMonitor.
 *
 * Mirrors the nmos-testing BCP0080101Test.py and BCP008Test.py suites, covering
 * all testable requirements for a Protocol Bridge that does not implement IS-05
 * connection management (activate/deactivate receiver) and therefore cannot run
 * the IS-05-dependent tests (test_02, test_03, test_05, test_07, test_08, test_13,
 * test_14).  Those tests are documented here as MANUAL or UNCLEAR per the spec.
 *
 * Spec reference: https://specs.amwa.tv/bcp-008-01/branches/v1.0.x/docs/Overview.html
 * nmos-testing:   BCP0080101Test.py + BCP008Test.py
 *
 * Tests covered:
 *   test_01 — statusReportingDelay (3p3) can be set to default 3
 *   test_06 — ResetCountersAndMessages (4m3) resets counters + messages
 *   test_09 — all domain status property values are valid enum values
 *   test_10 — GetLostPacketCounters (4m1) and GetLatePacketCounters (4m2) return arrays
 *   test_12 — synchronizationSourceId (4p10) is not empty string
 *   +extras — class identity, all properties readable, read-only enforcement,
 *             NcWorker enabled (2p1), autoResetCountersAndMessages (4p14) writable
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import {
  OID_ROOT,
} from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import {
  NC_OBJECT_METHOD,
  NC_BLOCK_METHOD,
  NC_RECEIVER_MONITOR_METHOD,
} from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { loadEntities, loadDatatypes, loadTree } from '../../../src/config/modelLoader.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { UceEngine } from '../../../src/engine/UceEngine.js';
import { Is12Client } from '../../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type { NcBlockMemberDescriptor } from '../../../src/adapters/nmos-is12/ms05/types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../../Scenarios/Scenario-02');
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

// NcPropertyId helpers — mirror nmos-testing NcReceiverMonitorProperties enum
const P = {
  // NcStatusMonitor (level 3)
  overallStatus:             { level: 3, index: 1 },
  overallStatusMessage:      { level: 3, index: 2 },
  statusReportingDelay:      { level: 3, index: 3 },
  // NcReceiverMonitor (level 4)
  linkStatus:                           { level: 4, index: 1 },
  linkStatusMessage:                    { level: 4, index: 2 },
  linkStatusTransitionCounter:          { level: 4, index: 3 },
  connectionStatus:                     { level: 4, index: 4 },
  connectionStatusMessage:              { level: 4, index: 5 },
  connectionStatusTransitionCounter:    { level: 4, index: 6 },
  externalSynchronizationStatus:        { level: 4, index: 7 },
  externalSynchronizationStatusMessage: { level: 4, index: 8 },
  externalSynchronizationStatusTransitionCounter: { level: 4, index: 9 },
  synchronizationSourceId:              { level: 4, index: 10 },
  streamStatus:                         { level: 4, index: 11 },
  streamStatusMessage:                  { level: 4, index: 12 },
  streamStatusTransitionCounter:        { level: 4, index: 13 },
  autoResetCountersAndMessages:         { level: 4, index: 14 },
} as const;

// NcLinkStatus values (BCP-008-01 §Link status)
enum NcLinkStatus    { AllUp = 1, SomeDown = 2, AllDown = 3 }
// NcOverallStatus values (BCP-008-01 §Receiver overall status)
enum NcOverallStatus { Inactive = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }
// NcConnectionStatus values
enum NcConnectionStatus { Inactive = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }
// NcSynchronizationStatus values (NotUsed is a neutral state)
enum NcSynchronizationStatus { NotUsed = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }
// NcStreamStatus values
enum NcStreamStatus { Inactive = 0, Healthy = 1, PartiallyHealthy = 2, Unhealthy = 3 }

// ---------------------------------------------------------------------------
// Shared adapter / client setup
// ---------------------------------------------------------------------------

describe('BCP-008-01 — NcReceiverMonitor compliance', () => {
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
      bus,
      tree,
      types: datatypes,
      entities,
      logger: makeLogger(),
      config: {
        wsPort: port,
        host: '0.0.0.0',
        mapping: resolve(MAPPING_DIR, 'egress.is12.json'),
      },
    };

    adapter = new Is12EgressAdapter('is12-bcp0080101');
    await adapter.init(ctx);
    await adapter.start();
    client = await Is12Client.connect(port);

    // Discover monitorOid via recursive member traversal.
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByClassId,
      arguments: { classId: [1, 2, 2, 1], includeDerived: true, recurse: true },
    });
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    monitorOid = found[0]!.oid;
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Prerequisites: class identity
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ Prerequisites: class identity', () => {
    it('classId (1p1) is [1,2,2,1]', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: { level: 1, index: 1 } },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toEqual([1, 2, 2, 1]);
    });

    it('NcReceiverMonitor is discoverable via FindMembersByClassId([1,2,2,1], recurse=true)', async () => {
      const resp = await client.command({
        oid: OID_ROOT,
        methodId: NC_BLOCK_METHOD.FindMembersByClassId,
        arguments: { classId: [1, 2, 2, 1], includeDerived: false, recurse: true },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.classId).toEqual([1, 2, 2, 1]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // NcWorker enabled (2p1) — BCP-008-01 §NcWorker inheritance
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ NcWorker inheritance: enabled property (2p1)', () => {
    it('Get enabled (2p1) returns true (no operational meaning per BCP-008-01)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: { level: 2, index: 1 } },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // test_01 — statusReportingDelay (3p3)
  // Spec: Devices MUST use 3s as the default; MUST allow it to be set to 3s.
  // https://specs.amwa.tv/bcp-008-01/branches/v1.0.x/docs/Overview.html#receiver-status-reporting-delay
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ test_01: statusReportingDelay (3p3) — BCP-008-01 §Receiver status reporting delay', () => {
    it('initial statusReportingDelay (3p3) is 3 (BCP-008-01 mandatory default)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.statusReportingDelay },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(3);
    });

    it('Set statusReportingDelay (3p3) to 3 returns OK', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Set,
        arguments: { id: P.statusReportingDelay, value: 3 },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    });

    it('Get statusReportingDelay (3p3) after set still returns 3', async () => {
      await new Promise((r) => setTimeout(r, 20));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.statusReportingDelay },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // test_09 — domain status property values are valid enum values
  // Spec: all domain statuses must use legally defined enum values.
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ test_09: domain status values are valid — BCP-008-01 §Receiver monitoring', () => {
    it('overallStatus (3p1) is a valid NcOverallStatus (0–3)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.overallStatus },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).toBeTypeOf('number');
      expect(Object.values(NcOverallStatus)).toContain(v);
    });

    it('linkStatus (4p1) is a valid NcLinkStatus (1–3)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.linkStatus },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).toBeTypeOf('number');
      expect(Object.values(NcLinkStatus)).toContain(v);
    });

    it('connectionStatus (4p4) is a valid NcConnectionStatus (0–3)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.connectionStatus },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).toBeTypeOf('number');
      expect(Object.values(NcConnectionStatus)).toContain(v);
    });

    it('externalSynchronizationStatus (4p7) is a valid NcSynchronizationStatus (0–3)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.externalSynchronizationStatus },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).toBeTypeOf('number');
      expect(Object.values(NcSynchronizationStatus)).toContain(v);
    });

    it('streamStatus (4p11) is a valid NcStreamStatus (0–3)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.streamStatus },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).toBeTypeOf('number');
      expect(Object.values(NcStreamStatus)).toContain(v);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // test_10 — counter methods return arrays (GetLostPacketCounters, GetLatePacketCounters)
  // Spec: devices unable to detect MUST return an empty NcCounter[].
  // https://specs.amwa.tv/bcp-008-01/branches/v1.0.x/docs/Overview.html#late-and-lost-packets
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ test_10: counter methods implemented — BCP-008-01 §Late and lost packets', () => {
    it('GetLostPacketCounters (4m1) returns status OK and an array', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_RECEIVER_MONITOR_METHOD.GetLostPacketCounters,
        arguments: {},
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(Array.isArray(v)).toBe(true);
    });

    it('GetLatePacketCounters (4m2) returns status OK and an array', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_RECEIVER_MONITOR_METHOD.GetLatePacketCounters,
        arguments: {},
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(Array.isArray(v)).toBe(true);
    });

    it('GetLostPacketCounters returns empty array (bridge has no packet detection)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_RECEIVER_MONITOR_METHOD.GetLostPacketCounters,
        arguments: {},
      });
      expect((resp.responses[0]?.result as { value: unknown[] }).value).toHaveLength(0);
    });

    it('GetLatePacketCounters returns empty array (bridge has no packet detection)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_RECEIVER_MONITOR_METHOD.GetLatePacketCounters,
        arguments: {},
      });
      expect((resp.responses[0]?.result as { value: unknown[] }).value).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // test_12 — synchronizationSourceId (4p10) has a valid value
  // Spec: MUST be null, "internal", or a non-empty identifier. MUST NOT be "".
  // https://specs.amwa.tv/bcp-008-01/branches/v1.0.x/docs/Overview.html#synchronization-source-change
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ test_12: synchronizationSourceId (4p10) — BCP-008-01 §Synchronization source change', () => {
    it('synchronizationSourceId (4p10) is not an empty string', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.synchronizationSourceId },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).not.toBe('');
    });

    it('synchronizationSourceId (4p10) is null, "internal", or a non-empty string', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.synchronizationSourceId },
      });
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      const isValid = v === null || (typeof v === 'string' && v.length > 0);
      expect(isValid).toBe(true);
    });

    it('synchronizationSourceId is "internal" (bridge does not use external sync)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.synchronizationSourceId },
      });
      const v = (resp.responses[0]?.result as { value: unknown }).value;
      expect(v).toBe('internal');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // All required properties are readable
  // Validates every Get call returns OK (property implemented and accessible).
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ All 17 required properties are readable via IS-12 Get', () => {
    const allProps = Object.entries(P) as [string, { level: number; index: number }][];

    for (const [name, propId] of allProps) {
      it(`Get ${name} ({${propId.level}p${propId.index}}) returns OK`, async () => {
        const resp = await client.command({
          oid: monitorOid,
          methodId: NC_OBJECT_METHOD.Get,
          arguments: { id: propId },
        });
        expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Transition counters and status messages have expected initial types
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ Transition counter initial values are non-negative integers', () => {
    const counters = [
      ['linkStatusTransitionCounter',                          P.linkStatusTransitionCounter],
      ['connectionStatusTransitionCounter',                    P.connectionStatusTransitionCounter],
      ['externalSynchronizationStatusTransitionCounter',       P.externalSynchronizationStatusTransitionCounter],
      ['streamStatusTransitionCounter',                        P.streamStatusTransitionCounter],
    ] as [string, { level: number; index: number }][];

    for (const [name, propId] of counters) {
      it(`${name} is a non-negative integer`, async () => {
        const resp = await client.command({
          oid: monitorOid,
          methodId: NC_OBJECT_METHOD.Get,
          arguments: { id: propId },
        });
        const v = (resp.responses[0]?.result as { value: unknown }).value;
        expect(typeof v).toBe('number');
        expect(v as number).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(v)).toBe(true);
      });
    }
  });

  describe('§ Status message properties are null or strings (never invalid types)', () => {
    const messages = [
      ['overallStatusMessage',                      P.overallStatusMessage],
      ['linkStatusMessage',                         P.linkStatusMessage],
      ['connectionStatusMessage',                   P.connectionStatusMessage],
      ['externalSynchronizationStatusMessage',      P.externalSynchronizationStatusMessage],
      ['streamStatusMessage',                       P.streamStatusMessage],
    ] as [string, { level: number; index: number }][];

    for (const [name, propId] of messages) {
      it(`${name} is null or a string`, async () => {
        const resp = await client.command({
          oid: monitorOid,
          methodId: NC_OBJECT_METHOD.Get,
          arguments: { id: propId },
        });
        const v = (resp.responses[0]?.result as { value: unknown }).value;
        expect(v === null || typeof v === 'string').toBe(true);
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Read-only status properties cannot be written by IS-12 controllers
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ Read-only domain status properties cannot be written via IS-12 Set', () => {
    const readOnlyProps = [
      ['overallStatus (3p1)',     P.overallStatus,              0],
      ['linkStatus (4p1)',        P.linkStatus,                 2],
      ['connectionStatus (4p4)', P.connectionStatus,           1],
      ['streamStatus (4p11)',    P.streamStatus,                1],
    ] as [string, { level: number; index: number }, number][];

    for (const [label, propId, testValue] of readOnlyProps) {
      it(`Set ${label} returns Readonly error`, async () => {
        const resp = await client.command({
          oid: monitorOid,
          methodId: NC_OBJECT_METHOD.Set,
          arguments: { id: propId, value: testValue },
        });
        expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Readonly);
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Writable control properties
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ autoResetCountersAndMessages (4p14) is writable', () => {
    it('initial autoResetCountersAndMessages (4p14) is true (BCP-008-01 default)', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.autoResetCountersAndMessages },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(true);
    });

    it('Set autoResetCountersAndMessages (4p14) to true returns OK', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Set,
        arguments: { id: P.autoResetCountersAndMessages, value: true },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // test_06 equivalent — ResetCountersAndMessages (4m3)
  // Spec: Devices MUST be able to reset ALL status transition counter properties
  //       and ALL status message properties via this method.
  // https://specs.amwa.tv/bcp-008-01/branches/v1.0.x/docs/Overview.html#receiver-status-transition-counters
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ test_06: ResetCountersAndMessages (4m3) — BCP-008-01 §Receiver status transition counters', () => {
    it('ResetCountersAndMessages (4m3) returns status OK', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_RECEIVER_MONITOR_METHOD.ResetCountersAndMessages,
        arguments: {},
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    });

    it('after ResetCountersAndMessages, linkStatusTransitionCounter (4p3) is 0', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.linkStatusTransitionCounter },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(0);
    });

    it('after ResetCountersAndMessages, connectionStatusTransitionCounter (4p6) is 0', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.connectionStatusTransitionCounter },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(0);
    });

    it('after ResetCountersAndMessages, externalSynchronizationStatusTransitionCounter (4p9) is 0', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.externalSynchronizationStatusTransitionCounter },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(0);
    });

    it('after ResetCountersAndMessages, streamStatusTransitionCounter (4p13) is 0', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.streamStatusTransitionCounter },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBe(0);
    });

    it('after ResetCountersAndMessages, overallStatusMessage (3p2) is null', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.overallStatusMessage },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBeNull();
    });

    it('after ResetCountersAndMessages, linkStatusMessage (4p2) is null', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.linkStatusMessage },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBeNull();
    });

    it('after ResetCountersAndMessages, connectionStatusMessage (4p5) is null', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.connectionStatusMessage },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBeNull();
    });

    it('after ResetCountersAndMessages, externalSynchronizationStatusMessage (4p8) is null', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.externalSynchronizationStatusMessage },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBeNull();
    });

    it('after ResetCountersAndMessages, streamStatusMessage (4p12) is null', async () => {
      await new Promise((r) => setTimeout(r, 30));
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: P.streamStatusMessage },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      expect((resp.responses[0]?.result as { value: unknown }).value).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // test_14 equivalent — touchpoints (1p7) — BCP-008-01 §Touchpoints and IS-04 receivers
  // Spec: MUST have one and only one NcTouchpointNmos entry with resourceType "receiver"
  //       and the associated IS-04 receiver UUID.
  // https://specs.amwa.tv/bcp-008-01/branches/v1.0.x/docs/Overview.html#touchpoints-and-is-04-receivers
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ test_14: touchpoints (1p7) — BCP-008-01 §Touchpoints and IS-04 receivers', () => {
    let touchpoints: unknown[];

    beforeAll(async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: { level: 1, index: 7 } },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      touchpoints = (resp.responses[0]?.result as { value: unknown[] }).value;
    });

    it('touchpoints (1p7) is not null', () => {
      expect(touchpoints).not.toBeNull();
    });

    it('touchpoints (1p7) is an array', () => {
      expect(Array.isArray(touchpoints)).toBe(true);
    });

    it('touchpoints (1p7) contains exactly one entry', () => {
      expect(touchpoints).toHaveLength(1);
    });

    it('touchpoints[0].contextNamespace is "x-nmos"', () => {
      const tp = touchpoints[0] as { contextNamespace: string };
      expect(tp.contextNamespace).toBe('x-nmos');
    });

    it('touchpoints[0].resource.resourceType is "receiver"', () => {
      const tp = touchpoints[0] as { resource: { resourceType: string; id: string } };
      expect(tp.resource.resourceType).toBe('receiver');
    });

    it('touchpoints[0].resource.id is a non-empty string (IS-04 receiver UUID)', () => {
      const tp = touchpoints[0] as { resource: { resourceType: string; id: string } };
      expect(typeof tp.resource.id).toBe('string');
      expect(tp.resource.id.length).toBeGreaterThan(0);
    });

    it('touchpoints[0].resource.id is not empty string (BCP-008-01 compliance)', () => {
      const tp = touchpoints[0] as { resource: { resourceType: string; id: string } };
      expect(tp.resource.id).not.toBe('');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Unknown method returns MethodNotImplemented
  // ──────────────────────────────────────────────────────────────────────────

  describe('§ Unknown level-4 method returns MethodNotImplemented', () => {
    it('level-4 method index 99 returns MethodNotImplemented', async () => {
      const resp = await client.command({
        oid: monitorOid,
        methodId: { level: 4, index: 99 },
        arguments: {},
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.MethodNotImplemented);
    });
  });
});
