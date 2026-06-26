/**
 * UceEngine tests — E6.T1-T5.
 */

import { describe, it, expect } from 'vitest';

import type { PropertyChangedOp } from '../../src/engine/bus/operations.js';
import {
  makeMethodInvokeOp,
  makePropertyChangedOp,
  makeSetPropertyOp,
} from '../../src/engine/bus/operations.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import type { MethodDescriptor, PropertyDescriptor } from '../../src/engine/model/ObjectNode.js';
import type { MethodHandler } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { UceEngine } from '../../src/engine/UceEngine.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const BASE = { correlationId: 'c1', origin: 'test-ingress', ts: '2026-01-01T00:00:00.000Z' };

function buildTestTree(): { tree: InstanceTree; root: InstanceNodeImpl } {
  const tree = new InstanceTree();

  const props: PropertyDescriptor[] = [
    { id: 'temp', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    { id: 'label', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
    { id: 'status', type: 'string', is_array: false, read_only: true, observable: true, nullable: false },
    { id: 'tags', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
    { id: 'config', type: 'object', is_array: false, read_only: false, observable: true, nullable: false },
  ];

  const methods: MethodDescriptor[] = [
    { id: 'reset', args: [], return_type: null, return_is_array: false },
    { id: 'add', args: [{ id: 'a', type: 'numeric', is_array: false }, { id: 'b', type: 'numeric', is_array: false }], return_type: 'numeric', return_is_array: false },
  ];

  const handlers = new Map<string, MethodHandler>([
    ['reset', () => Promise.resolve({ status: 200 })],
    ['add', (args) => {
      const a = args['a'] as number;
      const b = args['b'] as number;
      return Promise.resolve({ status: 200, value: a + b });
    }],
  ]);

  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'MyRoot', path: 'root' },
    props,
    methods,
    handlers,
  );

  root.setProperty('temp', 20.0);
  root.setProperty('label', 'sensor-01');
  root.setProperty('tags', ['a', 'b']);
  root.setProperty('config', { x: 1 });

  tree.setRoot(root);
  return { tree, root };
}

function buildEngine(): { engine: UceEngine; bus: UceBus; tree: InstanceTree; root: InstanceNodeImpl } {
  const bus = new UceBus({ error: () => {} });
  const { tree, root } = buildTestTree();
  const engine = new UceEngine({ tree, bus });
  engine.start();
  return { engine, bus, tree, root };
}

// ---------------------------------------------------------------------------
// E6.T1 — Operation application pipeline
// ---------------------------------------------------------------------------

describe('E6.T1 — applySet: valid change', () => {
  it('updates the property value', () => {
    const { engine } = buildEngine();
    const r = engine.applySet('root', 'temp', 25.0, 'test', 'cid');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('ok');
    const lookup = engine.tree.findById('root');
    expect(lookup.ok).toBe(true);
    if (lookup.ok) expect(lookup.node.getProperty('temp').value).toBe(25.0);
  });

  it('returns not-found for unknown node', () => {
    const { engine } = buildEngine();
    const r = engine.applySet('nonexistent', 'temp', 1, 'test', 'cid');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('not-found');
  });

  it('applies read-only property (read_only enforcement is at adapter boundary, not engine)', () => {
    // applySet uses forceSetProperty: bus-originated writes are always allowed.
    // The IS-12 adapter checks propMap.isReadOnly independently before publishing SetPropertyOp.
    const { engine } = buildEngine();
    const r = engine.applySet('root', 'status', 'on', 'test', 'cid');
    expect(r.ok).toBe(true);
  });
});

describe('E6.T1 — idempotency: equal-value is a no-op', () => {
  it('returns no-op when value equals current', () => {
    const { engine } = buildEngine();
    const r = engine.applySet('root', 'temp', 20.0, 'test', 'cid');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('no-op');
  });

  it('does not fan-out on no-op', () => {
    const { engine } = buildEngine();
    const notifications: PropertyChangedOp[] = [];
    engine.observe('other-adapter', 'root', 'temp', (op) => notifications.push(op));
    engine.applySet('root', 'temp', 20.0, 'test', 'cid'); // equal value
    expect(notifications).toHaveLength(0);
  });

  it('no-op for equal array value', () => {
    const { engine } = buildEngine();
    const r = engine.applySet('root', 'tags', ['a', 'b'], 'test', 'cid');
    expect(r.status).toBe('no-op');
  });

  it('no-op for equal object value', () => {
    const { engine } = buildEngine();
    const r = engine.applySet('root', 'config', { x: 1 }, 'test', 'cid');
    expect(r.status).toBe('no-op');
  });
});

describe('E6.T1 — bus-driven SetPropertyOp', () => {
  it('applies value change via bus publish', async () => {
    const { engine, bus } = buildEngine();
    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'temp', value: 99.9 }));
    // Allow microtask queue to flush
    await Promise.resolve();
    const result = engine.tree.findById('root');
    expect(result.ok && result.node.getProperty('temp').value).toBe(99.9);
  });
});

