/**
 * Entity Definition model — Architecture.md §4.1 / §4.3–§4.4.
 * Covers E3.T3.
 *
 * An EntityDefinition is a reusable class descriptor authored up-front.
 * It has a name, a list of typed property slots, and a list of method slots.
 * No protocol-specific identifiers may appear here.
 */

import type { BaseType, ValueConstraints } from './Datatype.js';

// ---------------------------------------------------------------------------
// E3.T3 — PropertyDef
// ---------------------------------------------------------------------------

/** A single property slot in an EntityDefinition. */
export interface PropertyDef {
  /** Unique identifier within the entity. */
  id: string;
  type: BaseType;
  /** When true, the property value is an array of this type. Default: false. */
  is_array?: boolean;
  /** Required when type === 'object'; names a DatatypeDefinition. */
  type_def?: string;
  /** Default: false — the property can be written via setProperty(). */
  read_only?: boolean;
  /** Default: true — changes are published on the bus. */
  observable?: boolean;
  /** Default: false — the property may hold null. */
  nullable?: boolean;
  constraints?: ValueConstraints;
  description?: string;
}

// ---------------------------------------------------------------------------
// E3.T3 — ArgDef / ReturnDef / MethodDef
// ---------------------------------------------------------------------------

/** A single argument in a MethodDef. */
export interface ArgDef {
  id: string;
  type: BaseType;
  is_array?: boolean;
  type_def?: string;
  description?: string;
}

/** The return-value descriptor for a MethodDef. type === null means void. */
export interface ReturnDef {
  type: BaseType | null;
  is_array?: boolean;
  type_def?: string;
  description?: string;
}

/** A single method slot in an EntityDefinition. */
export interface MethodDef {
  id: string;
  args: ArgDef[];
  return_value: ReturnDef;
  description?: string;
}

// ---------------------------------------------------------------------------
// E3.T3 — EntityDefinition
// ---------------------------------------------------------------------------

/**
 * A reusable entity class descriptor.
 * Instances in the tree reference this by `entity_def` name.
 */
export interface EntityDefinition {
  /** Unique name; referenced as `entity_def` in instance nodes. */
  entity_name: string;
  properties: PropertyDef[];
  methods: MethodDef[];
  description?: string;
}
