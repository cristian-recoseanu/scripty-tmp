import { describe, it, expect, beforeEach } from 'vitest';

import type { DatatypeDefinition } from '../../../src/engine/types/Datatype.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import type { EntityDefinition } from '../../../src/engine/types/EntityDefinition.js';
import { EntityRegistry, EntityRegistryError } from '../../../src/engine/types/EntityRegistry.js';

// ---------------------------------------------------------------------------
// Fixtures — mirrors MyRoot-entity-definition.json
// ---------------------------------------------------------------------------

const myObjectDef: DatatypeDefinition = {
  type_def: 'MyObject',
  fields: [
    { id: 'x', type: 'numeric' },
    { id: 'label', type: 'string' },
  ],
};

const myRootDef: EntityDefinition = {
  entity_name: 'MyRoot',
  properties: [
    { id: 'p1', type: 'string', is_array: false },
    { id: 'p2', type: 'bool', is_array: false },
    { id: 'p3', type: 'numeric', is_array: false },
    { id: 'p4', type: 'object', type_def: 'MyObject', is_array: false },
    { id: 'p5', type: 'string', is_array: true },
  ],
  methods: [
    {
      id: 'm1',
      args: [{ id: 'a1', type: 'string', is_array: false }],
      return_value: { type: 'string', is_array: false },
    },
  ],
};

const voidMethodEntity: EntityDefinition = {
  entity_name: 'Controller',
  properties: [],
  methods: [
    {
      id: 'reset',
      args: [],
      return_value: { type: null, is_array: false },
    },
  ],
};

// ---------------------------------------------------------------------------
// E3.T3 — EntityRegistry
// ---------------------------------------------------------------------------

describe('E3.T3 — EntityRegistry register/lookup', () => {
  let reg: EntityRegistry;
  beforeEach(() => { reg = new EntityRegistry(); });

  it('registers and retrieves an entity by entity_name', () => {
    reg.register(myRootDef);
    expect(reg.get('MyRoot')).toBe(myRootDef);
  });

  it('has() returns true for registered entities', () => {
    reg.register(myRootDef);
    expect(reg.has('MyRoot')).toBe(true);
    expect(reg.has('Unknown')).toBe(false);
  });

  it('throws EntityRegistryError on duplicate entity_name', () => {
    reg.register(myRootDef);
    expect(() => reg.register(myRootDef)).toThrow(EntityRegistryError);
    expect(() => reg.register(myRootDef)).toThrow("'MyRoot' is already registered");
  });

  it('throws EntityRegistryError for missing entity on get()', () => {
    expect(() => reg.get('Missing')).toThrow(EntityRegistryError);
    expect(() => reg.get('Missing')).toThrow("'Missing' is not registered");
  });

  it('names() returns all registered entity names', () => {
    reg.register(myRootDef);
    reg.register(voidMethodEntity);
    expect(reg.names()).toContain('MyRoot');
    expect(reg.names()).toContain('Controller');
    expect(reg.names()).toHaveLength(2);
  });
});

describe('E3.T3 — EntityRegistry validate()', () => {
  let dtReg: DatatypeRegistry;
  let reg: EntityRegistry;

  beforeEach(() => {
    dtReg = new DatatypeRegistry();
    dtReg.register(myObjectDef);
    reg = new EntityRegistry();
  });

  it('returns empty errors for a fully consistent entity', () => {
    reg.register(myRootDef);
    expect(reg.validate(dtReg)).toEqual([]);
  });

  it('returns empty errors for a void-method entity', () => {
    reg.register(voidMethodEntity);
    expect(reg.validate(dtReg)).toEqual([]);
  });

  it('reports error for object property missing type_def', () => {
    const broken: EntityDefinition = {
      entity_name: 'Broken',
      properties: [{ id: 'obj', type: 'object', is_array: false, read_only: false, observable: true, nullable: false }],
      methods: [],
    };
    reg.register(broken);
    const errors = reg.validate(dtReg);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("no type_def");
  });

  it('reports error for object property referencing unknown type_def', () => {
    const broken: EntityDefinition = {
      entity_name: 'Broken',
      properties: [{ id: 'obj', type: 'object', type_def: 'NoSuch', is_array: false, read_only: false, observable: true, nullable: false }],
      methods: [],
    };
    reg.register(broken);
    const errors = reg.validate(dtReg);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("'NoSuch'");
  });

  it('reports error for object method arg referencing unknown type_def', () => {
    const broken: EntityDefinition = {
      entity_name: 'Broken',
      properties: [],
      methods: [
        {
          id: 'm',
          args: [{ id: 'a', type: 'object', type_def: 'NoSuch', is_array: false }],
          return_value: { type: null, is_array: false },
        },
      ],
    };
    reg.register(broken);
    const errors = reg.validate(dtReg);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("'NoSuch'");
  });

  it('builds the MyRoot example without errors', () => {
    reg.register(myRootDef);
    expect(reg.validate(dtReg)).toEqual([]);
    const def = reg.get('MyRoot');
    expect(def.properties).toHaveLength(5);
    expect(def.methods).toHaveLength(1);
    expect(def.methods[0]?.return_value.type).toBe('string');
  });
});