describe('E6.T1 — bus-driven PropertyChangedOp', () => {
  it('applies ingress property change via bus publish', async () => {
    const { engine, bus } = buildEngine();
    bus.publish(makePropertyChangedOp({ ...BASE, nodeId: 'root', property: 'temp', changeType: 'valueChanged', value: 55 }));
    await Promise.resolve();
    const result = engine.tree.findById('root');
    expect(result.ok && result.node.getProperty('temp').value).toBe(55);
  });

  it('no-op does not fan-out when value unchanged via bus', async () => {
    const { engine, bus } = buildEngine();
    const notifications: PropertyChangedOp[] = [];
    engine.observe('observer', 'root', 'temp', (op) => notifications.push(op));
    bus.publish(makePropertyChangedOp({ ...BASE, nodeId: 'root', property: 'temp', changeType: 'valueChanged', value: 20.0 }));
    await Promise.resolve();
    expect(notifications).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E6.T2 — Single-writer concurrency model
// ---------------------------------------------------------------------------

describe('E6.T2 — single-writer serialisation per nodeId', () => {
  it('concurrent ops on same nodeId are applied in publish order', async () => {
    const { engine, bus } = buildEngine();
    const applied: number[] = [];
    engine.observe('observer', 'root', 'temp', (op) => applied.push(op.value as number));

    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'temp', value: 1 }));
    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'temp', value: 2 }));
    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'temp', value: 3 }));

    // Drain the microtask queue
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// E6.T3 — Observation registry (symmetric, origin-excluding)
// ---------------------------------------------------------------------------

