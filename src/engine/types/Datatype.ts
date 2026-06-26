/**
 * Protocol-neutral UCE type system — Architecture.md §4.2.
 * NO protocol-specific numeric widths or identifiers may appear here.
 */

// ---------------------------------------------------------------------------
// E3.T1 — BaseType
// ---------------------------------------------------------------------------

/**
 * The four canonical base types in the UCE.
 * Integer width / float precision is an egress-mapping concern; `numeric`
 * is a single JSON-number type at the engine level.
 */
export type BaseType = 'string' | 'bool' | 'numeric' | 'object';

// ---------------------------------------------------------------------------
// E3.T2 — ValueConstraints (retained; numeric min/max/step, string, array)
// ---------------------------------------------------------------------------

/** Constraints applicable to numeric, string, and array-typed values. */
export interface ValueConstraints {
  /** Inclusive minimum — applies to numeric values. */
  min?: number;
  /** Inclusive maximum — applies to numeric values. */
  max?: number;
  /** Legal step between allowed numeric values. */
  step?: number;
  /** Minimum string length (inclusive). */
  minLength?: number;
  /** Maximum string length (inclusive). */
  maxLength?: number;
  /** ECMAScript-compatible regular expression the string must match. */
  pattern?: string;
  /** Minimum array length (inclusive). */
  minItems?: number;
  /** Maximum array length (inclusive). */
  maxItems?: number;
}

// ---------------------------------------------------------------------------
// E3.T2 — FieldDef (field inside a DatatypeDefinition)
// ---------------------------------------------------------------------------

/** A single field within a `DatatypeDefinition`. */
export interface FieldDef {
  /** Unique identifier within the containing type_def. */
  id: string;
  type: BaseType;
  /** When true, the field value is an array of this type. */
  is_array?: boolean;
  /** Required when type === 'object'; names a DatatypeDefinition. */
  type_def?: string;
  /** When true, the field may be null. */
  nullable?: boolean;
  constraints?: ValueConstraints;
  description?: string;
}

// ---------------------------------------------------------------------------
// E3.T2 — DatatypeDefinition
// ---------------------------------------------------------------------------

/**
 * A reusable object shape (struct) identified by `type_def`.
 * Fields may reference other DatatypeDefinitions recursively.
 */
export interface DatatypeDefinition {
  /** Unique name; referenced as `type_def` in PropertyDef / FieldDef. */
  type_def: string;
  fields: FieldDef[];
  description?: string;
}
