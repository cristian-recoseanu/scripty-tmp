/**
 * Registry for EntityDefinition entries.
 * Supports register/lookup and cross-reference validation against a DatatypeRegistry.
 * Covers E3.T3.
 */

import type { BaseType } from './Datatype.js';
import type { DatatypeRegistry } from './DatatypeRegistry.js';
import type { EntityDefinition, PropertyDef, ArgDef, ReturnDef } from './EntityDefinition.js';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class EntityRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityRegistryError';
  }
}

// ---------------------------------------------------------------------------
// EntityRegistry
// ---------------------------------------------------------------------------

export class EntityRegistry {
  private readonly _entities = new Map<string, EntityDefinition>();

  /**
   * Register an EntityDefinition. Throws if the entity_name is already registered.
   */
  register(def: EntityDefinition): void {
    if (this._entities.has(def.entity_name)) {
      throw new EntityRegistryError(`Entity '${def.entity_name}' is already registered`);
    }
    this._entities.set(def.entity_name, def);
  }

  /**
   * Look up an EntityDefinition by entity_name. Throws if not found.
   */
  get(name: string): EntityDefinition {
    const def = this._entities.get(name);
    if (def === undefined) {
      throw new EntityRegistryError(`Entity '${name}' is not registered`);
    }
    return def;
  }

  /** Returns true if an entity with this name is registered. */
  has(name: string): boolean {
    return this._entities.has(name);
  }

  /** All registered entity_name values. */
  names(): string[] {
    return Array.from(this._entities.keys());
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validates all registered EntityDefinitions against the provided DatatypeRegistry.
   * Checks that every 'object' slot has a type_def that resolves in the datatype registry.
   * Returns a list of error messages (empty = all OK).
   */
  validate(datatypeRegistry: DatatypeRegistry): string[] {
    const errors: string[] = [];

    for (const entity of this._entities.values()) {
      const ctx = `Entity '${entity.entity_name}'`;

      for (const prop of entity.properties) {
        errors.push(...this._validateSlot(prop, `${ctx} property '${prop.id}'`, datatypeRegistry));
      }

      for (const method of entity.methods) {
        for (const arg of method.args) {
          errors.push(...this._validateSlot(arg, `${ctx} method '${method.id}' arg '${arg.id}'`, datatypeRegistry));
        }
        errors.push(...this._validateReturnSlot(method.return_value, `${ctx} method '${method.id}' return_value`, datatypeRegistry));
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _validateSlot(
    slot: PropertyDef | ArgDef,
    label: string,
    dtReg: DatatypeRegistry,
  ): string[] {
    return this._checkObjectSlot(slot.type, slot.type_def, label, dtReg);
  }

  private _validateReturnSlot(
    slot: ReturnDef,
    label: string,
    dtReg: DatatypeRegistry,
  ): string[] {
    if (slot.type === null) return [];
    return this._checkObjectSlot(slot.type, slot.type_def, label, dtReg);
  }

  private _checkObjectSlot(
    type: BaseType | null,
    type_def: string | undefined,
    label: string,
    dtReg: DatatypeRegistry,
  ): string[] {
    if (type !== 'object') return [];
    if (type_def === undefined) {
      return [`${label}: type is 'object' but no type_def is specified`];
    }
    if (!dtReg.has(type_def)) {
      return [`${label}: type_def '${type_def}' is not registered in the DatatypeRegistry`];
    }
    return [];
  }
}
