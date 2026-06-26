/**
 * Protocol-neutral instance-node interfaces — Architecture.md §4.1–4.4.
 * NO protocol-specific identifiers (no oid, classId, {level,index}, etc.) may appear here.
 */

import type { BaseType, ValueConstraints } from '../types/Datatype.js';

// ---------------------------------------------------------------------------
// E3.T5 — ModelValue
// ---------------------------------------------------------------------------

/**
 * A runtime value for any UCE property/argument/return slot.
 * Matches the four base types plus array and null.
 */
export type ModelValue =
  | string
  | boolean
  | number
  | null
  | ModelValue[]
  | { [key: string]: ModelValue };

/** Named argument bag passed to invoke(). */
export type ArgumentBag = Record<string, ModelValue>;

// ---------------------------------------------------------------------------
// Result types (no throws across the API boundary)
// ---------------------------------------------------------------------------

export type SetResultStatus =
  | 'ok'
  | 'read-only'
  | 'type-mismatch'
  | 'constraint-violation'
  | 'not-found';

export interface SetResult {
  ok: boolean;
  status: SetResultStatus;
  message?: string;
}

export interface MethodResult {
  /** HTTP-style status: 200 = OK, 4xx/5xx = error — aligns with NcMethodStatus. */
  status: number;
  value?: ModelValue;
  errorMessage?: string;
}

export type GetResultStatus = 'ok' | 'not-found';

export interface GetResult {
  ok: boolean;
  status: GetResultStatus;
  value?: ModelValue;
  message?: string;
}

// ---------------------------------------------------------------------------
// E3.T4 — InstanceIdentity
// ---------------------------------------------------------------------------

export interface InstanceIdentity {
  /** Role/location name — unique among siblings. */
  location: string;
  /** References an EntityDefinition by entity_name. */
  entity_def: string;
  /**
   * Derived slash-separated path from root, e.g. "root/sensors/temp-1".
   * Used as the protocol-neutral nodeId for bus addressing.
   */
  path: string;
}

// ---------------------------------------------------------------------------
// E3.T4 — PropertyDescriptor
// ---------------------------------------------------------------------------

export interface PropertyDescriptor {
  /** Unique id within the entity (matches PropertyDef.id). */
  id: string;
  type: BaseType;
  is_array: boolean;
  /** Present when type === 'object'. */
  type_def?: string;
  read_only: boolean;
  observable: boolean;
  nullable: boolean;
  constraints?: ValueConstraints;
  description?: string;
}

// ---------------------------------------------------------------------------
// E3.T4 — MethodDescriptor
// ---------------------------------------------------------------------------

export interface ArgDescriptor {
  id: string;
  type: BaseType;
  is_array: boolean;
  type_def?: string;
  description?: string;
}

export interface MethodDescriptor {
  id: string;
  args: ArgDescriptor[];
  /** null means the method is void. */
  return_type: BaseType | null;
  return_is_array: boolean;
  return_type_def?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// E3.T7 — SerializedNode (matches instantiated-tree-values.json format)
// ---------------------------------------------------------------------------

export interface SerializedPropertyValue {
  id: string;
  value: ModelValue;
}

export interface SerializedNode {
  location: string;
  entity_def: string;
  properties: SerializedPropertyValue[];
  methods: string[];
  children: SerializedNode[];
}

// ---------------------------------------------------------------------------
// E3.T4 — InstanceNode interface
// ---------------------------------------------------------------------------

/**
 * A node in the protocol-neutral UCE instance tree.
 * Implementations must not expose any protocol-specific identifiers.
 */
export interface InstanceNode {
  readonly identity: InstanceIdentity;
  readonly properties: ReadonlyMap<string, PropertyDescriptor>;
  readonly methods: ReadonlyMap<string, MethodDescriptor>;
  /** Child nodes keyed by location — empty for leaf nodes. */
  readonly children: ReadonlyMap<string, InstanceNode>;

  getProperty(id: string): GetResult;
  setProperty(id: string, value: ModelValue): SetResult;
  /**
   * Like setProperty but skips the read_only guard.
   * Used by the engine for bus-originated ops (MQTT ingress, engine fan-out)
   * where read_only semantics are enforced at the adapter boundary, not here.
   */
  forceSetProperty(id: string, value: ModelValue): SetResult;
  invoke(methodId: string, args: ArgumentBag): Promise<MethodResult>;

  isBlock(): boolean;
  toJSON(): SerializedNode;
}
