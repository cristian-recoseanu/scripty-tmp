import { describe, it, expect, beforeEach } from 'vitest';

import type { DatatypeDefinition } from '../../../src/engine/types/Datatype.js';
import {
  DatatypeRegistry,
  DatatypeRegistryError,
} from '../../../src/engine/types/DatatypeRegistry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const pointDef: DatatypeDefinition = {
  type_def: 'Point',
  fields: [
    { id: 'x', type: 'numeric' },
    { id: 'y', type: 'numeric' },
  ],
};

const namedPointDef: DatatypeDefinition = {
  type_def: 'NamedPoint',
  fields: [
    { id: 'label', type: 'string' },
    { id: 'pt', type: 'object', type_def: 'Point' },
  ],
};

// ---------------------------------------------------------------------------
// E3.T2 — DatatypeRegistry
// ---------------------------------------------------------------------------

describe('E3.T2 — DatatypeRegistry register/lookup', () => {
  let registry: DatatypeRegistry;

  beforeEach(() => {
    registry = new DatatypeRegistry();
  });

  it('registers and retrieves a type by type_def name', () => {
    registry.register(pointDef);
    expect(registry.get('Point')).toBe(pointDef);
  });

  it('has() returns true for registered types', () => {
    registry.register(pointDef);
    expect(registry.has('Point')).toBe(true);
    expect(registry.has('Unknown')).toBe(false);
  });

  it('throws DatatypeRegistryError when registering a duplicate type_def', () => {
    registry.register(pointDef);
    expect(() => registry.register(pointDef)).toThrow(DatatypeRegistryError);
    expect(() => registry.register(pointDef)).toThrow("'Point' is already registered");
  });

  it('throws DatatypeRegistryError with missing name on get()', () => {
    expect(() => registry.get('Missing')).toThrow(DatatypeRegistryError);
    expect(() => registry.get('Missing')).toThrow("'Missing' is not registered");
  });

  it('names() returns all registered type_def names', () => {
    registry.register(pointDef);
    registry.register(namedPointDef);
    expect(registry.names()).toContain('Point');
    expect(registry.names()).toContain('NamedPoint');
    expect(registry.names()).toHaveLength(2);
  });

  it('getFields() returns the fields array', () => {
    registry.register(pointDef);
    const fields = registry.getFields('Point');
    expect(fields.map((f) => f.id)).toEqual(['x', 'y']);
  });
});

describe('E3.T2 — DatatypeRegistry validate()', () => {
  let registry: DatatypeRegistry;

  beforeEach(() => {
    registry = new DatatypeRegistry();
  });

  it('returns empty errors for a fully consistent registry', () => {
    registry.register(pointDef);
    registry.register(namedPointDef);
    expect(registry.validate()).toEqual([]);
  });

  it('reports error when object field has no type_def', () => {
    const broken: DatatypeDefinition = {
      type_def: 'Broken',
      fields: [{ id: 'obj', type: 'object' }],
    };
    registry.register(broken);
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("'obj'");
  });

  it('reports error when object field references unknown type_def', () => {
    const broken: DatatypeDefinition = {
      type_def: 'Broken',
      fields: [{ id: 'obj', type: 'object', type_def: 'NoSuch' }],
    };
    registry.register(broken);
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("'NoSuch'");
  });

  it('reports error for cyclic type_def references', () => {
    const cycleA: DatatypeDefinition = {
      type_def: 'CycleA',
      fields: [{ id: 'b', type: 'object', type_def: 'CycleB' }],
    };
    const cycleB: DatatypeDefinition = {
      type_def: 'CycleB',
      fields: [{ id: 'a', type: 'object', type_def: 'CycleA' }],
    };
    registry.register(cycleA);
    registry.register(cycleB);
    const errors = registry.validate();
    expect(errors.some((e) => e.includes('Cyclic'))).toBe(true);
  });

  it('accepts array fields (is_array does not require type_def for non-object)', () => {
    const def: DatatypeDefinition = {
      type_def: 'TagList',
      fields: [{ id: 'tags', type: 'string', is_array: true }],
    };
    registry.register(def);
    expect(registry.validate()).toEqual([]);
  });
});
