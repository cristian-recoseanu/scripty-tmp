/**
 * E11.T3 — Core MS-05 objects (NcDeviceManager, NcClassManager queries).
 * E11.T4 — NcObject generic methods (Get/Set/sequence methods).
 */

import { randomUUID } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { buildCatalogue } from '../../../src/adapters/nmos-is12/ms05/catalogue.js';
import { IdentityRegistry, OID_DEVICE_MANAGER, OID_CLASS_MANAGER } from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { dispatch, NC_OBJECT_METHOD, NC_CLASS_MANAGER_METHOD } from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import type { DispatchContext, PropertyIdMap } from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';


// ---------------------------------------------------------------------------
// Test tree: root (MySensor) with children
// ---------------------------------------------------------------------------

function makeTree() {
  const dtReg = new DatatypeRegistry();
  const entReg = new EntityRegistry();
  entReg.register({
    entity_name: 'MySensor',
    properties: [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: true, observable: false, nullable: false },
      { id: 'tags', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
    ],
    methods: [],
  });

  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'MySensor', path: 'root' },
    [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: true, observable: false, nullable: false },
      { id: 'tags', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
    ],
    [],
  );
  root.setProperty('temperature', 21.5);
  root.setProperty('label', 'sensor-A');
  root.setProperty('tags', ['alpha', 'beta']);
  tree.setRoot(root);

  const catalogue = buildCatalogue(dtReg, entReg);
  const identReg = new IdentityRegistry();
  identReg.registerNode('root', true);
  identReg.registerClass('MySensor');

  return { tree, catalogue, identReg, dtReg, entReg };
}

// ---------------------------------------------------------------------------
// PropertyIdMap for MySensor (level 3, indices 1-3)
// ---------------------------------------------------------------------------

const PROP_MAP: PropertyIdMap = {
  resolvePropertyName(oid: number, level: number, index: number): string | undefined {
    if (level !== 3) return undefined;
    const names = ['temperature', 'label', 'tags'];
    return names[index - 1];
  },
  resolvePropertyId(oid: number, name: string): { level: number; index: number } | undefined {
    const idx = ['temperature', 'label', 'tags'].indexOf(name);
    if (idx === -1) return undefined;
    return { level: 3, index: idx + 1 };
  },
  isReadOnly(oid: number, propName: string): boolean {
    return propName === 'label';
  },
  isSequence(oid: number, propName: string): boolean {
    return propName === 'tags';
  },
  touchpoints(): unknown[] | null {
    return null;
  },
};

const OID_ROOT = 1;

function makeCtx(overrides: Partial<DispatchContext> = {}): DispatchContext {
  const { tree, catalogue, identReg } = makeTree();
  return {
    oid: OID_ROOT,
    methodId: NC_OBJECT_METHOD.Get,
    args: {},
    tree,
    bus: new UceBus(),
    catalogue,
    identityRegistry: identReg,
    adapterId: 'nmos-test',
    correlationId: randomUUID(),
    userLabels: new Map(),
    propMap: PROP_MAP,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// E11.T3 — Core MS-05 objects
// ---------------------------------------------------------------------------

describe('E11.T3 — NcClassManager', () => {
  it('GetDatatype returns a known datatype descriptor', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      args: { name: 'NcFloat64' },
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.Ok);
    expect((result as { value: unknown }).value).toMatchObject({ type: 0, name: 'NcFloat64' });
  });

  it('GetDatatype returns error for unknown datatype', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      args: { name: 'NoSuchType' },
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.BadOid);
  });

  it('GetDatatype returns error when name argument missing', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
      args: {},
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('GetControlClass returns a known class descriptor', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
      args: { classId: [1, 0, 1] },
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.Ok);
    const desc = (result as { value: unknown }).value as { name: string };
    expect(desc.name).toBe('MySensor');
  });

  it('GetControlClass returns error for unknown classId', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
      args: { classId: [9, 9] },
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.BadOid);
  });

  it('GetControlClass returns error when classId argument missing', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
      args: {},
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('unknown class manager method returns MethodNotImplemented', () => {
    const ctx = makeCtx({
      oid: OID_CLASS_MANAGER,
      methodId: { level: 3, index: 99 },
      args: {},
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.MethodNotImplemented);
  });
});

describe('E11.T3 — NcDeviceManager', () => {
  it('Get on NcDeviceManager returns Ok', () => {
    const ctx = makeCtx({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      args: { id: { level: 1, index: 2 } },
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.Ok);
  });

  it('Set on NcDeviceManager read-only level-1 property returns Readonly', () => {
    const ctx = makeCtx({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Set,
      args: { id: { level: 1, index: 1 }, value: 'x' }, // classId is read-only
    });
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.Readonly);
  });
});

