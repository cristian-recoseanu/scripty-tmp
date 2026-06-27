import { describe, it, expect } from 'vitest';

import { validateBaseTypeValue } from '../../../src/engine/types/primitives.js';

import type { DatatypeDefinition } from '../../../src/engine/types/Datatype.js';

// ---------------------------------------------------------------------------
// E3.T1 — BaseType vocabulary
// ---------------------------------------------------------------------------

describe('E3.T1 — validateBaseTypeValue — string', () => {
  it('accepts a string', () => {
    expect(validateBaseTypeValue('string', 'hello').ok).toBe(true);
  });
  it('rejects a number', () => {
    const r = validateBaseTypeValue('string', 42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('wrong-type');
  });
});

describe('E3.T1 — validateBaseTypeValue — bool', () => {
  it('accepts true/false', () => {
    expect(validateBaseTypeValue('bool', true).ok).toBe(true);
    expect(validateBaseTypeValue('bool', false).ok).toBe(true);
  });
  it('rejects a number', () => {
    const r = validateBaseTypeValue('bool', 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('wrong-type');
  });
});

describe('E3.T1 — validateBaseTypeValue — numeric', () => {
  it('accepts a finite number', () => {
    expect(validateBaseTypeValue('numeric', 3.14).ok).toBe(true);
    expect(validateBaseTypeValue('numeric', 0).ok).toBe(true);
    expect(validateBaseTypeValue('numeric', -1e100).ok).toBe(true);
  });
  it('rejects NaN', () => {
    const r = validateBaseTypeValue('numeric', NaN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not-finite');
  });
  it('rejects Infinity', () => {
    const r = validateBaseTypeValue('numeric', Infinity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not-finite');
  });
  it('rejects -Infinity', () => {
    const r = validateBaseTypeValue('numeric', -Infinity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not-finite');
  });
  it('rejects a string', () => {
    const r = validateBaseTypeValue('numeric', '42');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('wrong-type');
  });
});

describe('E3.T1 — validateBaseTypeValue — object', () => {
  it('accepts a plain object', () => {
    expect(validateBaseTypeValue('object', { x: 1 }).ok).toBe(true);
    expect(validateBaseTypeValue('object', {}).ok).toBe(true);
  });
  it('rejects null', () => {
    const r = validateBaseTypeValue('object', null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('wrong-type');
  });
  it('rejects an array', () => {
    const r = validateBaseTypeValue('object', [1, 2, 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('wrong-type');
  });
  it('rejects a string', () => {
    const r = validateBaseTypeValue('object', 'text');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('wrong-type');
  });
});

describe('E3.T1 — DatatypeDefinition shape (type check)', () => {
  it('constructs a valid DatatypeDefinition', () => {
    const def: DatatypeDefinition = {
      type_def: 'MyObject',
      fields: [
        { id: 'x', type: 'numeric' },
        { id: 'label', type: 'string' },
        { id: 'flag', type: 'bool' },
      ],
    };
    expect(def.type_def).toBe('MyObject');
    expect(def.fields).toHaveLength(3);
  });

  it('constructs a nested DatatypeDefinition', () => {
    const def: DatatypeDefinition = {
      type_def: 'Outer',
      fields: [
        { id: 'inner', type: 'object', type_def: 'Inner' },
        { id: 'tags', type: 'string', is_array: true },
      ],
    };
    expect(def.fields[0]?.type_def).toBe('Inner');
    expect(def.fields[1]?.is_array).toBe(true);
  });
});
