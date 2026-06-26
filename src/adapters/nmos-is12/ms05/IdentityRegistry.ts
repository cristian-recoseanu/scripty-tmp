/**
 * E11.T2 — Identity registry.
 *
 * Assigns stable numeric oids (node path ↔ oid) and classIds
 * (entity_def name ↔ classId array) within a single run.
 *
 * Rules:
 *   - Root node always gets oid 1.
 *   - NcDeviceManager gets oid 2, NcClassManager gets oid 3 (fixed MS-05 convention).
 *   - All other nodes are assigned sequentially from oid 4 upward.
 *   - classId: [1, N] where N is the 1-based registration order.
 *   - No ids leak into the engine — this registry lives entirely in the adapter.
 */

// ---------------------------------------------------------------------------
// Well-known oids (MS-05 convention)
// ---------------------------------------------------------------------------

export const OID_ROOT = 1;
export const OID_DEVICE_MANAGER = 2;
export const OID_CLASS_MANAGER = 3;
const OID_FIRST_USER = 4;

// ---------------------------------------------------------------------------
// IdentityRegistryError
// ---------------------------------------------------------------------------

export class IdentityRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityRegistryError';
  }
}

// ---------------------------------------------------------------------------
// IdentityRegistry
// ---------------------------------------------------------------------------

export class IdentityRegistry {
  private _nextOid = OID_FIRST_USER;

  /** node path → oid */
  private readonly _pathToOid = new Map<string, number>();
  /** oid → node path */
  private readonly _oidToPath = new Map<number, string>();

  /** entity_def name → classId array */
  private readonly _entityToClassId = new Map<string, readonly number[]>();
  /** classId key → entity_def name  (key = JSON.stringify(classId)) */
  private readonly _classIdKeyToEntity = new Map<string, string>();

  constructor() {
    // Reserve oids 1–3 for root and built-in managers
    this._pathToOid.set('__root__', OID_ROOT);
    this._oidToPath.set(OID_ROOT, '__root__');
    this._pathToOid.set('__deviceManager__', OID_DEVICE_MANAGER);
    this._oidToPath.set(OID_DEVICE_MANAGER, '__deviceManager__');
    this._pathToOid.set('__classManager__', OID_CLASS_MANAGER);
    this._oidToPath.set(OID_CLASS_MANAGER, '__classManager__');
  }

  // -------------------------------------------------------------------------
  // Node path ↔ oid
  // -------------------------------------------------------------------------

  /**
   * Register a node path and return its assigned oid.
   * The root path is special-cased to oid 1.
   * Calling with the same path twice returns the same oid.
   */
  registerNode(path: string, isRoot = false): number {
    const existing = this._pathToOid.get(path);
    if (existing !== undefined) return existing;

    const oid = isRoot ? OID_ROOT : this._nextOid++;
    if (isRoot) {
      // Re-map the root path key to the real root path string
      this._pathToOid.delete('__root__');
      this._oidToPath.delete(OID_ROOT);
    }
    this._pathToOid.set(path, oid);
    this._oidToPath.set(oid, path);
    return oid;
  }

  /** Look up the oid for a node path. Throws if not registered. */
  oidForPath(path: string): number {
    const oid = this._pathToOid.get(path);
    if (oid === undefined) {
      throw new IdentityRegistryError(`No oid registered for node path '${path}'`);
    }
    return oid;
  }

  /** Look up the node path for an oid. Returns undefined if not found. */
  pathForOid(oid: number): string | undefined {
    return this._oidToPath.get(oid);
  }

  /** Returns true if the oid is known. */
  hasOid(oid: number): boolean {
    return this._oidToPath.has(oid);
  }

  /** Returns all registered oids (including root and managers). */
  allOids(): number[] {
    return [...this._oidToPath.keys()];
  }

  // -------------------------------------------------------------------------
  // entity_def ↔ classId
  // -------------------------------------------------------------------------

  /**
   * Register an entity_def name and return its assigned classId.
   * classId = [1, N] where N is the 1-based registration sequence.
   * Calling with the same name twice returns the same classId.
   */
  registerClass(entityName: string): readonly number[] {
    const existing = this._entityToClassId.get(entityName);
    if (existing !== undefined) return existing;

    const n = this._entityToClassId.size + 1;
    const classId = [1, n] as const;
    this._entityToClassId.set(entityName, classId);
    this._classIdKeyToEntity.set(JSON.stringify(classId), entityName);
    return classId;
  }

  /** Look up classId for an entity_def name. Throws if not registered. */
  classIdForEntity(entityName: string): readonly number[] {
    const classId = this._entityToClassId.get(entityName);
    if (classId === undefined) {
      throw new IdentityRegistryError(`No classId registered for entity '${entityName}'`);
    }
    return classId;
  }

  /** Look up entity_def name for a classId array. Returns undefined if not found. */
  entityForClassId(classId: readonly number[]): string | undefined {
    return this._classIdKeyToEntity.get(JSON.stringify(classId));
  }

  /** Returns true if the entity_def name has a registered classId. */
  hasClass(entityName: string): boolean {
    return this._entityToClassId.has(entityName);
  }

  // -------------------------------------------------------------------------
  // Bulk registration (convenience — used during adapter init)
  // -------------------------------------------------------------------------

  /** Register all paths from an iterable of [path, isRoot] pairs. */
  registerNodes(entries: Iterable<readonly [path: string, isRoot: boolean]>): void {
    for (const [path, isRoot] of entries) {
      this.registerNode(path, isRoot);
    }
  }

  /** Register all entity names from an iterable. */
  registerClasses(entityNames: Iterable<string>): void {
    for (const name of entityNames) {
      this.registerClass(name);
    }
  }
}
