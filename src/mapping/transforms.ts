/**
 * E8.T4 — Transform pipeline: round, scale, enum-map, template, clamp.
 *
 * Each transform is a pure function (ModelValue → ModelValue | TransformError).
 * The pipeline applies transforms in order; any error short-circuits.
 */

import type { ModelValue } from '../engine/model/ObjectNode.js';

import type { TransformDescriptor } from './types.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TransformSuccess {
  ok: true;
  value: ModelValue;
}

export interface TransformError {
  ok: false;
  reason: string;
}

export type TransformResult = TransformSuccess | TransformError;

// ---------------------------------------------------------------------------
// Single transform application
// ---------------------------------------------------------------------------

function applyOne(value: ModelValue, t: TransformDescriptor): TransformResult {
  switch (t.op) {
    case 'round': {
      if (typeof value !== 'number') {
        return { ok: false, reason: `round: expected number, got ${typeof value}` };
      }
      const factor = Math.pow(10, t.decimals);
      return { ok: true, value: Math.round(value * factor) / factor };
    }

    case 'scale': {
      if (typeof value !== 'number') {
        return { ok: false, reason: `scale: expected number, got ${typeof value}` };
      }
      return { ok: true, value: value * t.factor };
    }

    case 'enum-map': {
      const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (!(key in t.map)) {
        return {
          ok: false,
          reason: `enum-map: no mapping for value '${key}'. Known keys: ${Object.keys(t.map).join(', ')}`,
        };
      }
      return { ok: true, value: t.map[key] as ModelValue };
    }

    case 'template': {
      const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const rendered = t.template.replace(/\{\$value\}/g, str);
      return { ok: true, value: rendered };
    }

    case 'clamp': {
      if (typeof value !== 'number') {
        return { ok: false, reason: `clamp: expected number, got ${typeof value}` };
      }
      return { ok: true, value: Math.min(t.max, Math.max(t.min, value)) };
    }
  }
}

// ---------------------------------------------------------------------------
// E8.T4 — applyTransforms() — pipeline
// ---------------------------------------------------------------------------

/**
 * Apply a sequence of transforms to a value.
 * Returns the final value on success, or the first error encountered.
 */
export function applyTransforms(
  value: ModelValue,
  transforms: TransformDescriptor[],
): TransformResult {
  let current: ModelValue = value;
  for (const t of transforms) {
    const result = applyOne(current, t);
    if (!result.ok) return result;
    current = result.value;
  }
  return { ok: true, value: current };
}