// ---------------------------------------------------------------------------
// E11.T4 — NcObject generic methods
// ---------------------------------------------------------------------------

describe('E11.T4 — NcObject.Get', () => {
  it('returns current property value', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Get, args: { id: { level: 3, index: 1 } } });
    const result = dispatch(ctx, PROP_MAP) as { status: number; value: unknown };
    expect(result.status).toBe(NcMethodStatus.Ok);
    expect(result.value).toBe(21.5);
  });

  it('returns null for read-only property that was never set (engine rejects setProperty)', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Get, args: { id: { level: 3, index: 2 } } });
    const result = dispatch(ctx, PROP_MAP) as { status: number; value: unknown };
    expect(result.status).toBe(NcMethodStatus.Ok);
    expect(result.value).toBeNull(); // read_only=true → setProperty rejected → value never stored
  });

  it('returns array property value', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Get, args: { id: { level: 3, index: 3 } } });
    const result = dispatch(ctx, PROP_MAP) as { status: number; value: unknown };
    expect(result.value).toEqual(['alpha', 'beta']);
  });

  it('returns PropertyNotImplemented for unknown property id', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Get, args: { id: { level: 3, index: 99 } } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.PropertyNotImplemented);
  });

  it('returns BadCommandFormat when id argument missing', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Get, args: {} });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('returns BadOid for unknown oid', () => {
    const { tree, catalogue, identReg } = makeTree();
    const ctx: DispatchContext = {
      oid: 999,
      methodId: NC_OBJECT_METHOD.Get,
      args: { id: { level: 3, index: 1 } },
      tree, bus: new UceBus(), catalogue,
      identityRegistry: identReg,
      adapterId: 'nmos', correlationId: randomUUID(),
      userLabels: new Map(), propMap: PROP_MAP,
    };
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.BadOid);
  });
});

describe('E11.T4 — NcObject.Set', () => {
  it('publishes SetPropertyOp and returns Ok', () => {
    const { tree, catalogue, identReg } = makeTree();
    const bus = new UceBus();
    const ops: unknown[] = [];
    bus.subscribe({ op: 'setProperty' }, (op) => { ops.push(op); });

    const ctx: DispatchContext = {
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      args: { id: { level: 3, index: 1 }, value: 99.9 },
      tree, bus, catalogue,
      identityRegistry: identReg,
      adapterId: 'nmos', correlationId: randomUUID(),
      userLabels: new Map(), propMap: PROP_MAP,
    };
    const result = dispatch(ctx, PROP_MAP);
    expect(result.status).toBe(NcMethodStatus.Ok);
    expect(ops).toHaveLength(1);
    expect((ops[0] as { property: string; value: unknown }).property).toBe('temperature');
    expect((ops[0] as { property: string; value: unknown }).value).toBe(99.9);
  });

  it('returns Readonly for read-only property', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Set, args: { id: { level: 3, index: 2 }, value: 'new' } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.Readonly);
  });

  it('returns BadCommandFormat when id missing', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.Set, args: { value: 1 } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('sets origin to adapterId in the published op', () => {
    const { tree, catalogue, identReg } = makeTree();
    const bus = new UceBus();
    const ops: unknown[] = [];
    bus.subscribe({ op: 'setProperty' }, (op) => { ops.push(op); });
    const ctx: DispatchContext = {
      oid: OID_ROOT, methodId: NC_OBJECT_METHOD.Set,
      args: { id: { level: 3, index: 1 }, value: 1 },
      tree, bus, catalogue, identityRegistry: identReg,
      adapterId: 'my-adapter', correlationId: 'corr-1',
      userLabels: new Map(), propMap: PROP_MAP,
    };
    dispatch(ctx, PROP_MAP);
    expect((ops[0] as { origin: string }).origin).toBe('my-adapter');
    expect((ops[0] as { correlationId: string }).correlationId).toBe('corr-1');
  });
});

