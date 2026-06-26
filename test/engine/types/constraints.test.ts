import { describe, it, expect } from 'vitest';

import {
  validateConstraints,
  validateNumeric,
  validateString,
  validateSequenceLength,
} from '../../../src/engine/types/constraints.js';

// ---------------------------------------------------------------------------
// E1.T3 — Constraint model & validators
// ---------------------------------------------------------------------------

describe('E1.T3 — validateNumeric', () => {
  it('passes when value is within range', () => {
    expect(validateNumeric(5, { min: 0, max: 10 }, 'val')).toEqual([]);
  });

  it('fails when value is below min', () => {
    const violations = validateNumeric(-1, { min: 0 }, 'val');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('below minimum');
    expect(violations[0]?.path).toBe('val');
  });

  it('fails when value exceeds max', () => {
    const violations = validateNumeric(11, { max: 10 }, 'val');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('exceeds maximum');
  });

  it('passes at exact boundary values', () => {
    expect(validateNumeric(0, { min: 0, max: 10 }, 'val')).toEqual([]);
    expect(validateNumeric(10, { min: 0, max: 10 }, 'val')).toEqual([]);
  });

  it('passes when value aligns to step', () => {
    expect(validateNumeric(4, { min: 0, step: 2 }, 'val')).toEqual([]);
  });

  it('fails when value does not align to step', () => {
    const violations = validateNumeric(3, { min: 0, step: 2 }, 'val');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('step');
  });
});

describe('E1.T3 — validateString', () => {
  it('passes a valid string', () => {
    expect(validateString('hello', { minLength: 3, maxLength: 10 }, 'val')).toEqual([]);
  });

  it('fails when string is too short', () => {
    const violations = validateString('ab', { minLength: 3 }, 'val');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('minLength');
  });

  it('fails when string is too long', () => {
    const violations = validateString('abcdefgh', { maxLength: 5 }, 'val');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('maxLength');
  });

  it('passes when string matches pattern', () => {
    expect(validateString('abc123', { pattern: '^[a-z0-9]+$' }, 'val')).toEqual([]);
  });

  it('fails when string does not match pattern', () => {
    const violations = validateString('ABC', { pattern: '^[a-z]+$' }, 'val');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('pattern');
  });

  it('passes at exact minLength boundary', () => {
    expect(validateString('abc', { minLength: 3 }, 'val')).toEqual([]);
  });

  it('passes at exact maxLength boundary', () => {
    expect(validateString('abcde', { maxLength: 5 }, 'val')).toEqual([]);
  });
});

describe('E1.T3 — validateSequenceLength', () => {
  it('passes a valid sequence length', () => {
    expect(validateSequenceLength(3, { minItems: 1, maxItems: 5 }, 'arr')).toEqual([]);
  });

  it('fails when sequence is too short', () => {
    const violations = validateSequenceLength(0, { minItems: 1 }, 'arr');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('minItems');
  });

  it('fails when sequence is too long', () => {
    const violations = validateSequenceLength(6, { maxItems: 5 }, 'arr');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain('maxItems');
  });
});

describe('E1.T3 — validateConstraints (dispatcher)', () => {
  it('returns ok:true for a number within range', () => {
    const result = validateConstraints(5, { min: 0, max: 10 });
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with violations for a number out of range', () => {
    const result = validateConstraints(-1, { min: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:true for a valid string', () => {
    const result = validateConstraints('hello', { minLength: 1 });
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for a valid array length', () => {
    const result = validateConstraints([1, 2, 3], { maxItems: 5 });
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for non-constrained types (boolean)', () => {
    const result = validateConstraints(true, { min: 0 });
    expect(result.ok).toBe(true);
  });
});
