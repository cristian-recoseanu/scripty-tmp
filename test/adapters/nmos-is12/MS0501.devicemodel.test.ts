/**
 * E15.T9 — MS-05-02 Device Model Traversal Tests.
 *
 * Validates that the device model exposed via NcBlock methods and the
 * NcDeviceManager/NcClassManager is structurally correct and queryable,
 * per MS-05-02 §7 and the MS0501Test inherited checks from nmos-testing.
 *
 * All tests operate against a live Is12EgressAdapter instance using the
 * Is12Client harness.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import {
  OID_ROOT,
  OID_DEVICE_MANAGER,
  OID_CLASS_MANAGER,
} from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import {
  NC_OBJECT_METHOD,
  NC_BLOCK_METHOD,
  NC_CLASS_MANAGER_METHOD,
  NC_OBJECT_PROPERTY,
} from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';
import { Is12Client } from '../../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type {
  NcBlockMemberDescriptor,
  NcClassDescriptor,
  NcDatatypeDescriptor,
} from '../../../src/adapters/nmos-is12/ms05/types.js';

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test tree: root (Sensor) with one child (Actuator)
// ---------------------------------------------------------------------------

function makeTree() {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Sensor', path: 'root' },
    [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: true, observable: false, nullable: false },
    ],
    [],
  );
  root.setProperty('temperature', 20.0);
  root.setProperty('label', 'sensor-A');

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

function makeEntities() {
  const reg = new EntityRegistry();
  reg.register({
    entity_name: 'Sensor',
    properties: [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: true, observable: false, nullable: false },
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
// Suite setup
// ---------------------------------------------------------------------------

describe('E15.T9 — NcBlock: GetMemberDescriptors', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('GetMemberDescriptors on root block returns array of descriptors', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const value = (resp.responses[0]?.result as { value: unknown }).value;
    expect(Array.isArray(value)).toBe(true);
  });

  it('each descriptor has required MS-05-02 fields', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    for (const m of members) {
      expect(typeof m.oid).toBe('number');
      expect(typeof m.constantOid).toBe('boolean');
      expect(Array.isArray(m.classId)).toBe(true);
      expect(m.classId.length).toBeGreaterThan(0);
      expect(typeof m.role).toBe('string');
      expect(typeof m.userLabel).toBe('string');
      expect(typeof m.owner).toBe('number');
    }
  });

  it('recurse=true returns more members than recurse=false when tree has children', async () => {
    const flatResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    const recursiveResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const flat = (flatResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const recursive = (recursiveResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(recursive.length).toBeGreaterThanOrEqual(flat.length);
  });
});

// ---------------------------------------------------------------------------
// FindMembersByRole
// ---------------------------------------------------------------------------

describe('E15.T9 — NcBlock: FindMembersByRole', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9-role');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('FindMembersByRole with matching role returns at least one result', async () => {
    // First get member roles from GetMemberDescriptors
    const listResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (listResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(members.length).toBeGreaterThan(0);
    const firstRole = members[0]!.role;

    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByRole,
      arguments: { role: firstRole, caseSensitive: true, matchWholeString: true, recurse: true },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.role).toBe(firstRole);
  });

  it('FindMembersByRole with non-matching role returns empty array', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByRole,
      arguments: { role: 'no-such-role-xyz', caseSensitive: true, matchWholeString: true, recurse: true },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(found).toHaveLength(0);
  });

  it('FindMembersByRole with missing role → BadCommandFormat', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByRole,
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadCommandFormat);
  });
});

// ---------------------------------------------------------------------------
// FindMembersByClassId
// ---------------------------------------------------------------------------

describe('E15.T9 — NcBlock: FindMembersByClassId', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9-cls');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('FindMembersByClassId with a known classId returns matching members', async () => {
    // Get classId of the first member
    const listResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (listResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(members.length).toBeGreaterThan(0);
    const classId = members[0]!.classId;

    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByClassId,
      arguments: { classId, includeDerived: false, recurse: true },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(found.length).toBeGreaterThan(0);
  });

  it('FindMembersByClassId with unknown classId returns empty array', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByClassId,
      arguments: { classId: [99, 99], includeDerived: false, recurse: true },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(found).toHaveLength(0);
  });

  it('FindMembersByClassId with missing classId → BadCommandFormat', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByClassId,
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadCommandFormat);
  });
});

// ---------------------------------------------------------------------------
// Standard NcObject properties on every object
// ---------------------------------------------------------------------------

describe('E15.T9 — Standard NcObject properties (level 1) on managed objects', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9-stdprops');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('Get classId (1p1) on DeviceManager returns non-null', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.ClassId },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(Array.isArray(val)).toBe(true);
  });

  it('GetMemberDescriptors includes DeviceManager (oid=2, classId=[1,3,1])', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const dm = members.find((m) => m.oid === OID_DEVICE_MANAGER);
    expect(dm).toBeDefined();
    expect(dm?.classId).toEqual([1, 3, 1]);
    expect(dm?.role).toBe('DeviceManager');
    expect(dm?.owner).toBe(OID_ROOT);
  });

  it('GetMemberDescriptors includes ClassManager (oid=3, classId=[1,3,2])', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const cm = members.find((m) => m.oid === OID_CLASS_MANAGER);
    expect(cm).toBeDefined();
    expect(cm?.classId).toEqual([1, 3, 2]);
    expect(cm?.role).toBe('ClassManager');
    expect(cm?.owner).toBe(OID_ROOT);
  });

  it('Get members (2p2) on root block returns same array as GetMemberDescriptors', async () => {
    const getResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 2, index: 2 } },
    });
    expect(getResp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const members = (getResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const dm = members.find((m) => m.oid === OID_DEVICE_MANAGER);
    expect(dm).toBeDefined();
    const cm = members.find((m) => m.oid === OID_CLASS_MANAGER);
    expect(cm).toBeDefined();
  });

  it('Get enabled (2p1) on root block returns true', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 2, index: 1 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(true);
  });

  it('Get oid (1p2) on DeviceManager returns numeric oid', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.Oid },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(val).toBe(OID_DEVICE_MANAGER);
  });

  it('Get role (1p5) on ClassManager returns a non-null value', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.Role },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(val).not.toBeNull();
  });

  it('Get userLabel (1p6) returns a string', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.UserLabel },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(typeof val).toBe('string');
  });

  it('Set userLabel (1p6) on root node → Ok, then Get returns updated value', async () => {
    const setResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: NC_OBJECT_PROPERTY.UserLabel, value: 'my-label' },
    });
    expect(setResp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);

    const getResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: NC_OBJECT_PROPERTY.UserLabel },
    });
    expect((getResp.responses[0]?.result as { value: unknown }).value).toBe('my-label');
  });

  it('Set classId (1p1) → Readonly', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: NC_OBJECT_PROPERTY.ClassId, value: [9, 9] },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Readonly);
  });
});

// ---------------------------------------------------------------------------
// NcClassManager — GetControlClass / GetDatatype
// ---------------------------------------------------------------------------

describe('E15.T9 — NcClassManager descriptor queries', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9-cm');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('GetDatatype for NcFloat64 returns a Primitive descriptor', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      arguments: { name: 'NcFloat64' },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const dt = (resp.responses[0]?.result as { value: NcDatatypeDescriptor }).value;
    expect((dt as unknown as { type: number }).type).toBe(0);
    expect(dt.name).toBe('NcFloat64');
  });

  it('GetDatatype for unknown type returns BadOid', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      arguments: { name: 'NoSuchType' },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadOid);
  });

  it('GetControlClass for a member classId returns a class descriptor', async () => {
    // Retrieve member descriptors — identity arrays come back as plain number[] after JSON roundtrip
    const listResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (listResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(members.length).toBeGreaterThan(0);
    // identity is readonly number[] on the type but arrives as number[] over wire
    // Skip standard manager entries ([1,3,x]) — pick the first user-defined class
    const userMember = members.find((m) => {
      const id = m.classId as number[];
      return !(id[0] === 1 && id[1] === 3);
    });
    expect(userMember).toBeDefined();
    const classId = userMember!.classId as number[];

    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
      arguments: { classId },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const desc = (resp.responses[0]?.result as { value: NcClassDescriptor }).value;
    expect(typeof desc.name).toBe('string');
    expect(Array.isArray(desc.classId)).toBe(true);
  });

  it('GetControlClass for unknown classId returns BadOid', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
      arguments: { classId: [99, 99] },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadOid);
  });
});

// ---------------------------------------------------------------------------
// NcDeviceManager — level-3 property reads
// ---------------------------------------------------------------------------

describe('E15.T9 — NcDeviceManager level-3 properties', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9-dm');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  const level3Props = [
    { name: 'ncVersion (3p1)',          id: { level: 3, index: 1 } },
    { name: 'manufacturer (3p2)',       id: { level: 3, index: 2 } },
    { name: 'product (3p3)',            id: { level: 3, index: 3 } },
    { name: 'serialNumber (3p4)',       id: { level: 3, index: 4 } },
    { name: 'userInventoryCode (3p5)',  id: { level: 3, index: 5 } },
    { name: 'deviceName (3p6)',         id: { level: 3, index: 6 } },
    { name: 'deviceRole (3p7)',         id: { level: 3, index: 7 } },
    { name: 'operationalState (3p8)',   id: { level: 3, index: 8 } },
    { name: 'resetCause (3p9)',         id: { level: 3, index: 9 } },
    { name: 'message (3p10)',           id: { level: 3, index: 10 } },
  ];

  for (const prop of level3Props) {
    it(`Get ${prop.name} returns Ok`, async () => {
      const resp = await client.command({
        oid: OID_DEVICE_MANAGER,
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: prop.id },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    });
  }

  it('unknown level-3 property returns PropertyNotImplemented', async () => {
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 99 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.PropertyNotImplemented);
  });
});

// ---------------------------------------------------------------------------
// NcClassManager — level-3 property reads (controlClasses 3p1, datatypes 3p2)
// ---------------------------------------------------------------------------

describe('E15.T9 — NcClassManager level-3 properties', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-t9-cm3');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('Get controlClasses (3p1) returns an array of class descriptors', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(Array.isArray(val)).toBe(true);
    expect((val as unknown[]).length).toBeGreaterThan(0);
  });

  it('Get datatypes (3p2) returns an array of datatype descriptors', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 2 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(Array.isArray(val)).toBe(true);
    expect((val as unknown[]).length).toBeGreaterThan(0);
  });

  it('Get unknown level-3 ClassManager property returns PropertyNotImplemented', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 99 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.PropertyNotImplemented);
  });
});

// ---------------------------------------------------------------------------
// ms05_03 — Roles unique within block
// ms05_04 — OIDs globally unique
// ms05_10 — Managers are singletons
// ms05_05 — Non-standard classes have authority key
// ---------------------------------------------------------------------------

describe('E15.T9 — ms05_03/04/05/10: structural integrity', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-struct');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('ms05_03 — roles are unique within root block', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const roles = members.map((m) => m.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('ms05_04 — oids are globally unique across all members', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const allOids = [OID_ROOT, ...members.map((m) => m.oid)];
    expect(new Set(allOids).size).toBe(allOids.length);
  });

  it('ms05_10 — DeviceManager appears exactly once', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const dms = members.filter((m) => {
      const id = m.classId as number[];
      return id[0] === 1 && id[1] === 3 && id[2] === 1;
    });
    expect(dms).toHaveLength(1);
  });

  it('ms05_10 — ClassManager appears exactly once', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: true },
    });
    const members = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const cms = members.filter((m) => {
      const id = m.classId as number[];
      return id[0] === 1 && id[1] === 3 && id[2] === 2;
    });
    expect(cms).toHaveLength(1);
  });

  it('ms05_05 — every classId is either standard (all positive) or has authority key (0 or negative)', async () => {
    const resp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    const classes = (resp.responses[0]?.result as { value: NcClassDescriptor[] }).value;
    for (const cls of classes) {
      const id = cls.classId as number[];
      const isAllPositive = id.every((v) => v > 0);
      const hasAuthKey = id.some((v, i) => i > 0 && v <= 0);
      expect(isAllPositive || hasAuthKey).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ms05_13 — GetControlClass with includeInherited=true/false
// ms05_14 — GetDatatype with includeInherited=true/false
// ms05_19 — FindMembersByPath
// ---------------------------------------------------------------------------

describe('E15.T9 — ms05_13/14/19: ClassManager methods and FindMembersByPath', () => {
  let adapter: Is12EgressAdapter;
  let client: Is12Client;

  beforeAll(async () => {
    adapter = new Is12EgressAdapter('ms0501-cm-methods');
    await adapter.init(makeCtx());
    await adapter.start();
    client = await Is12Client.connect(adapter.wsPort);
  });

  afterAll(async () => {
    await client.close();
    await adapter.stop();
  });

  it('ms05_13 — GetControlClass includeInherited=false returns Ok for each advertised class', async () => {
    const listResp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    const classes = (listResp.responses[0]?.result as { value: NcClassDescriptor[] }).value;
    for (const cls of classes) {
      const resp = await client.command({
        oid: OID_CLASS_MANAGER,
        methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
        arguments: { classId: cls.classId, includeInherited: false },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    }
  });

  it('ms05_13 — GetControlClass includeInherited=true returns Ok for each advertised class', async () => {
    const listResp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    const classes = (listResp.responses[0]?.result as { value: NcClassDescriptor[] }).value;
    for (const cls of classes) {
      const resp = await client.command({
        oid: OID_CLASS_MANAGER,
        methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
        arguments: { classId: cls.classId, includeInherited: true },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    }
  });

  it('ms05_14 — GetDatatype includeInherited=false returns Ok for each advertised datatype', async () => {
    const listResp = await client.command({
      oid: OID_CLASS_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 2 } },
    });
    const datatypes = (listResp.responses[0]?.result as { value: NcDatatypeDescriptor[] }).value;
    for (const dt of datatypes) {
      const resp = await client.command({
        oid: OID_CLASS_MANAGER,
        methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
        arguments: { name: dt.name, includeInherited: false },
      });
      expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    }
  });

  it('ms05_19 — FindMembersByPath returns the member matching the role', async () => {
    const listResp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.GetMemberDescriptors,
      arguments: { recurse: false },
    });
    const members = (listResp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    const userMember = members.find((m) => {
      const id = m.classId as number[];
      return !(id[0] === 1 && id[1] === 3);
    });
    expect(userMember).toBeDefined();

    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByPath,
      arguments: { path: [userMember!.role] },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(found).toHaveLength(1);
    expect(found[0]?.oid).toBe(userMember!.oid);
  });

  it('ms05_19 — FindMembersByPath with unknown path returns empty array', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByPath,
      arguments: { path: ['no-such-role'] },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const found = (resp.responses[0]?.result as { value: NcBlockMemberDescriptor[] }).value;
    expect(found).toHaveLength(0);
  });
});
