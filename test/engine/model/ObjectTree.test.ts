import { describe, it, expect, beforeEach } from 'vitest';

import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree, ObjectTreeError } from '../../../src/engine/model/ObjectTree.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(location: string, path: string, entityDef = 'T'): InstanceNodeImpl {
  return new InstanceNodeImpl({ location, entity_def: entityDef, path }, [], []);
}

// ---------------------------------------------------------------------------
// E3.T4 — InstanceTree (registry + lookup)
// ---------------------------------------------------------------------------

describe('E3.T4 — InstanceTree (empty)', () => {
  it('findByPath returns error when tree has no root', () => {
    const emptyTree = new InstanceTree();
    const r = emptyTree.findByPath('root/sensor');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('no root');
  });
});

describe('E3.T4 — InstanceTree', () => {
  let tree: InstanceTree;
  let root: InstanceNodeImpl;

  beforeEach(() => {
    tree = new InstanceTree();
    root = makeNode('root', 'root');
    tree.setRoot(root);
  });

  it('root is accessible after setRoot', () => {
    expect(tree.root?.identity.location).toBe('root');
  });

  it('setRoot throws if root is already set', () => {
    const r2 = makeNode('root', 'root');
    expect(() => tree.setRoot(r2)).toThrow(ObjectTreeError);
  });

  // --- O(1) path lookup ---

  it('findById returns root by path', () => {
    const r = tree.findById('root');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.identity.path).toBe('root');
  });

  it('findById returns not-found for unknown path', () => {
    const r = tree.findById('ghost');
    expect(r.ok).toBe(false);
  });

  it('findById finds a nested child after attach', () => {
    const child = makeNode('sensor', 'root/sensor');
    tree.attachChild('root', child);
    const r = tree.findById('root/sensor');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.identity.location).toBe('sensor');
  });

  // --- path-based lookup ---

  it('findByPath resolves root', () => {
    const r = tree.findByPath('root');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.identity.location).toBe('root');
  });

  it('findByPath resolves a direct child', () => {
    const child = makeNode('sensor', 'root/sensor');
    tree.attachChild('root', child);
    const r = tree.findByPath('root/sensor');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.identity.location).toBe('sensor');
  });

  it('findByPath resolves a grandchild', () => {
    const mid = makeNode('zone', 'root/zone');
    const leaf = makeNode('temp', 'root/zone/temp');
    tree.attachChild('root', mid);
    tree.attachChild('root/zone', leaf);
    const r = tree.findByPath('root/zone/temp');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.identity.location).toBe('temp');
  });

  it('findByPath returns error for wrong root location', () => {
    const r = tree.findByPath('device/sensor');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("root location");
  });

  it('findByPath returns error for missing segment', () => {
    const r = tree.findByPath('root/missing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("'missing'");
  });

  it('findByPath returns error for empty path', () => {
    const r = tree.findByPath('');
    expect(r.ok).toBe(false);
  });

  // --- subtree removal ---

  it('detachChild removes node from index', () => {
    const child = makeNode('sensor', 'root/sensor');
    tree.attachChild('root', child);
    tree.detachChild('root', 'sensor');
    expect(tree.findById('root/sensor').ok).toBe(false);
  });

  it('detachChild removes whole subtree from index', () => {
    const mid = makeNode('zone', 'root/zone');
    const leaf = makeNode('temp', 'root/zone/temp');
    tree.attachChild('root', mid);
    tree.attachChild('root/zone', leaf);
    tree.detachChild('root', 'zone');
    expect(tree.findById('root/zone').ok).toBe(false);
    expect(tree.findById('root/zone/temp').ok).toBe(false);
  });

  // --- duplicate path rejection ---

  it('throws on duplicate path during attach', () => {
    const c1 = makeNode('a', 'root/dup');
    const c2 = makeNode('b', 'root/dup');
    tree.attachChild('root', c1);
    expect(() => tree.attachChild('root', c2)).toThrow('Duplicate');
  });

  it('throws on duplicate sibling location during addChild', () => {
    const c1 = makeNode('sensor', 'root/sensor');
    const c2 = makeNode('sensor', 'root/sensor');
    tree.attachChild('root', c1);
    expect(() => tree.attachChild('root', c2)).toThrow('Duplicate sibling location');
  });

  // --- edge cases ---

  it('detachChild returns undefined for unknown parent', () => {
    expect(tree.detachChild('no-such-node', 'sensor')).toBeUndefined();
  });

  it('attachChild throws for unknown parent', () => {
    const c = makeNode('sensor', 'root/sensor');
    expect(() => tree.attachChild('no-such-parent', c)).toThrow(ObjectTreeError);
  });

  // --- size ---

  it('size reflects all indexed nodes', () => {
    const c1 = makeNode('a', 'root/a');
    const c2 = makeNode('b', 'root/b');
    tree.attachChild('root', c1);
    tree.attachChild('root', c2);
    expect(tree.size()).toBe(3);
  });
});
