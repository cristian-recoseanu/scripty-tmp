/**
 * Base-type runtime validation helpers — Architecture.md §4.2.
 * Covers E3.T1 — four base types: string, bool, numeric, object.
 *
 * No protocol-specific identifiers may appear here.
 * Integer width / float precision are egress-mapping concerns and do not
 * belong in the engine.
 */

import type { BaseType } from './Datatype.js';

// ---------------------------------------------------------------------------
// Value type
// ---------------------------------------------------------------------------

/** A runtime scalar value for the four UCE base types (non-array form). */
export type BaseValue = string | boolean | number | Record<string, unknown> | null;

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export interface BaseTypeError {
  kind: 'wrong-type' | 'not-finite';
  reason: string;
}

export type BaseTypeValidationResult = { ok: true } | { ok: false; error: BaseTypeError };

// ---------------------------------------------------------------------------
// E3.T1 — validateBaseTypeValue
// ---------------------------------------------------------------------------

/**
 * Validates that a runtime value matches the expected BaseType.
 *
 * Rules:
 *  - `string`  → must be a JS string
 *  - `bool`    → must be a JS boolean
 *  - `numeric` → must be a finite JS number (NaN / ±Infinity rejected)
 *  - `object`  → must be a plain object (non-null, non-array);
 *                structural validation against a type_def is done by the value validator.
 */
export function validateBaseTypeValue(
  type: BaseType,
  value: unknown,
): BaseTypeValidationResult {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        return { ok: false, error: { kind: 'wrong-type', reason: `expected string, got ${typeof value}` } };
      }
      return { ok: true };

    case 'bool':
      if (typeof value !== 'boolean') {
        return { ok: false, error: { kind: 'wrong-type', reason: `expected boolean, got ${typeof value}` } };
      }
      return { ok: true };

    case 'numeric':
      if (typeof value !== 'number') {
        return { ok: false, error: { kind: 'wrong-type', reason: `expected number, got ${typeof value}` } };
      }
      if (!isFinite(value)) {
        return { ok: false, error: { kind: 'not-finite', reason: `numeric value must be finite (got ${value})` } };
      }
      return { ok: true };

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {
          ok: false,
          error: {
            kind: 'wrong-type',
            reason: `expected a plain object, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`,
          },
        };
      }
      return { ok: true };
  }
}
