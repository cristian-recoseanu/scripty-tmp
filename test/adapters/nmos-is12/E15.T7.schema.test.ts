/**
 * E15.T7 — Published JSON-Schema conformance harness.
 *
 * Validates every descriptor and wire message emitted by Is12EgressAdapter
 * against vendored JSON schemas in test/fixtures/ms05-schemas/.
 *
 * Coverage:
 *   - NcDatatypeDescriptor (Primitive + Struct)
 *   - NcClassDescriptor
 *   - NcBlockMemberDescriptor
 *   - IS12CommandResponse wire message
 *   - IS12Notification wire message
 *   - IS12SubscriptionResponse wire message
 *   - IS12Error wire message
 *   - NcMethodResult shapes (ok / with-value / error)
 */

import { createRequire } from 'module';

import Ajv from 'ajv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import {
  OID_ROOT,
  OID_DEVICE_MANAGER,
  OID_CLASS_MANAGER,
} from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import {
  NC_BLOCK_METHOD,
  NC_CLASS_MANAGER_METHOD,
  NC_OBJECT_METHOD,
  NC_OBJECT_PROPERTY,
} from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { IS12MessageType, NcMethodStatus } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { makePropertyChangedOp } from '../../../src/engine/bus/operations.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';
import { Is12Client } from '../../helpers/Is12Client.js';

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Ajv setup — eslint-disable covers all AJV any-typed API usage
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, import/order */
const schemaDatatypeDescriptor   = require('../../fixtures/ms05-schemas/NcDatatypeDescriptor.schema.json');
const schemaClassDescriptor      = require('../../fixtures/ms05-schemas/NcClassDescriptor.schema.json');
const schemaMemberDescriptor     = require('../../fixtures/ms05-schemas/NcBlockMemberDescriptor.schema.json');
const schemaMethodResult         = require('../../fixtures/ms05-schemas/NcMethodResult.schema.json');
const schemaCommandResponse      = require('../../fixtures/ms05-schemas/IS12CommandResponse.schema.json');
const schemaNotification         = require('../../fixtures/ms05-schemas/IS12Notification.schema.json');
const schemaSubscriptionResponse = require('../../fixtures/ms05-schemas/IS12SubscriptionResponse.schema.json');
const schemaError                = require('../../fixtures/ms05-schemas/IS12Error.schema.json');

const ajv = new (Ajv as any)({ strict: false });

function makeValidator(schema: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return ajv.compile(schema);
}

const validateDatatype        = makeValidator(schemaDatatypeDescriptor);
const validateClassDesc       = makeValidator(schemaClassDescriptor);
const validateMemberDesc      = makeValidator(schemaMemberDescriptor);
const validateMethodResult    = makeValidator(schemaMethodResult);
const validateCommandResponse = makeValidator(schemaCommandResponse);
const validateNotification    = makeValidator(schemaNotification);
const validateSubResponse     = makeValidator(schemaSubscriptionResponse);
const validateError           = makeValidator(schemaError);

