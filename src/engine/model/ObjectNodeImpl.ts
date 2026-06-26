/**
 * Concrete implementation of InstanceNode.
 * Covers E3.T4 (node ops / nesting) and E3.T7 (serialization).
 */

import type {
  ArgumentBag,
  GetResult,
  InstanceIdentity,
  InstanceNode,
  MethodDescriptor,
  MethodResult,
  ModelValue,
  PropertyDescriptor,
  SerializedNode,
  SetResult,
} from './ObjectNode.js';

// ---------------------------------------------------------------------------
// Method handler type — registered at construction for invoke() dispatch
// ---------------------------------------------------------------------------

export type MethodHandler = (args: ArgumentBag) => Promise<MethodResult>;

// ---------------------------------------------------------------------------
// InstanceNodeImpl
// ---------------------------------------------------------------------------

export class InstanceNodeImpl implements InstanceNode {
  readonly identity: InstanceIdentity;
  readonly properties: ReadonlyMap<string, PropertyDescriptor>;
  readonly methods: ReadonlyMap<string, MethodDescriptor>;

  private readonly _values = new Map<string, ModelValue>();
  private readonly _children = new Map<string, InstanceNodeImpl>();
  private readonly _handlers = new Map<string, MethodHandler>();

  constructor(
    identity: InstanceIdentity,
    properties: PropertyDescriptor[],
    methods: MethodDescriptor[],
    handlers?: Map<string, MethodHandler>,
  ) {
    this.identity = identity;
    this.properties = new Map(properties.map((p) => [p.id, p]));
    this.methods = new Map(methods.map((m) => [m.id, m]));
    if (handlers) {
      for (const [k, h] of handlers) {
        this._handlers.set(k, h);
      }
    }
    // initialise array properties with empty arrays
    for (const p of properties) {
      if (p.is_array) {
        this._values.set(p.id, []);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Package-internal accessors (used by snapshot/restore — E4.T4)
  // -------------------------------------------------------------------------

  /** Returns the internal value map for direct read/write (restore path only). */
  _getRawValues(): Map<string, ModelValue> {
    return this._values;
  }

  // -------------------------------------------------------------------------
  // InstanceNode.children — E3.T4
  // -------------------------------------------------------------------------

  get children(): ReadonlyMap<string, InstanceNode> {
    return this._children;
  }

  // -------------------------------------------------------------------------
  // isBlock — E3.T4
  // -------------------------------------------------------------------------

  isBlock(): boolean {
    return this._children.size > 0;
  }

  // -------------------------------------------------------------------------
  // getProperty — E3.T4
  // -------------------------------------------------------------------------

  getProperty(id: string): GetResult {
    const desc = this.properties.get(id);
    if (desc === undefined) {
      // Schema-less restore path: a value may have been injected without a descriptor.
      const raw = this._values.get(id);
      if (raw === undefined) {
        return { ok: false, status: 'not-found', message: `Property '${id}' does not exist` };
      }
      return { ok: true, status: 'ok', value: raw };
    }
    const value = this._values.get(id);
    if (value === undefined) {
      return { ok: true, status: 'ok', value: desc.is_array ? [] : null };
    }
    return { ok: true, status: 'ok', value };
  }

  // -------------------------------------------------------------------------
  // setProperty — E3.T4
  // -------------------------------------------------------------------------

  setProperty(id: string, value: ModelValue): SetResult {
    const desc = this.properties.get(id);
    if (desc === undefined) {
      return { ok: false, status: 'not-found', message: `Property '${id}' does not exist` };
    }
    if (desc.read_only) {
      return { ok: false, status: 'read-only', message: `Property '${id}' is read-only` };
    }
    return this._writeValue(id, desc.is_array, value);
  }

  forceSetProperty(id: string, value: ModelValue): SetResult {
    const desc = this.properties.get(id);
    if (desc === undefined) {
      return { ok: false, status: 'not-found', message: `Property '${id}' does not exist` };
    }
    return this._writeValue(id, desc.is_array, value);
  }

  private _writeValue(id: string, isArray: boolean, value: ModelValue): SetResult {
    if (isArray && !Array.isArray(value)) {
      return {
        ok: false,
        status: 'type-mismatch',
        message: `Property '${id}' is an array — expected an array value`,
      };
    }
    if (!isArray && Array.isArray(value)) {
      return {
        ok: false,
        status: 'type-mismatch',
        message: `Property '${id}' is not an array — received an array value`,
      };
    }
    this._values.set(id, value);
    return { ok: true, status: 'ok' };
  }

  // -------------------------------------------------------------------------
  // invoke — E3.T4
  // -------------------------------------------------------------------------

  async invoke(methodId: string, args: ArgumentBag): Promise<MethodResult> {
    const desc = this.methods.get(methodId);
    if (desc === undefined) {
      return { status: 404, errorMessage: `Method '${methodId}' does not exist` };
    }
    const handler = this._handlers.get(methodId);
    if (handler === undefined) {
      return { status: 501, errorMessage: `Method '${methodId}' has no registered handler` };
    }
    return handler(args);
  }

  // -------------------------------------------------------------------------
  // Child management — E3.T4
  // -------------------------------------------------------------------------

  /**
   * Adds a child node. Throws if a sibling with the same location already exists.
   */
  addChild(node: InstanceNodeImpl): void {
    const loc = node.identity.location;
    if (this._children.has(loc)) {
      throw new Error(
        `Duplicate sibling location '${loc}' under node '${this.identity.path}'`,
      );
    }
    this._children.set(loc, node);
  }

  /**
   * Removes a child by location. Returns the removed node (or undefined if not found).
   */
  removeChild(location: string): InstanceNodeImpl | undefined {
    const child = this._children.get(location);
    if (child !== undefined) {
      this._children.delete(location);
    }
    return child;
  }

  // -------------------------------------------------------------------------
  // E3.T7 — toJSON (deterministic serialization matching instantiated-tree format)
  // -------------------------------------------------------------------------

  toJSON(): SerializedNode {
    // Collect all known property ids: descriptor-registered + any raw-value-only (restore path)
    const knownIds = new Set<string>(this.properties.keys());
    for (const id of this._values.keys()) knownIds.add(id);

    const properties = Array.from(knownIds).map((id) => ({
      id,
      value: this._values.get(id) ?? (this.properties.get(id)?.is_array ? [] : null),
    }));

    const methods = Array.from(this.methods.keys());

    const children = Array.from(this._children.values()).map((c) => c.toJSON());

    return {
      location: this.identity.location,
      entity_def: this.identity.entity_def,
      properties,
      methods,
      children,
    };
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible alias (for tree code that still uses the old name)
// ---------------------------------------------------------------------------

/** @deprecated Use InstanceNodeImpl */
export const ObjectNodeImpl = InstanceNodeImpl;
/** @deprecated Use InstanceNodeImpl */
export type ObjectNodeImpl = InstanceNodeImpl;
