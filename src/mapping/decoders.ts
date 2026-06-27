/**
 * E8.T3 — Decoders: json, raw-number, raw-string, custom.
 *
 * Each decoder takes a raw payload (Buffer | string) and returns a ModelValue
 * or a typed DecodeError.
 */

import type { DecodeDescriptor } from './types.js';
import type { ModelValue } from '../engine/model/ObjectNode.js';
import type { BaseType } from '../engine/types/Datatype.js';


// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DecodeSuccess {
  ok: true;
  value: ModelValue;
}

export interface DecodeError {
  ok: false;
  reason: string;
}

export type DecodeResult = DecodeSuccess | DecodeError;

// ---------------------------------------------------------------------------
// JSON Pointer (RFC-6901) resolve
// ---------------------------------------------------------------------------

function resolvePointer(obj: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return obj;
  const tokens = pointer
    .slice(pointer.startsWith('/') ? 1 : 0)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = obj;
  for (const token of tokens) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const idx = Number(token);
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Safe stringify — avoids no-base-to-string lint on unknown values
// ---------------------------------------------------------------------------

function safeStr(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object' || Array.isArray(v)) return JSON.stringify(v);
  // At this point v is string | number | boolean | symbol | bigint — String() is safe.
  return (v as { toString(): string }).toString();
}

// ---------------------------------------------------------------------------
// Coerce a raw value to a declared BaseType
// ---------------------------------------------------------------------------

function coerce(value: unknown, as: BaseType): ModelValue | undefined {
  if (value === null || value === undefined) return null;
  switch (as) {
    case 'numeric': {
      const n = Number(value);
      return isFinite(n) ? n : undefined;
    }
    case 'string':
      return safeStr(value);
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1) return true;
      if (value === 'false' || value === 0) return false;
      return undefined;
    case 'object':
      if (typeof value === 'object' && !Array.isArray(value)) return value as ModelValue;
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// E8.T3 — decode()
// ---------------------------------------------------------------------------

/**
 * Decode a raw payload according to the decode descriptor.
 *
 * @param payload — raw bytes or string from the ingress adapter.
 * @param descriptor — DecodeDescriptor from the ingress rule.
 * @returns DecodeResult (ok | error).
 */
export function decode(
  payload: Buffer | string,
  descriptor: DecodeDescriptor,
): DecodeResult {
  switch (descriptor.format) {
    case 'json': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
      } catch {
        return { ok: false, reason: 'json decode: invalid JSON' };
      }
      const raw =
        descriptor.pointer !== undefined ? resolvePointer(parsed, descriptor.pointer) : parsed;
      const coerced = coerce(raw, descriptor.as);
      if (coerced === undefined) {
        return {
          ok: false,
          reason: `json decode: cannot coerce ${safeStr(raw)} to ${descriptor.as}`,
        };
      }
      return { ok: true, value: coerced };
    }

    case 'raw-number': {
      const str = typeof payload === 'string' ? payload : payload.toString('utf8');
      const n = Number(str.trim());
      if (!isFinite(n)) {
        return { ok: false, reason: `raw-number decode: '${str}' is not a finite number` };
      }
      return { ok: true, value: n };
    }

    case 'raw-string': {
      const str = typeof payload === 'string' ? payload : payload.toString('utf8');
      return { ok: true, value: str };
    }

    case 'custom': {
      return {
        ok: false,
        reason: `custom decoder '${descriptor.handler}' must be resolved by the adapter at runtime`,
      };
    }
  }
}