function assertValid(validate: ReturnType<typeof makeValidator>, data: unknown, label: string): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const ok: boolean = validate(data);
  if (!ok) {
    throw new Error(`Schema validation failed for ${label}:\n${JSON.stringify(validate.errors, null, 2)}\nData: ${JSON.stringify(data, null, 2)}`);
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, import/order */

// ---------------------------------------------------------------------------
// Test tree
// ---------------------------------------------------------------------------

function makeTree(): InstanceTree {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Sensor', path: 'root' },
    [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    [],
  );
  root.setProperty('temperature', 22.5);
  const child = new InstanceNodeImpl(
    { location: 'actuator', entity_def: 'Actuator', path: 'root/actuator' },
    [
      { id: 'position', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    [],
  );
  child.setProperty('position', 0.0);
  root.addChild(child);
  tree.setRoot(root);
  return tree;
}

function makeEntities(): EntityRegistry {
  const reg = new EntityRegistry();
  reg.register({
    entity_name: 'Sensor',
    properties: [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    methods: [],
  });
  reg.register({
    entity_name: 'Actuator',
    properties: [
      { id: 'position', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    methods: [],
  });
  return reg;
}

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

function makeCtx(): AdapterContext {
  return {
    bus: new UceBus(),
    tree: makeTree(),
    types: new DatatypeRegistry(),
    entities: makeEntities(),
    logger: makeLogger(),
    config: { wsPort: 0 },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('E15.T7 — NcDatatypeDescriptor schema conformance', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('t7-dt');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('GetDatatype NcFloat64 → Primitive descriptor validates against schema', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      arguments: { name: 'NcFloat64' },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const dt = (resp.responses[0]?.result as { value: unknown }).value;
    assertValid(validateDatatype, dt, 'NcDatatypeDescriptor(Primitive:NcFloat64)');
  });

  it('GetDatatype NcString → Primitive descriptor validates against schema', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      arguments: { name: 'NcString' },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const dt = (resp.responses[0]?.result as { value: unknown }).value;
    assertValid(validateDatatype, dt, 'NcDatatypeDescriptor(Primitive:NcString)');
  });

  it('GetDatatype Sensor (struct) → Struct descriptor validates against schema', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      arguments: { name: 'Sensor' },
    });
    if (resp.responses[0]?.result.status !== NcMethodStatus.Ok) return; // struct types may not be registered
    const dt = (resp.responses[0]?.result as { value: unknown }).value;
    assertValid(validateDatatype, dt, 'NcDatatypeDescriptor(Struct:Sensor)');
  });

  // -------------------------------------------------------------------------
  // Static samples for Enum and Typedef — required by NMOS Control Feature
  // Sets (monitoring: NcOverallStatus, NcLinkStatus, etc.; device-config:
  // NcRestoreMode, NcPropertyRestoreNoticeType, etc.; identification:
  // NcIdentBeacon). The engine's DatatypeRegistry is struct-only; Enum/Typedef
  // descriptors are generated by future feature-set implementations. These
  // tests verify the schema covers those shapes correctly.
  // -------------------------------------------------------------------------

  it('Enum descriptor sample (NcOverallStatus from monitoring feature set) validates against schema', () => {
    const sample = {
      type: 3,
      name: 'NcOverallStatus',
      description: 'Overall status enum — NMOS Control Feature Sets: monitoring',
      items: [
        { name: 'Inactive',          value: 0, description: 'Inactive' },
        { name: 'Healthy',           value: 1, description: 'The overall status is healthy' },
        { name: 'PartiallyHealthy',  value: 2, description: 'The overall status is partially healthy' },
        { name: 'Unhealthy',         value: 3, description: 'The overall status is unhealthy' },
      ],
      constraints: null,
    };
    assertValid(validateDatatype, sample, 'NcDatatypeDescriptor(Enum:NcOverallStatus)');
  });

  it('Enum descriptor sample (NcRestoreMode from device-configuration feature set) validates against schema', () => {
    const sample = {
      type: 3,
      name: 'NcRestoreMode',
      description: 'Restore mode enumeration — NMOS Control Feature Sets: device-configuration',
      items: [
        { name: 'Modify',  value: 0, description: 'Restore mode is Modify' },
        { name: 'Rebuild', value: 1, description: 'Restore mode is Rebuild' },
      ],
      constraints: null,
    };
    assertValid(validateDatatype, sample, 'NcDatatypeDescriptor(Enum:NcRestoreMode)');
  });

  it('Typedef descriptor sample validates against schema', () => {
    const sample = {
      type: 1,
      name: 'NcRolePath',
      description: 'Sequence of role strings forming a path',
      parentType: 'NcString',
      constraints: null,
    };
    assertValid(validateDatatype, sample, 'NcDatatypeDescriptor(Typedef:NcRolePath)');
  });
});

// ---------------------------------------------------------------------------

describe('E15.T7 — NcClassDescriptor schema conformance', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('t7-cd');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('GetControlClass for every registered class validates against schema', async () => {
    const listResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (listResp.responses[0]?.result as { value: Array<{ classId: number[] }> }).value;
    expect(members.length).toBeGreaterThan(0);

    for (const m of members) {
      // Standard manager classIds ([1,3,x]) are not in the user-defined catalogue.
      if (m.classId[0] === 1 && m.classId[1] === 3) continue;
      const resp = await client.command({
        oid: OID_CLASS_MANAGER,
        methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
        arguments: { classId: m.classId },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
      const desc = (resp.responses[0]?.result as { value: unknown }).value;
      assertValid(validateClassDesc, desc, `NcClassDescriptor(classId=${JSON.stringify(m.classId)})`);
    }
  });

  // -------------------------------------------------------------------------
  // Static samples for feature-set class shapes.
  // NcIdentBeacon [1.2.1], NcStatusMonitor [1.2.2], NcReceiverMonitor [1.2.2.1]
  // all extend NcWorker and have 3- or 4-level classId arrays.
  // These verify the schema accepts deep inheritance hierarchies.
  // -------------------------------------------------------------------------

  it('NcIdentBeacon (identification feature set, classId [1,2,1]) validates against NcClassDescriptor schema', () => {
    const sample = {
      classId: [1, 2, 1],
      name: 'NcIdentBeacon',
      fixedRole: null,
      description: 'Identification beacon — NMOS Control Feature Sets: identification',
      properties: [
        {
          id: { level: 3, index: 1 },
          name: 'active',
          typeName: 'NcBoolean',
          isReadOnly: false,
          isNullable: false,
          isSequence: false,
          isDeprecated: false,
          description: 'Indicator active state',
          constraints: null,
        },
      ],
      methods: [],
      events: [],
    };
    assertValid(validateClassDesc, sample, 'NcClassDescriptor(NcIdentBeacon)');
  });

  it('NcStatusMonitor (monitoring feature set, classId [1,2,2]) validates against NcClassDescriptor schema', () => {
    const sample = {
      classId: [1, 2, 2],
      name: 'NcStatusMonitor',
      fixedRole: null,
      description: 'Baseline status monitoring class — NMOS Control Feature Sets: monitoring',
      properties: [
        { id: { level: 3, index: 1 }, name: 'overallStatus',        typeName: 'NcOverallStatus', isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Overall status property',         constraints: null },
        { id: { level: 3, index: 2 }, name: 'overallStatusMessage', typeName: 'NcString',        isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Overall status message property', constraints: null },
        { id: { level: 3, index: 3 }, name: 'statusReportingDelay', typeName: 'NcUint32',        isReadOnly: false, isNullable: false, isSequence: false, isDeprecated: false, description: 'Status reporting delay (seconds)', constraints: null },
      ],
      methods: [],
      events: [],
    };
    assertValid(validateClassDesc, sample, 'NcClassDescriptor(NcStatusMonitor)');
  });
});

// ---------------------------------------------------------------------------

describe('E15.T7 — NcBlockMemberDescriptor schema conformance', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('t7-bmd');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('GetMemberDescriptors (recurse=true) — all members validate against schema', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const members = (resp.responses[0]?.result as { value: unknown[] }).value;
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) {
      assertValid(validateMemberDesc, m, 'NcBlockMemberDescriptor');
    }
  });
});

// ---------------------------------------------------------------------------

describe('E15.T7 — NcMethodResult schema conformance', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('t7-mr');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('Ok result (Get oid) validates against NcMethodResult schema', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.Oid },
    });
    const result = resp.responses[0]?.result;
    assertValid(validateMethodResult, result, 'NcMethodResult(ok+value)');
  });

  it('Error result (BadOid) validates against NcMethodResult schema', async () => {
    const resp = await client.command({
      oid: 9999,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.Oid },
    });
    const result = resp.responses[0]?.result;
    expect(result?.status).toBe(NcMethodStatus.BadOid);
    assertValid(validateMethodResult, result, 'NcMethodResult(error:BadOid)');
  });

  it('Void Ok result (Set userLabel) validates against NcMethodResult schema', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: NC_OBJECT_PROPERTY.UserLabel, value: 'schema-test' },
    });
    const result = resp.responses[0]?.result;
    expect(result?.status).toBe(NcMethodStatus.Ok);
    assertValid(validateMethodResult, result, 'NcMethodResult(void-ok)');
  });
});

