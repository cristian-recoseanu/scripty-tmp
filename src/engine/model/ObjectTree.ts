/**
 * InstanceTree — the global registry for all nodes in the UCE.
 * Provides O(1) path lookup. Path is derived from the location chain from root.
 * Covers E3.T4.
 */

import type { InstanceNode, SerializedNode } from './ObjectNode.js';
import type { InstanceNodeImpl } from './ObjectNodeImpl.js';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ObjectTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectTreeError';
  }
}

export type TreeLookupResult =
  | { ok: true; node: InstanceNode }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// InstanceTree (exported also as ObjectTree for backward compat)
// ---------------------------------------------------------------------------

export class InstanceTree {
  /** O(1) path → node index. */
  private readonly _byPath = new Map<string, InstanceNodeImpl>();
  private _root: InstanceNodeImpl | undefined;

  // -------------------------------------------------------------------------
  // Root management
  // -------------------------------------------------------------------------

  setRoot(node: InstanceNodeImpl): void {
    if (this._root !== undefined) {
      throw new ObjectTreeError('Root is already set');
    }
    this._root = node;
    this._index(node);
  }

  get root(): InstanceNode | undefined {
    return this._root;
  }

  // -------------------------------------------------------------------------
  // Indexing (recursive — called on add)
  // -------------------------------------------------------------------------

  private _index(node: InstanceNodeImpl): void {
    const path = node.identity.path;
    const existing = this._byPath.get(path);
    if (existing !== undefined && existing !== node) {
      throw new ObjectTreeError(
        `Duplicate path '${path}' — already registered`,
      );
    }
    this._byPath.set(path, node);
    for (const child of node.children.values()) {
      this._index(child as InstanceNodeImpl);
    }
  }

  private _deindex(node: InstanceNodeImpl): void {
    this._byPath.delete(node.identity.path);
    for (const child of node.children.values()) {
      this._deindex(child as InstanceNodeImpl);
    }
  }

  // -------------------------------------------------------------------------
  // O(1) path lookup — E3.T4
  // -------------------------------------------------------------------------

  findById(path: string): TreeLookupResult {
    const node = this._byPath.get(path);
    if (node === undefined) {
      return { ok: false, reason: `No node with path '${path}'` };
    }
    return { ok: true, node };
  }

  // -------------------------------------------------------------------------
  // Path lookup — E3.T4
  // -------------------------------------------------------------------------

  /**
   * Resolves a slash-separated location path from the root.
   * e.g. "root/sensors/temp-1"
   */
  findByPath(path: string): TreeLookupResult {
    if (this._root === undefined) {
      return { ok: false, reason: 'Tree has no root' };
    }
    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) {
      return { ok: false, reason: 'Empty path' };
    }

    if (segments[0] !== this._root.identity.location) {
      return {
        ok: false,
        reason: `Path '${path}' does not start with root location '${this._root.identity.location}'`,
      };
    }

    let current: InstanceNode = this._root;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === undefined) break;
      const child = current.children.get(seg);
      if (child === undefined) {
        return {
          ok: false,
          reason: `No child with location '${seg}' under '${current.identity.path}'`,
        };
      }
      current = child;
    }
    return { ok: true, node: current };
  }

  // -------------------------------------------------------------------------
  // Child attachment helpers (keep index consistent) — E3.T4
  // -------------------------------------------------------------------------

  /**
   * Attaches a child node to a parent (looked up by path) and updates the tree index.
   */
  attachChild(parentPath: string, child: InstanceNodeImpl): void {
    const lookup = this.findById(parentPath);
    if (!lookup.ok) {
      throw new ObjectTreeError(`Parent path '${parentPath}' not found in tree`);
    }
    const parent = lookup.node as InstanceNodeImpl;
    parent.addChild(child);
    this._index(child);
  }

  /**
   * Detaches a child node (by location) from a parent and removes it + its subtree from the index.
   */
  detachChild(parentPath: string, location: string): InstanceNode | undefined {
    const lookup = this.findById(parentPath);
    if (!lookup.ok) return undefined;
    const parent = lookup.node as InstanceNodeImpl;
    const removed = parent.removeChild(location);
    if (removed !== undefined) {
      this._deindex(removed);
    }
    return removed;
  }

  /** Total number of indexed nodes. */
  size(): number {
    return this._byPath.size;
  }

  /**
   * Deterministic full-tree serialization — E4.T1.
   * Returns null when the tree has no root.
   */
  toJSON(): SerializedNode | null {
    if (this._root === undefined) return null;
    return this._root.toJSON();
  }
}

/** @deprecated Use InstanceTree */
export const ObjectTree = InstanceTree;
/** @deprecated Use InstanceTree */
export type ObjectTree = InstanceTree;
