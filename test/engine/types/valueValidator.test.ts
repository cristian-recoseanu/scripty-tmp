import { describe, it, expect, beforeEach } from 'vitest';

import type { DatatypeDefinition } from '../../../src/engine/types/Datatype.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { validateModelValue } from '../../../src/engine/types/valueValidator.js';

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

function makeReg(...defs: DatatypeDefinition[]): DatatypeRegistry {
  const reg = new DatatypeRegistry();
  for (const d of defs) reg.register(d);
  return reg;
}

// ---------------------------------------------------------------------------
// E3.T5 — scalar validation
// ---------------------------------------------------------------------------

describe('E3.T5 — scalar string', () => {
  const reg = new DatatypeRegistry();
  it('accepts a string', () => {
    expect(validateModelValue('hello', { type: 'string' }, reg).ok).toBe(true);
  });
  it('rejects a number', () => {
    const r = validateModelValue(42, { type: 'string' }, reg);
    expect(r.ok).toBe(false);
  });
});

describe('E3.T5 — scalar bool', () => {
  const reg = new DatatypeRegistry();
  it('accepts true/false', () => {
    expect(validateModelValue(true, { type: 'bool' }, reg).ok).toBe(true);
    expect(validateModelValue(false, { type: 'bool' }, reg).ok).toBe(true);
  });
  it('rejects a number', () => {
    expect(validateModelValue(1, { type: 'bool' }, reg).ok).toBe(false);
  });
});

describe('E3.T5 — scalar numeric', () => {
  const reg = new DatatypeRegistry();
  it('accepts finite numbers', () => {
    expect(validateModelValue(0, { type: 'numeric' }, reg).ok).toBe(true);
    expect(validateModelValue(3.14, { type: 'numeric' }, reg).ok).toBe(true);
  });
  it('rejects NaN', () => {
    expect(validateModelValue(NaN, { type: 'numeric' }, reg).ok).toBe(false);
  });
  it('rejects Infinity', () => {
    expect(validateModelValue(Infinity, { type: 'numeric' }, reg).ok).toBe(false);
  });
  it('applies min/max constraints', () => {
    expect(validateModelValue(5, { type: 'numeric', constraints: { min: 0, max: 10 } }, reg).ok).toBe(true);
    const r = validateModelValue(-1, { type: 'numeric', constraints: { min: 0 } }, reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.reason).toContain('below minimum');
  });
});

describe('E3.T5 — nullable', () => {
  const reg = new DatatypeRegistry();
  it('accepts null when nullable=true', () => {
    expect(validateModelValue(null, { type: 'string', nullable: true }, reg).ok).toBe(true);
  });
  it('rejects null when nullable=false', () => {
    expect(validateModelValue(null, { type: 'string', nullable: false }, reg).ok).toBe(false);
  });
  it('rejects null when nullable is omitted', () => {
    expect(validateModelValue(null, { type: 'string' }, reg).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E3.T5 — array validation
// ---------------------------------------------------------------------------

describe('E3.T5 — array of strings', () => {
  const reg = new DatatypeRegistry();
  it('accepts an array of strings', () => {
    expect(validateModelValue(['a', 'b'], { type: 'string', is_array: true }, reg).ok).toBe(true);
  });
  it('rejects a scalar when is_array=true', () => {
    expect(validateModelValue('a', { type: 'string', is_array: true }, reg).ok).toBe(false);
  });
  it('rejects an element of wrong type', () => {
    const r = validateModelValue(['a', 42], { type: 'string', is_array: true }, reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.path).toContain('[1]');
  });
  it('applies maxItems constraint', () => {
    const r = validateModelValue(['a', 'b', 'c'], { type: 'string', is_array: true, constraints: { maxItems: 2 } }, reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.reason).toContain('maxItems');
  });
});

// ---------------------------------------------------------------------------
// E3.T5 — object validation against type_def
// ---------------------------------------------------------------------------

describe('E3.T5 — object with type_def', () => {
  let reg: DatatypeRegistry;
  beforeEach(() => { reg = makeReg(pointDef); });

  it('accepts a valid Point object', () => {
    const r = validateModelValue({ x: 1, y: 2 }, { type: 'object', type_def: 'Point' }, reg);
    expect(r.ok).toBe(true);
  });

  it('rejects when a field has wrong type', () => {
    const r = validateModelValue({ x: 'bad', y: 2 }, { type: 'object', type_def: 'Point' }, reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.path).toBe('x');
  });

  it('rejects an unregistered type_def', () => {
    const r = validateModelValue({}, { type: 'object', type_def: 'Unknown' }, reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.reason).toContain("'Unknown'");
  });

  it('accepts empty object when no type_def specified', () => {
    expect(validateModelValue({}, { type: 'object' }, reg).ok).toBe(true);
  });
});

describe('E3.T5 — nested object (NamedPoint)', () => {
  let reg: DatatypeRegistry;
  beforeEach(() => { reg = makeReg(pointDef, namedPointDef); });

  it('accepts a valid nested object', () => {
    const r = validateModelValue(
      { label: 'origin', pt: { x: 0, y: 0 } },
      { type: 'object', type_def: 'NamedPoint' },
      reg,
    );
    expect(r.ok).toBe(true);
  });

  it('reports nested field violation with dotted path', () => {
    const r = validateModelValue(
      { label: 'origin', pt: { x: 'bad', y: 0 } },
      { type: 'object', type_def: 'NamedPoint' },
      reg,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.path).toBe('pt.x');
  });
});

describe('E3.T5 — array of objects', () => {
  let reg: DatatypeRegistry;
  beforeEach(() => { reg = makeReg(pointDef); });

  it('accepts an array of valid Point objects', () => {
    const r = validateModelValue(
      [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      { type: 'object', type_def: 'Point', is_array: true },
      reg,
    );
    expect(r.ok).toBe(true);
  });

  it('reports violation with element index in path', () => {
    const r = validateModelValue(
      [{ x: 1, y: 2 }, { x: 'bad', y: 4 }],
      { type: 'object', type_def: 'Point', is_array: true },
      reg,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.path).toContain('[1]');
  });
});
