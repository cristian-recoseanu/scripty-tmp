/**
 * Codec — marshal/unmarshal ModelValue to/from JSON-compatible representation.
 * Covers E4.T2 and E4.T3.
 *
 * Design:
 *  - marshal:   ModelValue → JSON-safe value (deep clone with stable key ordering for objects).
 *  - unmarshal: unknown JSON input → ModelValue, validated against a typed slot descriptor.
 *
 * Numeric precision policy (E4.T3):
 *  - The engine's `numeric` type is a JSON number (IEEE 754 double).
 *  - Values within Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER are lossless.
 *  - Values outside that range are accepted but flagged with a precision warning.
 *  - Width / precision mapping to protocol-specific types (NcFloat64, NcInt32, …) is deferred
 *    to the Egress adapter and is NOT the codec's responsibility.
 *  - NaN and Infinity are rejected — they are not valid JSON numbers.
 *
 * No protocol-specific identifiers may appear in this file.
 */

import type { ModelValue } from '../model/ObjectNode.js';
import type { BaseType } from '../types/Datatype.js';

// ---------------------------------------------------------------------------
// SlotDescriptor — the typed-slot shape shared by properties / args / returns
// ---------------------------------------------------------------------------

export interface SlotDescriptor {
  type: BaseType;
  is_array: boolean;
  type_def?: string;
  nullable?: boolean;
}

// ---------------------------------------------------------------------------
// Codec result types
// ---------------------------------------------------------------------------

export interface MarshalResult {
  ok: true;
  value: ModelValue;
}

export interface UnmarshalOk {
  ok: true;
  value: ModelValue;
  /** Non-empty when a numeric value is outside the safe-integer range. */
  warnings: string[];
}

export interface UnmarshalError {
  ok: false;
  reason: string;
}

export type UnmarshalResult = UnmarshalOk | UnmarshalError;

// ---------------------------------------------------------------------------
// E4.T2 — marshal (ModelValue → JSON-safe)
// ---------------------------------------------------------------------------

/**
 * Deep-clones a ModelValue into a JSON-safe form.
 * Objects have their keys sorted deterministically (E4.T1 key-ordering guarantee).
 */
export function marshal(value: ModelValue): MarshalResult {
  return { ok: true, value: _marshalValue(value) };
}

function _marshalValue(value: ModelValue): ModelValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(_marshalValue);
  // object — sort keys for determinism
  const sorted: { [key: string]: ModelValue } = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    sorted[key] = v !== undefined ? _marshalValue(v) : null;
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// E4.T2 + E4.T3 — unmarshal (unknown → ModelValue with slot validation)
// ---------------------------------------------------------------------------

/**
 * Parses and validates a raw JSON-decoded value against a slot descriptor.
 * Returns typed errors; never throws.
 */
export function unmarshal(raw: unknown, slot: SlotDescriptor): UnmarshalResult {
  const warnings: string[] = [];

  if (raw === null || raw === undefined) {
    if (slot.nullable) {
      return { ok: true, value: null, warnings };
    }
    return { ok: false, reason: `Expected ${_slotLabel(slot)} but received null/undefined` };
  }

  if (slot.is_array) {
    if (!Array.isArray(raw)) {
      return { ok: false, reason: `Expected array for ${_slotLabel(slot)} but received ${typeof raw}` };
    }
    const items: ModelValue[] = [];
    for (let i = 0; i < raw.length; i++) {
      const elementSlot: SlotDescriptor = {
        type: slot.type,
        is_array: false,
        ...(slot.type_def !== undefined ? { type_def: slot.type_def } : {}),
        ...(slot.nullable !== undefined ? { nullable: slot.nullable } : {}),
      };
      const r = unmarshal(raw[i], elementSlot);
      if (!r.ok) {
        return { ok: false, reason: `[${i}]: ${r.reason}` };
      }
      items.push(r.value);
      for (const w of r.warnings) warnings.push(`[${i}]: ${w}`);
    }
    return { ok: true, value: items, warnings };
  }

  switch (slot.type) {
    case 'string':
      if (typeof raw !== 'string') {
        return { ok: false, reason: `Expected string but received ${typeof raw}` };
      }
      return { ok: true, value: raw, warnings };

    case 'bool':
      if (typeof raw !== 'boolean') {
        return { ok: false, reason: `Expected bool but received ${typeof raw}` };
      }
      return { ok: true, value: raw, warnings };

    case 'numeric': {
      if (typeof raw !== 'number') {
        return { ok: false, reason: `Expected numeric but received ${typeof raw}` };
      }
      if (!isFinite(raw)) {
        return { ok: false, reason: `Numeric value must be finite (not NaN/Infinity); received ${raw}` };
      }
      // E4.T3 — precision warning for outside safe-integer range
      if (!Number.isSafeInteger(raw) && Number.isInteger(raw)) {
        warnings.push(
          `Numeric integer value ${raw} is outside Number.MIN_SAFE_INTEGER..MAX_SAFE_INTEGER; ` +
          `precision may be lost when used as an integer. Consider using a string representation for large integers.`,
        );
      }
      return { ok: true, value: raw, warnings };
    }

    case 'object': {
      if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
        return { ok: false, reason: `Expected object but received ${typeof raw}` };
      }
      // Deep-clone with key sorting for determinism
      const result: { [key: string]: ModelValue } = {};
      for (const key of Object.keys(raw).sort()) {
        const v = (raw as Record<string, unknown>)[key];
        const inner = _unmarshalUnknown(v);
        if (!inner.ok) {
          return { ok: false, reason: `field '${key}': ${inner.reason}` };
        }
        result[key] = inner.value;
        for (const w of inner.warnings) warnings.push(`field '${key}': ${w}`);
      }
      return { ok: true, value: result, warnings };
    }
  }
}

/** Unmarshal a raw value without a type constraint — used for nested object fields. */
function _unmarshalUnknown(raw: unknown): UnmarshalOk | UnmarshalError {
  const warnings: string[] = [];
  if (raw === null || raw === undefined) return { ok: true, value: null, warnings };
  if (typeof raw === 'string') return { ok: true, value: raw, warnings };
  if (typeof raw === 'boolean') return { ok: true, value: raw, warnings };
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return { ok: false, reason: `Numeric value must be finite; received ${raw}` };
    if (!Number.isSafeInteger(raw) && Number.isInteger(raw)) {
      warnings.push(`Numeric integer value ${raw} is outside safe-integer range.`);
    }
    return { ok: true, value: raw, warnings };
  }
  if (Array.isArray(raw)) {
    const items: ModelValue[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = _unmarshalUnknown(raw[i]);
      if (!r.ok) return { ok: false, reason: `[${i}]: ${r.reason}` };
      items.push(r.value);
      for (const w of r.warnings) warnings.push(`[${i}]: ${w}`);
    }
    return { ok: true, value: items, warnings };
  }
  if (typeof raw === 'object') {
    const result: { [key: string]: ModelValue } = {};
    for (const key of Object.keys(raw).sort()) {
      const v = (raw as Record<string, unknown>)[key];
      const r = _unmarshalUnknown(v);
      if (!r.ok) return { ok: false, reason: `field '${key}': ${r.reason}` };
      result[key] = r.value;
      for (const w of r.warnings) warnings.push(`field '${key}': ${w}`);
    }
    return { ok: true, value: result, warnings };
  }
  return { ok: false, reason: `Unsupported value type: ${typeof raw}` };
}

function _slotLabel(slot: SlotDescriptor): string {
  const arr = slot.is_array ? '[]' : '';
  const td = slot.type_def ? `<${slot.type_def}>` : '';
  return `${slot.type}${td}${arr}`;
}
