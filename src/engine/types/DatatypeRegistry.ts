/**
 * Registry for DatatypeDefinition (type_def) entries.
 * Supports register/lookup, cross-reference validation, and cycle detection.
 * Covers E3.T2.
 */

import type { DatatypeDefinition, FieldDef } from './Datatype.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DatatypeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatatypeRegistryError';
  }
}

// ---------------------------------------------------------------------------
// DatatypeRegistry
// ---------------------------------------------------------------------------

export class DatatypeRegistry {
  private readonly _types = new Map<string, DatatypeDefinition>();

  /**
   * Register a DatatypeDefinition. Throws if the type_def name is already registered.
   */
  register(def: DatatypeDefinition): void {
    if (this._types.has(def.type_def)) {
      throw new DatatypeRegistryError(`Datatype '${def.type_def}' is already registered`);
    }
    this._types.set(def.type_def, def);
  }

  /**
   * Look up a DatatypeDefinition by type_def name. Throws with the missing name if not found.
   */
  get(name: string): DatatypeDefinition {
    const dt = this._types.get(name);
    if (dt === undefined) {
      throw new DatatypeRegistryError(`Datatype '${name}' is not registered`);
    }
    return dt;
  }

  /** Returns true if a type_def with this name is registered. */
  has(name: string): boolean {
    return this._types.has(name);
  }

  /** All registered type_def names. */
  names(): string[] {
    return Array.from(this._types.keys());
  }

  // -------------------------------------------------------------------------
  // Field retrieval
  // -------------------------------------------------------------------------

  /**
   * Returns the fields of a registered DatatypeDefinition.
   * Throws if not found.
   */
  getFields(name: string): FieldDef[] {
    return this.get(name).fields;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validates all registered DatatypeDefinitions for cross-reference integrity
   * and cycle detection. Returns a list of error messages (empty = all OK).
   */
  validate(): string[] {
    const errors: string[] = [];

    for (const dt of this._types.values()) {
      this._validateDef(dt.type_def, new Set(), errors);
    }

    return errors;
  }

  /**
   * Checks a single type_def for unresolved field references and cycles.
   * `visiting` tracks the current DFS path for cycle detection.
   */
  private _validateDef(
    name: string,
    visiting: Set<string>,
    errors: string[],
  ): void {
    if (visiting.has(name)) {
      errors.push(`Cyclic type_def reference detected involving '${name}' (chain: ${[...visiting].join(' → ')})`);
      return;
    }
    const dt = this._types.get(name);
    if (dt === undefined) {
      errors.push(`type_def '${name}' is not registered`);
      return;
    }

    visiting.add(name);

    for (const field of dt.fields) {
      if (field.type === 'object') {
        if (field.type_def === undefined) {
          errors.push(`type_def '${name}': field '${field.id}' has type 'object' but no type_def`);
        } else {
          this._validateDef(field.type_def, new Set(visiting), errors);
        }
      }
    }

    visiting.delete(name);
  }
}
