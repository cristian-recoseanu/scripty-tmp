import { describe, it, expect } from 'vitest';

import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { marshal, unmarshal } from '../../../src/engine/serialization/codec.js';
import { snapshot, restore } from '../../../src/engine/serialization/snapshot.js';

import type { PropertyDescriptor } from '../../../src/engine/model/ObjectNode.js';
import type { SlotDescriptor } from '../../../src/engine/serialization/codec.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTree(): InstanceTree {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'MyRoot', path: 'root' },
    [
      { id: 'label', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'active', type: 'bool', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'score', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'tags', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
    ] satisfies PropertyDescriptor[],
    [],
  );
  root.setProperty('label', 'hello');
  root.setProperty('active', true);
  root.setProperty('score', 42);
  root.setProperty('tags', ['a', 'b']);

  const child = new InstanceNodeImpl(
    { location: 'child-01', entity_def: 'MyChild', path: 'root/child-01' },
    [{ id: 'x', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  child.setProperty('x', 99);
  root.addChild(child);
  tree.setRoot(root);
  return tree;
}

// ---------------------------------------------------------------------------
// E4.T1 — Deterministic toJSON
// ---------------------------------------------------------------------------

describe('E4.T1 — deterministic toJSON', () => {
  it('serializes tree to expected shape', () => {
    const tree = buildTree();
    const json = tree.toJSON();
    expect(json).not.toBeNull();
    expect(json?.location).toBe('root');
    expect(json?.entity_def).toBe('MyRoot');
    expect(json?.properties.find((p) => p.id === 'label')?.value).toBe('hello');
    expect(json?.children).toHaveLength(1);
    expect(json?.children[0]?.location).toBe('child-01');
  });

  it('serializing the same tree twice produces identical output', () => {
    const tree = buildTree();
    const a = JSON.stringify(tree.toJSON());
    const b = JSON.stringify(tree.toJSON());
    expect(a).toBe(b);
  });

  it('object property keys are sorted deterministically', () => {
    const marshalled = marshal({ z: 1, a: 2, m: 3 });
    expect(marshalled.ok).toBe(true);
    if (marshalled.ok) {
      const keys = Object.keys(marshalled.value as object);
      expect(keys).toEqual(['a', 'm', 'z']);
    }
  });

  it('tree.toJSON returns null for empty tree', () => {
    const empty = new InstanceTree();
    expect(empty.toJSON()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E4.T2 — marshal
// ---------------------------------------------------------------------------

describe('E4.T2 — marshal', () => {
  it('passes through scalar string', () => {
    expect(marshal('hello')).toEqual({ ok: true, value: 'hello' });
  });

  it('passes through boolean', () => {
    expect(marshal(true)).toEqual({ ok: true, value: true });
  });

  it('passes through number', () => {
    expect(marshal(3.14)).toEqual({ ok: true, value: 3.14 });
  });

  it('passes through null', () => {
    expect(marshal(null)).toEqual({ ok: true, value: null });
  });

  it('deep-clones an array', () => {
    const arr = [1, 'two', true];
    const r = marshal(arr);
    expect(r).toEqual({ ok: true, value: [1, 'two', true] });
  });

  it('sorts object keys', () => {
    const r = marshal({ z: 3, a: 1, m: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value as object)).toEqual(['a', 'm', 'z']);
  });

  it('deep-clones nested objects with sorted keys', () => {
    const r = marshal({ outer: { z: 1, a: 2 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const inner = (r.value as Record<string, unknown>).outer;
      expect(Object.keys(inner as object)).toEqual(['a', 'z']);
    }
  });

  it('sorts keys in array-of-objects', () => {
    const r = marshal([{ z: 1, a: 2 }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const item = (r.value as Record<string, unknown>[])[0];
      expect(Object.keys(item as object)).toEqual(['a', 'z']);
    }
  });
});

// ---------------------------------------------------------------------------
// E4.T2 — unmarshal
// ---------------------------------------------------------------------------

describe('E4.T2 — unmarshal: string', () => {
  const slot: SlotDescriptor = { type: 'string', is_array: false };

  it('accepts a string', () => {
    const r = unmarshal('hello', slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hello');
  });

  it('rejects a number', () => {
    expect(unmarshal(42, slot).ok).toBe(false);
  });

  it('rejects null when not nullable', () => {
    expect(unmarshal(null, slot).ok).toBe(false);
  });

  it('accepts null when nullable', () => {
    const r = unmarshal(null, { ...slot, nullable: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });
});

describe('E4.T2 — unmarshal: bool', () => {
  const slot: SlotDescriptor = { type: 'bool', is_array: false };

  it('accepts true/false', () => {
    expect(unmarshal(true, slot).ok).toBe(true);
    expect(unmarshal(false, slot).ok).toBe(true);
  });

  it('rejects string "true"', () => {
    expect(unmarshal('true', slot).ok).toBe(false);
  });
});

describe('E4.T2 — unmarshal: numeric', () => {
  const slot: SlotDescriptor = { type: 'numeric', is_array: false };

  it('accepts integer and float', () => {
    expect(unmarshal(42, slot).ok).toBe(true);
    expect(unmarshal(3.14, slot).ok).toBe(true);
  });

  it('rejects string', () => {
    expect(unmarshal('42', slot).ok).toBe(false);
  });

  it('rejects NaN', () => {
    expect(unmarshal(NaN, slot).ok).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(unmarshal(Infinity, slot).ok).toBe(false);
    expect(unmarshal(-Infinity, slot).ok).toBe(false);
  });
});

describe('E4.T2 — unmarshal: object', () => {
  const slot: SlotDescriptor = { type: 'object', is_array: false };

  it('accepts a plain object', () => {
    const r = unmarshal({ x: 1, y: 'hello' }, slot);
    expect(r.ok).toBe(true);
  });

  it('sorts keys deterministically', () => {
    const r = unmarshal({ z: 1, a: 2 }, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value as object)).toEqual(['a', 'z']);
  });

  it('rejects an array', () => {
    expect(unmarshal([1, 2], slot).ok).toBe(false);
  });

  it('rejects a string', () => {
    expect(unmarshal('hello', slot).ok).toBe(false);
  });
});

describe('E4.T2 — unmarshal: arrays', () => {
  it('accepts array of strings', () => {
    const r = unmarshal(['a', 'b'], { type: 'string', is_array: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(['a', 'b']);
  });

  it('rejects scalar for array slot', () => {
    expect(unmarshal('abc', { type: 'string', is_array: true }).ok).toBe(false);
  });

  it('rejects mixed-type array element', () => {
    const r = unmarshal(['a', 2], { type: 'string', is_array: true });
    expect(r.ok).toBe(false);
  });

  it('accepts array of objects', () => {
    const r = unmarshal([{ x: 1 }, { x: 2 }], { type: 'object', is_array: true });
    expect(r.ok).toBe(true);
  });
});

describe('E4.T2 — round-trip marshal/unmarshal', () => {
  it('round-trips string', () => {
    const v = 'hello world';
    const m = marshal(v);
    expect(m.ok).toBe(true);
    if (m.ok) {
      const u = unmarshal(m.value, { type: 'string', is_array: false });
      expect(u.ok).toBe(true);
      if (u.ok) expect(u.value).toBe(v);
    }
  });

  it('round-trips number', () => {
    const v = 123.456;
    const m = marshal(v);
    expect(m.ok).toBe(true);
    if (m.ok) {
      const u = unmarshal(m.value, { type: 'numeric', is_array: false });
      expect(u.ok).toBe(true);
      if (u.ok) expect(u.value).toBe(v);
    }
  });

  it('round-trips bool', () => {
    for (const v of [true, false]) {
      const m = marshal(v);
      if (m.ok) {
        const u = unmarshal(m.value, { type: 'bool', is_array: false });
        expect(u.ok).toBe(true);
        if (u.ok) expect(u.value).toBe(v);
      }
    }
  });

  it('round-trips array of numbers', () => {
    const v = [1, 2, 3];
    const m = marshal(v);
    expect(m.ok).toBe(true);
    if (m.ok) {
      const u = unmarshal(m.value, { type: 'numeric', is_array: true });
      expect(u.ok).toBe(true);
      if (u.ok) expect(u.value).toEqual(v);
    }
  });

  it('round-trips nested object (keys stay sorted)', () => {
    const v = { z: 3, a: 1 };
    const m = marshal(v);
    expect(m.ok).toBe(true);
    if (m.ok) {
      const u = unmarshal(m.value, { type: 'object', is_array: false });
      expect(u.ok).toBe(true);
      if (u.ok) expect(Object.keys(u.value as object)).toEqual(['a', 'z']);
    }
  });
});

// ---------------------------------------------------------------------------
// E4.T3 — Numeric precision policy
// ---------------------------------------------------------------------------

describe('E4.T3 — numeric precision policy', () => {
  const slot: SlotDescriptor = { type: 'numeric', is_array: false };

  it('safe integers are accepted without warnings', () => {
    const r = unmarshal(Number.MAX_SAFE_INTEGER, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(0);
  });

  it('floats within safe range have no precision warning', () => {
    const r = unmarshal(3.14159, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(0);
  });

  it('rejects NaN', () => {
    expect(unmarshal(NaN, slot).ok).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(unmarshal(Infinity, slot).ok).toBe(false);
  });

  it('rejects -Infinity', () => {
    expect(unmarshal(-Infinity, slot).ok).toBe(false);
  });

  it('0 round-trips cleanly', () => {
    const r = unmarshal(0, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('negative numbers round-trip', () => {
    const r = unmarshal(-273.15, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-273.15);
  });
});

// ---------------------------------------------------------------------------
// E4.T2 — unmarshal: nested object edge cases (_unmarshalUnknown branches)
// ---------------------------------------------------------------------------

describe('E4.T2 — unmarshal: nested object edge cases', () => {
  const slot: SlotDescriptor = { type: 'object', is_array: false };

  it('rejects Infinity inside a nested object field', () => {
    const r = unmarshal({ x: Infinity }, slot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('x');
  });

  it('rejects NaN inside a nested object field', () => {
    const r = unmarshal({ val: NaN }, slot);
    expect(r.ok).toBe(false);
  });

  it('accepts null inside a nested object field', () => {
    const r = unmarshal({ key: null }, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, unknown>).key).toBeNull();
  });

  it('accepts undefined inside a nested object field (treated as null)', () => {
    const r = unmarshal({ key: undefined }, slot);
    expect(r.ok).toBe(true);
  });

  it('accepts nested array inside an object field', () => {
    const r = unmarshal({ items: [1, 2, 3] }, slot);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Record<string, unknown>).items).toEqual([1, 2, 3]);
  });

  it('rejects Infinity inside a nested array element', () => {
    const r = unmarshal({ items: [1, Infinity] }, slot);
    expect(r.ok).toBe(false);
  });

  it('accepts nested object inside an object field', () => {
    const r = unmarshal({ inner: { a: 1, b: 'x' } }, slot);
    expect(r.ok).toBe(true);
  });

  it('rejects unsupported value type (function) inside a nested field', () => {
    const r = unmarshal({ fn: () => {} }, slot);
    expect(r.ok).toBe(false);
  });
});

describe('E4.T4 — snapshot', () => {
  it('snapshot of empty tree returns null', () => {
    expect(snapshot(new InstanceTree())).toBeNull();
  });

  it('snapshot matches toJSON output', () => {
    const tree = buildTree();
    expect(JSON.stringify(snapshot(tree))).toBe(JSON.stringify(tree.toJSON()));
  });
});

describe('E4.T4 — restore', () => {
  it('restores tree with correct root location and entity_def', () => {
    const tree = buildTree();
    const snap = snapshot(tree);
    expect(snap).not.toBeNull();
    const restored = restore(snap!);
    expect(restored.root?.identity.location).toBe('root');
    expect(restored.root?.identity.entity_def).toBe('MyRoot');
  });

  it('restored tree has same number of nodes', () => {
    const tree = buildTree();
    const snap = snapshot(tree);
    const restored = restore(snap!);
    expect(restored.size()).toBe(tree.size());
  });

  it('restored child is findable by path', () => {
    const tree = buildTree();
    const snap = snapshot(tree);
    const restored = restore(snap!);
    const r = restored.findByPath('root/child-01');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.identity.entity_def).toBe('MyChild');
  });

  it('restored property values match original', () => {
    const tree = buildTree();
    const snap = snapshot(tree);
    const restored = restore(snap!);
    const rootNode = restored.root;
    expect(rootNode?.getProperty('label').value).toBe('hello');
    expect(rootNode?.getProperty('active').value).toBe(true);
    expect(rootNode?.getProperty('score').value).toBe(42);
    expect(rootNode?.getProperty('tags').value).toEqual(['a', 'b']);
  });

  it('snapshot → restore → snapshot produces identical JSON', () => {
    const tree = buildTree();
    const snap1 = snapshot(tree);
    const restored = restore(snap1!);
    const snap2 = snapshot(restored);
    expect(JSON.stringify(snap2)).toBe(JSON.stringify(snap1));
  });
});