describe('E11.T4 — Sequence methods', () => {
  it('GetSequenceItem returns element at index', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.GetSequenceItem, args: { id: { level: 3, index: 3 }, index: 0 } });
    const result = dispatch(ctx, PROP_MAP) as { value: unknown };
    expect(result.value).toBe('alpha');
  });

  it('GetSequenceItem returns IndexOutOfBounds for out-of-range index', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.GetSequenceItem, args: { id: { level: 3, index: 3 }, index: 99 } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.IndexOutOfBounds);
  });

  it('GetSequenceItem returns BadCommandFormat on non-sequence property', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.GetSequenceItem, args: { id: { level: 3, index: 1 }, index: 0 } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('SetSequenceItem updates element and publishes op', () => {
    const { tree, catalogue, identReg } = makeTree();
    const bus = new UceBus();
    const ops: unknown[] = [];
    bus.subscribe({ op: 'setProperty' }, (op) => { ops.push(op); });
    const ctx: DispatchContext = {
      oid: OID_ROOT, methodId: NC_OBJECT_METHOD.SetSequenceItem,
      args: { id: { level: 3, index: 3 }, index: 1, value: 'gamma' },
      tree, bus, catalogue, identityRegistry: identReg,
      adapterId: 'nmos', correlationId: randomUUID(),
      userLabels: new Map(), propMap: PROP_MAP,
    };
    dispatch(ctx, PROP_MAP);
    expect(ops).toHaveLength(1);
    expect((ops[0] as { value: unknown }).value).toEqual(['alpha', 'gamma']);
  });

  it('SetSequenceItem returns IndexOutOfBounds for out-of-range', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.SetSequenceItem, args: { id: { level: 3, index: 3 }, index: 99, value: 'x' } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.IndexOutOfBounds);
  });

  it('SetSequenceItem returns Readonly for read-only array', () => {
    const roMap: PropertyIdMap = { ...PROP_MAP, isReadOnly: () => true };
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.SetSequenceItem, args: { id: { level: 3, index: 3 }, index: 0, value: 'x' } });
    expect(dispatch(ctx, roMap).status).toBe(NcMethodStatus.Readonly);
  });

  it('AddSequenceItem appends and returns new index', () => {
    const { tree, catalogue, identReg } = makeTree();
    const bus = new UceBus();
    const ops: unknown[] = [];
    bus.subscribe({ op: 'setProperty' }, (op) => { ops.push(op); });
    const ctx: DispatchContext = {
      oid: OID_ROOT, methodId: NC_OBJECT_METHOD.AddSequenceItem,
      args: { id: { level: 3, index: 3 }, value: 'gamma' },
      tree, bus, catalogue, identityRegistry: identReg,
      adapterId: 'nmos', correlationId: randomUUID(),
      userLabels: new Map(), propMap: PROP_MAP,
    };
    const result = dispatch(ctx, PROP_MAP) as { id: number };
    expect(result.id).toBe(2); // previous length = 2 → new item index = 2
    expect((ops[0] as { value: unknown }).value).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('AddSequenceItem returns Readonly on read-only', () => {
    const roMap: PropertyIdMap = { ...PROP_MAP, isReadOnly: () => true };
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.AddSequenceItem, args: { id: { level: 3, index: 3 }, value: 'x' } });
    expect(dispatch(ctx, roMap).status).toBe(NcMethodStatus.Readonly);
  });

  it('RemoveSequenceItem removes element and publishes op', () => {
    const { tree, catalogue, identReg } = makeTree();
    const bus = new UceBus();
    const ops: unknown[] = [];
    bus.subscribe({ op: 'setProperty' }, (op) => { ops.push(op); });
    const ctx: DispatchContext = {
      oid: OID_ROOT, methodId: NC_OBJECT_METHOD.RemoveSequenceItem,
      args: { id: { level: 3, index: 3 }, index: 0 },
      tree, bus, catalogue, identityRegistry: identReg,
      adapterId: 'nmos', correlationId: randomUUID(),
      userLabels: new Map(), propMap: PROP_MAP,
    };
    dispatch(ctx, PROP_MAP);
    expect((ops[0] as { value: unknown }).value).toEqual(['beta']);
  });

  it('RemoveSequenceItem returns IndexOutOfBounds for out-of-range', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.RemoveSequenceItem, args: { id: { level: 3, index: 3 }, index: 99 } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.IndexOutOfBounds);
  });

  it('GetSequenceLength returns array length', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.GetSequenceLength, args: { id: { level: 3, index: 3 } } });
    const result = dispatch(ctx, PROP_MAP) as { value: unknown };
    expect(result.value).toBe(2);
  });

  it('GetSequenceLength returns BadCommandFormat for non-sequence', () => {
    const ctx = makeCtx({ methodId: NC_OBJECT_METHOD.GetSequenceLength, args: { id: { level: 3, index: 1 } } });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('unknown NcObject method index returns MethodNotImplemented', () => {
    const ctx = makeCtx({ methodId: { level: 1, index: 99 }, args: {} });
    expect(dispatch(ctx, PROP_MAP).status).toBe(NcMethodStatus.MethodNotImplemented);
  });
});
