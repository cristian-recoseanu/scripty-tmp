/**
 * Runtime constraint validation for UCE values.
 * Returns typed errors with a dot-separated path and human-readable reason.
 */

import type { ValueConstraints } from './Datatype.js';

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export interface ConstraintViolation {
  path: string;
  reason: string;
}

export type ConstraintResult = { ok: true } | { ok: false; violations: ConstraintViolation[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(path: string, reason: string): ConstraintViolation {
  return { path, reason };
}

// ---------------------------------------------------------------------------
// Numeric constraints
// ---------------------------------------------------------------------------

export function validateNumeric(
  value: number,
  constraints: ValueConstraints,
  path: string,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (constraints.min !== undefined && value < constraints.min) {
    violations.push(fail(path, `value ${value} is below minimum ${constraints.min}`));
  }
  if (constraints.max !== undefined && value > constraints.max) {
    violations.push(fail(path, `value ${value} exceeds maximum ${constraints.max}`));
  }
  if (constraints.step !== undefined && constraints.step > 0) {
    const base = constraints.min ?? 0;
    const remainder = Math.abs((value - base) % constraints.step);
    const epsilon = 1e-10;
    if (remainder > epsilon && Math.abs(remainder - constraints.step) > epsilon) {
      violations.push(
        fail(path, `value ${value} does not align to step ${constraints.step} from base ${base}`),
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// String constraints
// ---------------------------------------------------------------------------

export function validateString(
  value: string,
  constraints: ValueConstraints,
  path: string,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (constraints.minLength !== undefined && value.length < constraints.minLength) {
    violations.push(
      fail(path, `string length ${value.length} is below minLength ${constraints.minLength}`),
    );
  }
  if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
    violations.push(
      fail(path, `string length ${value.length} exceeds maxLength ${constraints.maxLength}`),
    );
  }
  if (constraints.pattern !== undefined) {
    const re = new RegExp(constraints.pattern);
    if (!re.test(value)) {
      violations.push(fail(path, `value does not match pattern /${constraints.pattern}/`));
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Sequence (array) constraints
// ---------------------------------------------------------------------------

export function validateSequenceLength(
  length: number,
  constraints: ValueConstraints,
  path: string,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (constraints.minItems !== undefined && length < constraints.minItems) {
    violations.push(
      fail(path, `sequence length ${length} is below minItems ${constraints.minItems}`),
    );
  }
  if (constraints.maxItems !== undefined && length > constraints.maxItems) {
    violations.push(
      fail(path, `sequence length ${length} exceeds maxItems ${constraints.maxItems}`),
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Top-level dispatcher — validates a raw JS value against constraints
// ---------------------------------------------------------------------------

export function validateConstraints(
  value: unknown,
  constraints: ValueConstraints,
  path = '',
): ConstraintResult {
  const violations: ConstraintViolation[] = [];

  if (typeof value === 'number') {
    violations.push(...validateNumeric(value, constraints, path));
  } else if (typeof value === 'string') {
    violations.push(...validateString(value, constraints, path));
  } else if (Array.isArray(value)) {
    violations.push(...validateSequenceLength(value.length, constraints, path));
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
