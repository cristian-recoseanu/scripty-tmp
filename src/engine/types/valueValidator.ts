/**
 * Value model validation — Architecture.md §4.2.
 * Covers E3.T5 — validates a ModelValue against a typed slot descriptor.
 *
 * No protocol-specific identifiers may appear here.
 */

import { validateConstraints } from './constraints.js';
import { validateBaseTypeValue } from './primitives.js';

import type { BaseType, FieldDef, ValueConstraints } from './Datatype.js';
import type { DatatypeRegistry } from './DatatypeRegistry.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ValueViolation {
  path: string;
  reason: string;
}

export type ValueValidationResult =
  | { ok: true }
  | { ok: false; violations: ValueViolation[] };

// ---------------------------------------------------------------------------
// Slot descriptor (minimal — matches PropertyDescriptor / ArgDef shape)
// ---------------------------------------------------------------------------

export interface SlotDescriptor {
  type: BaseType;
  is_array?: boolean;
  type_def?: string;
  nullable?: boolean;
  constraints?: ValueConstraints;
}

// ---------------------------------------------------------------------------
// E3.T5 — validateModelValue
// ---------------------------------------------------------------------------

/**
 * Validates a runtime `ModelValue` against a typed slot descriptor.
 *
 * - Handles null (allowed only when nullable === true).
 * - Handles arrays (when is_array === true) with per-element validation.
 * - Handles `object` type recursively against the named type_def fields.
 * - Applies ValueConstraints for numeric/string/array slots.
 */
export function validateModelValue(
  value: unknown,
  slot: SlotDescriptor,
  dtReg: DatatypeRegistry,
  path = '',
): ValueValidationResult {
  const violations: ValueViolation[] = [];

  // null check
  if (value === null || value === undefined) {
    if (!slot.nullable) {
      violations.push({ path, reason: 'value is null but the slot is not nullable' });
    }
    return violations.length === 0 ? { ok: true } : { ok: false, violations };
  }

  // array check
  if (slot.is_array) {
    if (!Array.isArray(value)) {
      return {
        ok: false,
        violations: [{ path, reason: `expected an array, got ${typeof value}` }],
      };
    }
    // constraints on array length
    if (slot.constraints) {
      const cr = validateConstraints(value, slot.constraints, path);
      if (!cr.ok) violations.push(...cr.violations);
    }
    // validate each element
    const elemSlot: SlotDescriptor = { type: slot.type, is_array: false, nullable: false, ...(slot.type_def !== undefined ? { type_def: slot.type_def } : {}) };
    for (let i = 0; i < value.length; i++) {
      const r = validateModelValue(value[i], elemSlot, dtReg, `${path}[${i}]`);
      if (!r.ok) violations.push(...r.violations);
    }
    return violations.length === 0 ? { ok: true } : { ok: false, violations };
  }

  // scalar base-type check
  const btResult = validateBaseTypeValue(slot.type, value);
  if (!btResult.ok) {
    return { ok: false, violations: [{ path, reason: btResult.error.reason }] };
  }

  // object: recursive field validation against type_def
  if (slot.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      return { ok: false, violations: [{ path, reason: 'expected a plain object' }] };
    }
    const obj = value as Record<string, unknown>;
    if (slot.type_def !== undefined) {
      if (!dtReg.has(slot.type_def)) {
        return { ok: false, violations: [{ path, reason: `type_def '${slot.type_def}' is not registered` }] };
      }
      const fields: FieldDef[] = dtReg.getFields(slot.type_def);
      for (const field of fields) {
        const fieldPath = path ? `${path}.${field.id}` : field.id;
        const fieldSlot: SlotDescriptor = {
          type: field.type,
          is_array: field.is_array ?? false,
          nullable: field.nullable ?? false,
          ...(field.type_def !== undefined ? { type_def: field.type_def } : {}),
          ...(field.constraints !== undefined ? { constraints: field.constraints } : {}),
        };
        const r = validateModelValue(obj[field.id], fieldSlot, dtReg, fieldPath);
        if (!r.ok) violations.push(...r.violations);
      }
    }
    return violations.length === 0 ? { ok: true } : { ok: false, violations };
  }

  // scalar constraints (numeric / string)
  if (slot.constraints) {
    const cr = validateConstraints(value, slot.constraints, path);
    if (!cr.ok) violations.push(...cr.violations);
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
