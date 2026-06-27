import { describe, it, expect, beforeEach } from 'vitest';

import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';

import type {
  InstanceIdentity,
  PropertyDescriptor,
  MethodDescriptor,
  MethodResult,
  ArgumentBag,
} from '../../../src/engine/model/ObjectNode.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<InstanceIdentity> = {}): InstanceIdentity {
  return {
    location: 'sensor',
    entity_def: 'TemperatureSensor',
    path: 'root/sensor',
    ...overrides,
  };
}

const tempProp: PropertyDescriptor = {
  id: 'temperature',
  type: 'numeric',
  is_array: false,
  nullable: false,
  read_only: false,
  observable: true,
};

const readOnlyProp: PropertyDescriptor = {
  id: 'serial',
  type: 'string',
  is_array: false,
  nullable: false,
  read_only: true,
  observable: false,
};

const arrProp: PropertyDescriptor = {
  id: 'readings',
  type: 'numeric',
  is_array: true,
  nullable: false,
  read_only: false,
  observable: false,
};

const echoMethod: MethodDescriptor = {
  id: 'echo',
  args: [{ id: 'msg', type: 'string', is_array: false }],
  return_type: 'string',
  return_is_array: false,
};

const voidMethod: MethodDescriptor = {
  id: 'reset',
  args: [],
  return_type: null,
  return_is_array: false,
};

function makeNode(overrides: Partial<InstanceIdentity> = {}): InstanceNodeImpl {
  const handlers = new Map<string, (args: ArgumentBag) => Promise<MethodResult>>();
  handlers.set('echo', (args): Promise<MethodResult> => Promise.resolve({ status: 200, value: args.msg ?? null }));
  handlers.set('reset', (): Promise<MethodResult> => Promise.resolve({ status: 200 }));
  return new InstanceNodeImpl(
    makeIdentity(overrides),
    [tempProp, readOnlyProp, arrProp],
    [echoMethod, voidMethod],
    handlers,
  );
}

// ---------------------------------------------------------------------------
// E3.T4 — InstanceIdentity
// ---------------------------------------------------------------------------

describe('E3.T4 — InstanceIdentity', () => {
  it('root has location "root" and empty/self path', () => {
    const root = makeNode({ location: 'root', path: 'root', entity_def: 'RootDef' });
    expect(root.identity.location).toBe('root');
    expect(root.identity.path).toBe('root');
  });

  it('child has location and derived path', () => {
    const node = makeNode();
    expect(node.identity.location).toBe('sensor');
    expect(node.identity.path).toBe('root/sensor');
    expect(node.identity.entity_def).toBe('TemperatureSensor');
  });

  it('identity fields are accessible', () => {
    const node = makeNode();
    expect(node.identity.location).toBe('sensor');
    expect(node.identity.entity_def).toBe('TemperatureSensor');
    expect(node.identity.path).toBe('root/sensor');
  });
});

// ---------------------------------------------------------------------------
// E3.T4 — PropertyDescriptor & MethodDescriptor
// ---------------------------------------------------------------------------

