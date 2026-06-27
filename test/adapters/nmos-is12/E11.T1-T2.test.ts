/**
 * E11.T1 — MS-05 datatype/class catalogue generation.
 * E11.T2 — Identity registry (node path↔oid, entity_def↔classId).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { buildCatalogue } from '../../../src/adapters/nmos-is12/ms05/catalogue.js';
import {
  IdentityRegistry,
  IdentityRegistryError,
  OID_ROOT,
  OID_DEVICE_MANAGER,
  OID_CLASS_MANAGER,
} from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';

import type { DatatypeDefinition } from '../../../src/engine/types/Datatype.js';
import type { EntityDefinition } from '../../../src/engine/types/EntityDefinition.js';


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntityDef(overrides?: Partial<EntityDefinition>): EntityDefinition {
  return {
    entity_name: 'MySensor',
    properties: [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: true, observable: false, nullable: false },
      { id: 'active', type: 'bool', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    methods: [
      { id: 'reset', args: [], return_value: { type: null } },
      {
        id: 'setLabel',
        args: [{ id: 'value', type: 'string' }],
        return_value: { type: 'string' },
      },
    ],
    ...overrides,
  };
}

function makeTypeDef(overrides?: Partial<DatatypeDefinition>): DatatypeDefinition {
  return {
    type_def: 'MyPoint',
    fields: [
      { id: 'x', type: 'numeric' },
      { id: 'y', type: 'numeric' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// E11.T1 — buildCatalogue
// ---------------------------------------------------------------------------

describe('E11.T1 — buildCatalogue', () => {
  let dtReg: DatatypeRegistry;
  let entReg: EntityRegistry;

  beforeEach(() => {
    dtReg = new DatatypeRegistry();
    entReg = new EntityRegistry();
  });

  it('includes built-in primitive descriptors', () => {
    const cat = buildCatalogue(dtReg, entReg);
    expect(cat.datatypes.has('NcFloat64')).toBe(true);
    expect(cat.datatypes.has('NcString')).toBe(true);
    expect(cat.datatypes.has('NcBoolean')).toBe(true);
    expect(cat.datatypes.get('NcFloat64')?.type).toBe('Primitive');
  });

  it('maps UCE numeric to NcFloat64', () => {
    const cat = buildCatalogue(dtReg, entReg);
    const prim = cat.datatypes.get('NcFloat64');
    expect(prim?.type).toBe('Primitive');
  });

  it('projects a type_def DatatypeDefinition as a Struct descriptor', () => {
    dtReg.register(makeTypeDef());
    const cat = buildCatalogue(dtReg, entReg);
    const desc = cat.datatypes.get('MyPoint');
    expect(desc?.type).toBe('Struct');
  });

  it('struct descriptor has correct fields', () => {
    dtReg.register(makeTypeDef());
    const cat = buildCatalogue(dtReg, entReg);
    const desc = cat.datatypes.get('MyPoint');
    expect(desc?.type).toBe('Struct');
    if (desc?.type !== 'Struct') return;
    expect(desc.fields).toHaveLength(2);
    expect(desc.fields[0]?.name).toBe('x');
    expect(desc.fields[0]?.typeName).toBe('NcFloat64');
    expect(desc.fields[1]?.name).toBe('y');
  });

  it('preserves nested object field as type_def name', () => {
    dtReg.register(makeTypeDef());
    dtReg.register({
      type_def: 'Composite',
      fields: [{ id: 'point', type: 'object', type_def: 'MyPoint' }],
    });
    const cat = buildCatalogue(dtReg, entReg);
    const desc = cat.datatypes.get('Composite');
    expect(desc?.type).toBe('Struct');
    if (desc?.type !== 'Struct') return;
    expect(desc.fields[0]?.typeName).toBe('MyPoint');
  });

  it('projects an EntityDefinition as a class descriptor', () => {
    entReg.register(makeEntityDef());
    const cat = buildCatalogue(dtReg, entReg);
    expect(cat.classes.has('MySensor')).toBe(true);
  });

  it('class descriptor has correct properties', () => {
    entReg.register(makeEntityDef());
    const cat = buildCatalogue(dtReg, entReg);
    const cls = cat.classes.get('MySensor');
    expect(cls?.properties).toHaveLength(3);
    const tempProp = cls?.properties[0];
    expect(tempProp?.name).toBe('temperature');
    expect(tempProp?.typeName).toBe('NcFloat64');
    expect(tempProp?.isReadOnly).toBe(false);
    expect(tempProp?.isSequence).toBe(false);
  });

  it('read-only property maps isReadOnly correctly', () => {
    entReg.register(makeEntityDef());
    const cat = buildCatalogue(dtReg, entReg);
    const cls = cat.classes.get('MySensor');
    const labelProp = cls?.properties[1];
    expect(labelProp?.isReadOnly).toBe(true);
  });

  it('bool property maps to NcBoolean', () => {
    entReg.register(makeEntityDef());
    const cat = buildCatalogue(dtReg, entReg);
    const cls = cat.classes.get('MySensor');
    const activeProp = cls?.properties[2];
    expect(activeProp?.typeName).toBe('NcBoolean');
  });

  it('class descriptor has correct methods', () => {
    entReg.register(makeEntityDef());
    const cat = buildCatalogue(dtReg, entReg);
    const cls = cat.classes.get('MySensor');
    expect(cls?.methods).toHaveLength(2);
    const resetMethod = cls?.methods[0];
    expect(resetMethod?.name).toBe('reset');
    // NcMethodDescriptor.resultDatatype is isNullable:false per MS-05-02.
    // Methods with no return value use 'NcMethodResult' (status-only wrapper).
    expect(resetMethod?.resultDatatype).toBe('NcMethodResult');
    expect(resetMethod?.parameters).toHaveLength(0);
  });

  it('method with args maps parameters', () => {
    entReg.register(makeEntityDef());
    const cat = buildCatalogue(dtReg, entReg);
    const cls = cat.classes.get('MySensor');
    const setLabel = cls?.methods[1];
    expect(setLabel?.parameters).toHaveLength(1);
    expect(setLabel?.parameters[0]?.name).toBe('value');
    expect(setLabel?.parameters[0]?.typeName).toBe('NcString');
    expect(setLabel?.resultDatatype).toBe('NcString');
  });

  it('object-type property maps to type_def name', () => {
    dtReg.register(makeTypeDef());
    entReg.register({
      entity_name: 'WithObject',
      properties: [{ id: 'pos', type: 'object', type_def: 'MyPoint' }],
      methods: [],
    });
    const cat = buildCatalogue(dtReg, entReg);
    const cls = cat.classes.get('WithObject');
    expect(cls?.properties[0]?.typeName).toBe('MyPoint');
  });

  it('classId is [1, 0, N] for user entity at position N (authority key 0 = vendor)', () => {
    entReg.register(makeEntityDef({ entity_name: 'A' }));
    entReg.register(makeEntityDef({ entity_name: 'B' }));
    const cat = buildCatalogue(dtReg, entReg);
    expect(cat.classes.get('A')?.classId).toEqual([1, 0, 1]);
    expect(cat.classes.get('B')?.classId).toEqual([1, 0, 2]);
  });

  it('array property maps isSequence=true', () => {
    entReg.register({
      entity_name: 'WithArray',
      properties: [{ id: 'tags', type: 'string', is_array: true }],
      methods: [],
    });
    const cat = buildCatalogue(dtReg, entReg);
    const prop = cat.classes.get('WithArray')?.properties[0];
    expect(prop?.isSequence).toBe(true);
  });

  it('empty registries produce standard datatypes and standard classes', () => {
    const cat = buildCatalogue(dtReg, entReg);
    expect(cat.datatypes.size).toBeGreaterThan(3); // standard + NcFloat64, NcString, NcBoolean
    expect(cat.classes.size).toBeGreaterThanOrEqual(6); // 6 standard classes
    expect(cat.classes.has('NcObject')).toBe(true);
    expect(cat.classes.has('NcBlock')).toBe(true);
    expect(cat.classes.has('NcDeviceManager')).toBe(true);
    expect(cat.classes.has('NcClassManager')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E11.T2 — IdentityRegistry
// ---------------------------------------------------------------------------

describe('E11.T2 — IdentityRegistry', () => {
  let reg: IdentityRegistry;

  beforeEach(() => {
    reg = new IdentityRegistry();
  });

  it('root node gets oid 1', () => {
    const oid = reg.registerNode('root', true);
    expect(oid).toBe(OID_ROOT);
  });

  it('device manager sentinel has oid 2', () => {
    expect(OID_DEVICE_MANAGER).toBe(2);
  });

  it('class manager sentinel has oid 3', () => {
    expect(OID_CLASS_MANAGER).toBe(3);
  });

  it('non-root nodes get oids starting at 4', () => {
    reg.registerNode('root', true);
    const oid = reg.registerNode('root/child-1');
    expect(oid).toBeGreaterThanOrEqual(4);
  });

  it('same path returns the same oid on repeated calls', () => {
    const a = reg.registerNode('root/sensor');
    const b = reg.registerNode('root/sensor');
    expect(a).toBe(b);
  });

  it('different paths get different oids', () => {
    const a = reg.registerNode('root/a');
    const b = reg.registerNode('root/b');
    expect(a).not.toBe(b);
  });

  it('oidForPath returns the assigned oid', () => {
    const oid = reg.registerNode('root/x');
    expect(reg.oidForPath('root/x')).toBe(oid);
  });

  it('oidForPath throws for unknown path', () => {
    expect(() => reg.oidForPath('no/such/path')).toThrow(IdentityRegistryError);
  });

  it('pathForOid returns the path for a known oid', () => {
    const oid = reg.registerNode('root/y');
    expect(reg.pathForOid(oid)).toBe('root/y');
  });

  it('pathForOid returns undefined for unknown oid', () => {
    expect(reg.pathForOid(9999)).toBeUndefined();
  });

  it('hasOid returns true for registered oid', () => {
    const oid = reg.registerNode('root/z');
    expect(reg.hasOid(oid)).toBe(true);
  });

  it('hasOid returns false for unknown oid', () => {
    expect(reg.hasOid(9999)).toBe(false);
  });

  it('registerClass assigns [1, 1] to first entity', () => {
    const classId = reg.registerClass('MySensor');
    expect(classId).toEqual([1, 1]);
  });

  it('registerClass assigns sequential N for each entity', () => {
    reg.registerClass('A');
    const classId = reg.registerClass('B');
    expect(classId).toEqual([1, 2]);
  });

  it('same entity name returns same classId', () => {
    const a = reg.registerClass('A');
    const b = reg.registerClass('A');
    expect(a).toEqual(b);
  });

  it('classIdForEntity returns the assigned classId', () => {
    reg.registerClass('MySensor');
    expect(reg.classIdForEntity('MySensor')).toEqual([1, 1]);
  });

  it('classIdForEntity throws for unregistered entity', () => {
    expect(() => reg.classIdForEntity('Unknown')).toThrow(IdentityRegistryError);
  });

  it('entityForClassId reverse-lookup works', () => {
    reg.registerClass('MySensor');
    expect(reg.entityForClassId([1, 1])).toBe('MySensor');
  });

  it('entityForClassId returns undefined for unknown classId', () => {
    expect(reg.entityForClassId([9, 9])).toBeUndefined();
  });

  it('hasClass returns true after registerClass', () => {
    reg.registerClass('A');
    expect(reg.hasClass('A')).toBe(true);
  });

  it('hasClass returns false for unregistered entity', () => {
    expect(reg.hasClass('Nope')).toBe(false);
  });

  it('registerNodes bulk-registers an iterable', () => {
    reg.registerNodes([
      ['root', true],
      ['root/child', false],
    ]);
    expect(reg.oidForPath('root')).toBe(OID_ROOT);
    expect(reg.hasOid(reg.oidForPath('root/child'))).toBe(true);
  });

  it('registerClasses bulk-registers an iterable', () => {
    reg.registerClasses(['Foo', 'Bar', 'Baz']);
    expect(reg.classIdForEntity('Foo')).toEqual([1, 1]);
    expect(reg.classIdForEntity('Bar')).toEqual([1, 2]);
    expect(reg.classIdForEntity('Baz')).toEqual([1, 3]);
  });

  it('oid assignment is stable: second registration of same path is a no-op', () => {
    const first = reg.registerNode('root/stable');
    reg.registerNode('root/stable');
    const third = reg.oidForPath('root/stable');
    expect(first).toBe(third);
  });
});
