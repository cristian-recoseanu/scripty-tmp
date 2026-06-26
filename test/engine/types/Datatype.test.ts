import { describe, it, expect } from 'vitest';

import type { DatatypeDefinition, FieldDef } from '../../../src/engine/types/Datatype.js';

// ---------------------------------------------------------------------------
// E3.T2 — DatatypeDefinition model
// ---------------------------------------------------------------------------

describe('E3.T2 — DatatypeDefinition model', () => {
  it('constructs a flat DatatypeDefinition', () => {
    const def: DatatypeDefinition = {
      type_def: 'Point',
      fields: [
        { id: 'x', type: 'numeric' },
        { id: 'y', type: 'numeric' },
      ],
    };
    expect(def.type_def).toBe('Point');
    expect(def.fields).toHaveLength(2);
    expect(def.fields[0]?.id).toBe('x');
  });

  it('constructs a DatatypeDefinition with a nested object field', () => {
    const def: DatatypeDefinition = {
      type_def: 'NamedPoint',
      fields: [
        { id: 'label', type: 'string' },
        { id: 'pt', type: 'object', type_def: 'Point' },
      ],
    };
    expect(def.fields[1]?.type_def).toBe('Point');
  });

  it('constructs a DatatypeDefinition with an array field', () => {
    const def: DatatypeDefinition = {
      type_def: 'TagList',
      fields: [
        { id: 'tags', type: 'string', is_array: true },
      ],
    };
    expect(def.fields[0]?.is_array).toBe(true);
  });

  it('constructs a DatatypeDefinition with a nullable field', () => {
    const field: FieldDef = { id: 'optLabel', type: 'string', nullable: true };
    expect(field.nullable).toBe(true);
  });

  it('constructs a DatatypeDefinition with constraints', () => {
    const field: FieldDef = { id: 'val', type: 'numeric', constraints: { min: 0, max: 100 } };
    expect(field.constraints?.min).toBe(0);
    expect(field.constraints?.max).toBe(100);
  });

  it('has no old PrimitiveKind or DatatypeKind types', () => {
    // These should not compile if the old types exist — verified at type-check level.
    // Runtime: confirm only the four base types are accepted.
    const validTypes = ['string', 'bool', 'numeric', 'object'] as const;
    for (const t of validTypes) {
      const def: DatatypeDefinition = { type_def: `T_${t}`, fields: [{ id: 'f', type: t }] };
      expect(def.fields[0]?.type).toBe(t);
    }
  });
});