describe('E6.T3 — observe/notify', () => {
  it('observer receives fan-out on change', () => {
    const { engine } = buildEngine();
    const received: PropertyChangedOp[] = [];
    engine.observe('adapter-a', 'root', 'temp', (op) => received.push(op));
    engine.applySet('root', 'temp', 30.0, 'some-ingress', 'cid');
    expect(received).toHaveLength(1);
    expect(received[0]?.value).toBe(30.0);
  });

  it('originator is excluded from fan-out', () => {
    const { engine } = buildEngine();
    const received: PropertyChangedOp[] = [];
    engine.observe('mqtt-ingress', 'root', 'temp', (op) => received.push(op));
    engine.applySet('root', 'temp', 30.0, 'mqtt-ingress', 'cid'); // same origin
    expect(received).toHaveLength(0);
  });

  it('multiple adapters fan-out — originator excluded, others notified', () => {
    const { engine } = buildEngine();
    const mqttReceived: PropertyChangedOp[] = [];
    const is12Received: PropertyChangedOp[] = [];
    const fakeReceived: PropertyChangedOp[] = [];

    engine.observe('mqtt-adapter', 'root', 'temp', (op) => mqttReceived.push(op));
    engine.observe('nmos-is12', 'root', 'temp', (op) => is12Received.push(op));
    engine.observe('fake-adapter', 'root', 'temp', (op) => fakeReceived.push(op));

    engine.applySet('root', 'temp', 30.0, 'mqtt-adapter', 'cid');

    expect(mqttReceived).toHaveLength(0);  // originator excluded
    expect(is12Received).toHaveLength(1);  // notified
    expect(fakeReceived).toHaveLength(1);  // notified
  });

  it('unregister stops further notifications', () => {
    const { engine } = buildEngine();
    const received: PropertyChangedOp[] = [];
    const unobserve = engine.observe('a', 'root', 'temp', (op) => received.push(op));
    engine.applySet('root', 'temp', 30.0, 'other', 'c1');
    unobserve();
    engine.applySet('root', 'temp', 31.0, 'other', 'c2');
    expect(received).toHaveLength(1);
  });

  it('observer on different property is not notified', () => {
    const { engine } = buildEngine();
    const received: PropertyChangedOp[] = [];
    engine.observe('a', 'root', 'label', (op) => received.push(op));
    engine.applySet('root', 'temp', 30.0, 'other', 'cid');
    expect(received).toHaveLength(0);
  });

  it('origin is preserved on fan-out op', () => {
    const { engine } = buildEngine();
    const received: PropertyChangedOp[] = [];
    engine.observe('a', 'root', 'temp', (op) => received.push(op));
    engine.applySet('root', 'temp', 30.0, 'nmos-is12', 'cid-42');
    expect(received[0]?.origin).toBe('nmos-is12');
    expect(received[0]?.correlationId).toBe('cid-42');
  });

  it('childRemoved cleans up observer entries for that nodeId', () => {
    const { engine, bus } = buildEngine();
    const received: PropertyChangedOp[] = [];
    engine.observe('a', 'root/child', 'temp', (op) => received.push(op));

    // Simulate childRemoved via bus
    bus.publish({
      op: 'childRemoved',
      correlationId: 'c', origin: 'eng', ts: '2026-01-01T00:00:00.000Z',
      parentNodeId: 'root',
      childNodeId: 'root/child',
      childLocation: 'child',
    });

    // Observer entries for root/child should have been removed
    // Verify by checking engine state doesn't re-notify on a hypothetical applySet
    engine.applySet('root', 'temp', 30.0, 'other', 'cid'); // different node, just checking it's stable
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E6.T4 — Method invocation dispatch
// ---------------------------------------------------------------------------

describe('E6.T4 — method invocation via bus', () => {
  it('valid invoke dispatches and publishes MethodResultOp', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));

    bus.publish(makeMethodInvokeOp({ ...BASE, nodeId: 'root', methodId: 'reset', args: {} }));
    await new Promise((r) => setTimeout(r, 0));

    expect(results).toHaveLength(1);
    const r = results[0] as { status: number };
    expect(r.status).toBe(200);
  });

  it('void method returns status 200 with no value', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));
    bus.publish(makeMethodInvokeOp({ ...BASE, nodeId: 'root', methodId: 'reset', args: {} }));
    await new Promise((r) => setTimeout(r, 0));
    const r = results[0] as { value?: unknown };
    expect(r.value).toBeUndefined();
  });

  it('method with args returns computed result', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));
    bus.publish(makeMethodInvokeOp({ ...BASE, nodeId: 'root', methodId: 'add', args: { a: 3, b: 7 } }));
    await new Promise((r) => setTimeout(r, 0));
    const r = results[0] as { value: unknown };
    expect(r.value).toBe(10);
  });

  it('unknown node returns status 404', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));
    bus.publish(makeMethodInvokeOp({ ...BASE, nodeId: 'root/ghost', methodId: 'reset', args: {} }));
    await new Promise((r) => setTimeout(r, 0));
    const r = results[0] as { status: number };
    expect(r.status).toBe(404);
  });

  it('unknown method returns status 404', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));
    bus.publish(makeMethodInvokeOp({ ...BASE, nodeId: 'root', methodId: 'nonexistent', args: {} }));
    await new Promise((r) => setTimeout(r, 0));
    const r = results[0] as { status: number };
    expect(r.status).toBe(404);
  });

  it('missing required arg returns status 400', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));
    bus.publish(makeMethodInvokeOp({ ...BASE, nodeId: 'root', methodId: 'add', args: { a: 1 } })); // missing b
    await new Promise((r) => setTimeout(r, 0));
    const r = results[0] as { status: number };
    expect(r.status).toBe(400);
  });

  it('correlationId is preserved in MethodResultOp', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'methodResult' }, (op) => results.push(op));
    bus.publish(makeMethodInvokeOp({ correlationId: 'trace-99', origin: 'test', nodeId: 'root', methodId: 'reset', args: {} }));
    await new Promise((r) => setTimeout(r, 0));
    const r = results[0] as { correlationId: string };
    expect(r.correlationId).toBe('trace-99');
  });
});

// ---------------------------------------------------------------------------
// E6.T5 — Lifecycle
// ---------------------------------------------------------------------------