describe('E3.T4 — PropertyDescriptor & MethodDescriptor', () => {
  it('node exposes property descriptors by id', () => {
    const node = makeNode();
    expect(node.properties.has('temperature')).toBe(true);
    expect(node.properties.get('temperature')?.read_only).toBe(false);
    expect(node.properties.get('temperature')?.observable).toBe(true);
  });

  it('read-only property is marked correctly', () => {
    const node = makeNode();
    expect(node.properties.get('serial')?.read_only).toBe(true);
  });

  it('node exposes method descriptors by id', () => {
    const node = makeNode();
    expect(node.methods.has('echo')).toBe(true);
  });

  it('void method has return_type === null', () => {
    const node = makeNode();
    expect(node.methods.get('reset')?.return_type).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E3.T4 — Instance node implementation
// ---------------------------------------------------------------------------

describe('E3.T4 — getProperty', () => {
  let node: InstanceNodeImpl;
  beforeEach(() => { node = makeNode(); });

  it('returns null for an unset scalar property', () => {
    const r = node.getProperty('temperature');
    expect(r.ok).toBe(true);
    expect(r.value).toBeNull();
  });

  it('returns not-found for unknown id', () => {
    const r = node.getProperty('unknown');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('not-found');
  });

  it('returns empty array for an unset array property', () => {
    const r = node.getProperty('readings');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual([]);
  });
});

describe('E3.T4 — setProperty', () => {
  let node: InstanceNodeImpl;
  beforeEach(() => { node = makeNode(); });

  it('sets and retrieves a scalar value', () => {
    expect(node.setProperty('temperature', 21.5).ok).toBe(true);
    expect(node.getProperty('temperature').value).toBe(21.5);
  });

  it('returns read-only failure without mutating', () => {
    const r = node.setProperty('serial', 'SN-001');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('read-only');
    expect(node.getProperty('serial').value).toBeNull();
  });

  it('returns not-found for unknown id', () => {
    const r = node.setProperty('unknown', 42);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('not-found');
  });

  it('returns type-mismatch when setting a non-array on an array property', () => {
    const r = node.setProperty('readings', 3.14);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('type-mismatch');
  });

  it('accepts an array for an array property', () => {
    expect(node.setProperty('readings', [1, 2, 3]).ok).toBe(true);
    expect(node.getProperty('readings').value).toEqual([1, 2, 3]);
  });
});

describe('E3.T4 — invoke', () => {
  let node: InstanceNodeImpl;
  beforeEach(() => { node = makeNode(); });

  it('dispatches to handler and returns result', async () => {
    const r = await node.invoke('echo', { msg: 'hello' });
    expect(r.status).toBe(200);
    expect(r.value).toBe('hello');
  });

  it('returns 404 for unknown method', async () => {
    const r = await node.invoke('nonexistent', {});
    expect(r.status).toBe(404);
  });

  it('void method returns status 200 with no value', async () => {
    const r = await node.invoke('reset', {});
    expect(r.status).toBe(200);
    expect(r.value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E3.T4 — Block (container) & nesting
// ---------------------------------------------------------------------------

describe('E3.T4 — Block & nesting', () => {
  it('leaf node isBlock() === false', () => {
    expect(makeNode().isBlock()).toBe(false);
  });

  it('node with children isBlock() === true', () => {
    const parent = makeNode({ location: 'root', path: 'root', entity_def: 'Root' });
    const child = makeNode({ location: 'sensor', path: 'root/sensor', entity_def: 'Sensor' });
    parent.addChild(child);
    expect(parent.isBlock()).toBe(true);
  });

  it('rejects duplicate sibling location', () => {
    const parent = makeNode({ location: 'root', path: 'root', entity_def: 'Root' });
    const c1 = makeNode({ location: 'sensor', path: 'root/sensor', entity_def: 'Sensor' });
    const c2 = makeNode({ location: 'sensor', path: 'root/sensor', entity_def: 'Sensor' });
    parent.addChild(c1);
    expect(() => parent.addChild(c2)).toThrow('Duplicate sibling location');
  });

  it('removeChild detaches the subtree', () => {
    const parent = makeNode({ location: 'root', path: 'root', entity_def: 'Root' });
    const child = makeNode({ location: 'sensor', path: 'root/sensor', entity_def: 'Sensor' });
    parent.addChild(child);
    const removed = parent.removeChild('sensor');
    expect(removed).toBe(child);
    expect(parent.children.has('sensor')).toBe(false);
    expect(parent.isBlock()).toBe(false);
  });

  it('nesting depth: grandchild accessible via parent.children', () => {
    const root = makeNode({ location: 'root', path: 'root', entity_def: 'Root' });
    const mid = makeNode({ location: 'mid', path: 'root/mid', entity_def: 'Mid' });
    const leaf = makeNode({ location: 'leaf', path: 'root/mid/leaf', entity_def: 'Leaf' });
    mid.addChild(leaf);
    root.addChild(mid);
    expect(root.children.get('mid')?.children.get('leaf')?.identity.location).toBe('leaf');
  });
});

// ---------------------------------------------------------------------------
// E3.T4 — Array property operations (via setProperty with arrays)
// ---------------------------------------------------------------------------

describe('E3.T4 — array property ops', () => {
  let node: InstanceNodeImpl;
  beforeEach(() => { node = makeNode(); });

  it('sets and retrieves an array value', () => {
    node.setProperty('readings', [1.0, 2.0, 3.0]);
    expect(node.getProperty('readings').value).toEqual([1.0, 2.0, 3.0]);
  });

  it('rejects setting a scalar on an array property', () => {
    const r = node.setProperty('readings', 42);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('type-mismatch');
  });

  it('rejects setting an array on a scalar property', () => {
    const r = node.setProperty('temperature', [1, 2]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('type-mismatch');
  });

  it('initial value of array property is empty array', () => {
    expect(node.getProperty('readings').value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// invoke — no handler registered
// ---------------------------------------------------------------------------

describe('E3.T4 — invoke no handler', () => {
  it('returns 501 when method exists but has no handler', async () => {
    const n = new InstanceNodeImpl(
      { location: 'n', entity_def: 'T', path: 'root/n' },
      [],
      [{ id: 'doSomething', args: [], return_type: null, return_is_array: false }],
    );
    const r = await n.invoke('doSomething', {});
    expect(r.status).toBe(501);
  });
});

// ---------------------------------------------------------------------------
// E3.T7 — toJSON (instantiated-tree serialization format)
// ---------------------------------------------------------------------------

describe('E3.T7 — toJSON', () => {
  it('serialises location, entity_def, property values, method ids, children', () => {
    const parent = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Root', path: 'root' },
      [tempProp],
      [voidMethod],
    );
    parent.setProperty('temperature', 22.5);
    const child = new InstanceNodeImpl(
      { location: 'sensor', entity_def: 'Sensor', path: 'root/sensor' },
      [],
      [],
    );
    parent.addChild(child);
    const json = parent.toJSON();
    expect(json.location).toBe('root');
    expect(json.entity_def).toBe('Root');
    expect(json.properties).toEqual([{ id: 'temperature', value: 22.5 }]);
    expect(json.methods).toEqual(['reset']);
    expect(json.children).toHaveLength(1);
    expect(json.children[0]?.location).toBe('sensor');
  });

  it('serialises array property values', () => {
    const n = makeNode();
    n.setProperty('readings', [1.0, 2.0]);
    const json = n.toJSON();
    const readingsProp = json.properties.find((p) => p.id === 'readings');
    expect(readingsProp?.value).toEqual([1.0, 2.0]);
  });

  it('unset scalar properties serialize as null', () => {
    const n = makeNode();
    const json = n.toJSON();
    const tempEntry = json.properties.find((p) => p.id === 'temperature');
    expect(tempEntry?.value).toBeNull();
  });

  it('unset array properties serialize as empty array', () => {
    const n = makeNode();
    const json = n.toJSON();
    const readingsEntry = json.properties.find((p) => p.id === 'readings');
    expect(readingsEntry?.value).toEqual([]);
  });

  it('golden snapshot matches instantiated-tree-values shape', () => {
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'MyRoot', path: 'root' },
      [
        { id: 'p1', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
        { id: 'p2', type: 'bool', is_array: false, read_only: false, observable: true, nullable: false },
        { id: 'p3', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
        { id: 'p4', type: 'object', is_array: false, read_only: false, observable: true, nullable: false },
        { id: 'p5', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
      ],
      [{ id: 'm1', args: [{ id: 'a1', type: 'string', is_array: false }], return_type: 'string', return_is_array: false }],
    );
    root.setProperty('p1', 'abc');
    root.setProperty('p2', true);
    root.setProperty('p3', 123);
    root.setProperty('p4', {});
    root.setProperty('p5', ['abc']);
    const child = new InstanceNodeImpl(
      { location: 'child-01', entity_def: 'MyChild', path: 'root/child-01' },
      [
        { id: 'p1', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
      ],
      [],
    );
    child.setProperty('p1', 'abc');
    root.addChild(child);
    const json = root.toJSON();
    expect(json.location).toBe('root');
    expect(json.entity_def).toBe('MyRoot');
    expect(json.properties.find((p) => p.id === 'p1')?.value).toBe('abc');
    expect(json.properties.find((p) => p.id === 'p2')?.value).toBe(true);
    expect(json.properties.find((p) => p.id === 'p3')?.value).toBe(123);
    expect(json.properties.find((p) => p.id === 'p5')?.value).toEqual(['abc']);
    expect(json.children).toHaveLength(1);
    expect(json.children[0]?.location).toBe('child-01');
    expect(json.methods).toEqual(['m1']);
  });
});