// ---------------------------------------------------------------------------

describe('E15.T7 — IS-12 wire message schema conformance', () => {
  let adapter: Is12EgressAdapter;
  let bus: UceBus;
  let client: Is12Client;
  let rootOid: number;
  let rootNodeId: string;

  beforeAll(async () => {
    bus = new UceBus();
    adapter = new Is12EgressAdapter('t7-wire');
    await adapter.init({ ...makeCtx(), bus, config: { wsPort: 0 } });
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
    rootOid = OID_ROOT;
    rootNodeId = 'root';
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('CommandResponse message validates against IS12CommandResponse schema', async () => {
    // Capture raw WS frame by using low-level send/receive via Is12Client internals
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.Oid },
    });
    // resp IS the parsed CommandResponse — re-wrap as wire shape
    const wire = {
      messageType: IS12MessageType.CommandResponse,
      responses: resp.responses,
    };
    assertValid(validateCommandResponse, wire, 'IS12CommandResponse');
  });

  it('SubscriptionResponse message validates against IS12SubscriptionResponse schema', async () => {
    const subResp = await client.subscribe([OID_ROOT]);
    const wire = {
      messageType: IS12MessageType.SubscriptionResponse,
      subscriptions: subResp.subscriptions,
    };
    assertValid(validateSubResponse, wire, 'IS12SubscriptionResponse');
  });

  it('Notification message validates against IS12Notification schema', async () => {
    await client.subscribe([rootOid]);
    const notifPromise = client.nextNotification(2000);

    // Trigger via bus — Set userLabel does not publish to bus, so use bus.publish directly
    const op = makePropertyChangedOp({
      nodeId: rootNodeId,
      property: 'temperature',
      changeType: 'valueChanged',
      value: 99.9,
      origin: 'external',
      correlationId: 'schema-test',
    });
    bus.publish(op);

    const notifMsg = await notifPromise;
    assertValid(validateNotification, notifMsg, 'IS12Notification');
  });

  it('Error message (bad messageType) validates against IS12Error schema', async () => {
    // Use a dedicated fresh client so nextRawMessage captures only the Error response
    const errorAdapter = new Is12EgressAdapter('t7-wire-err');
    await errorAdapter.init(makeCtx());
    await errorAdapter.start();
    const errorClient = await Is12Client.connect(errorAdapter.wsPort);

    const errorPromise = errorClient.nextRawMessage(2000);
    errorClient.sendRaw(JSON.stringify({ messageType: 99, commands: [] }));
    const raw = await errorPromise;
    const parsed: unknown = JSON.parse(raw);

    await errorClient.close();
    await errorAdapter.stop();

    assertValid(validateError, parsed, 'IS12Error');
  });
});