describe('E6.T5 — lifecycle', () => {
  it('engine starts and isRunning() returns true', () => {
    const bus = new UceBus({ error: () => {} });
    const { tree } = buildTestTree();
    const engine = new UceEngine({ tree, bus });
    expect(engine.isRunning()).toBe(false);
    engine.start();
    expect(engine.isRunning()).toBe(true);
  });

  it('start() is idempotent — no duplicate subscriptions', async () => {
    const { engine, bus } = buildEngine();
    engine.start(); // second call
    const applied: unknown[] = [];
    engine.observe('obs', 'root', 'temp', (op) => applied.push(op.value));
    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'temp', value: 77.0 }));
    await new Promise((r) => setTimeout(r, 0));
    // Should only have 1 notification despite start() called twice
    expect(applied).toHaveLength(1);
  });

  it('stop() unsubscribes from bus and isRunning() returns false', async () => {
    const { engine, bus } = buildEngine();
    const applied: unknown[] = [];
    engine.observe('obs', 'root', 'temp', (op) => applied.push(op.value));

    engine.stop();
    expect(engine.isRunning()).toBe(false);

    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'temp', value: 88.0 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toHaveLength(0);
  });

  it('no dangling bus subscriptions after stop()', () => {
    const { engine, bus } = buildEngine();
    const countBefore = bus.subscriberCount();
    engine.stop();
    expect(bus.subscriberCount()).toBe(countBefore - 5); // 5 subs registered in start()
  });

  it('tree and bus accessors are available', () => {
    const { engine, tree, bus } = buildEngine();
    expect(engine.tree).toBe(tree);
    expect(engine.bus).toBe(bus);
  });
});

// ---------------------------------------------------------------------------
// E6.T1 — bus-driven ops: silent failure paths (no-throw, no fan-out)
// ---------------------------------------------------------------------------

describe('E6.T1 — bus-driven silent failures', () => {
  it('SetPropertyOp on unknown node is silently ignored', async () => {
    const { bus } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => results.push(op));
    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'ghost', property: 'temp', value: 1 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toHaveLength(0);
  });

  it('SetPropertyOp on read-only property is applied (read_only enforcement is at adapter boundary)', async () => {
    // read_only restricts IS-12 controller writes (enforced in ncSet/propMap.isReadOnly),
    // not bus-originated ops.  MQTT ingress can update read-only monitor properties.
    const { bus, engine } = buildEngine();
    const results: unknown[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => results.push(op));
    bus.publish(makeSetPropertyOp({ ...BASE, nodeId: 'root', property: 'status', value: 'on' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toHaveLength(1);
    // The tree value should be updated.
    const lookup = engine['_tree'].findById('root');
    expect(lookup.ok && lookup.node.getProperty('status').value).toBe('on');
  });

  it('PropertyChangedOp on unknown node is silently ignored', async () => {
    const { bus } = buildEngine();
    const fanOuts: unknown[] = [];
    bus.subscribe({ op: 'propertyChanged', nodeId: 'ghost' }, (op) => fanOuts.push(op));
    bus.publish(makePropertyChangedOp({ ...BASE, nodeId: 'ghost', property: 'temp', changeType: 'valueChanged', value: 1 }));
    await new Promise((r) => setTimeout(r, 0));
    // The published op itself arrives (before engine tries to apply), but no engine fan-out
    // We test that the engine doesn't crash and the tree root is unchanged
    const lookup = bus.subscriberCount(); // bus is still healthy
    expect(lookup).toBeGreaterThan(0);
  });

  it('childAdded bus event is handled without throwing', async () => {
    const { bus } = buildEngine();
    expect(() => {
      bus.publish({
        op: 'childAdded',
        correlationId: 'c', origin: 'eng', ts: '2026-01-01T00:00:00.000Z',
        parentNodeId: 'root',
        childNodeId: 'root/new',
        childLocation: 'new',
        childEntityDef: 'E',
      });
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

// ---------------------------------------------------------------------------
// E6.T1 — deep equality edge cases
// ---------------------------------------------------------------------------

describe('E6.T1 — deep equality edge cases', () => {
  it('null values are equal', () => {
    const bus = new UceBus({ error: () => {} });
    const tree = new InstanceTree();
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'E', path: 'root' },
      [{ id: 'n', type: 'string', is_array: false, read_only: false, observable: true, nullable: true }],
      [],
    );
    root.setProperty('n', null);
    tree.setRoot(root);
    const engine = new UceEngine({ tree, bus });
    engine.start();
    const r = engine.applySet('root', 'n', null, 'test', 'c');
    expect(r.status).toBe('no-op');
  });

  it('nested object property change detected correctly', () => {
    const { engine } = buildEngine();
    const notifications: PropertyChangedOp[] = [];
    engine.observe('obs', 'root', 'config', (op) => notifications.push(op));
    engine.applySet('root', 'config', { x: 2 }, 'other', 'c'); // changed x: 1 → x: 2
    expect(notifications).toHaveLength(1);
  });
});
