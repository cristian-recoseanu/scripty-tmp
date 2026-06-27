import { describe, it, expect, vi } from 'vitest';

import {
  makeChildAddedOp,
  makeChildRemovedOp,
  makeMethodInvokeOp,
  makeMethodResultOp,
  makePropertyChangedOp,
  makeSetPropertyOp,
  makeSubscriptionOp,
} from '../../../src/engine/bus/operations.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';

import type {
  ChildAddedOp,
  ChildRemovedOp,
  MethodInvokeOp,
  MethodResultOp,
  Operation,
  PropertyChangedOp,
  SetPropertyOp,
  SubscriptionOp,
} from '../../../src/engine/bus/operations.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE = { correlationId: 'c1', origin: 'test-adapter', ts: '2026-01-01T00:00:00.000Z' };

function propChanged(nodeId = 'root/s1', property = 'temp', value = 21.4): PropertyChangedOp {
  return makePropertyChangedOp({ ...BASE, nodeId, property, changeType: 'valueChanged', value });
}
function setProp(nodeId = 'root/s1', property = 'temp', value = 22.0): SetPropertyOp {
  return makeSetPropertyOp({ ...BASE, nodeId, property, value });
}
function methodInvoke(nodeId = 'root/s1', methodId = 'reset'): MethodInvokeOp {
  return makeMethodInvokeOp({ ...BASE, nodeId, methodId, args: {} });
}
function methodResult(nodeId = 'root/s1', methodId = 'reset'): MethodResultOp {
  return makeMethodResultOp({ ...BASE, nodeId, methodId, status: 200 });
}
function childAdded(): ChildAddedOp {
  return makeChildAddedOp({
    ...BASE,
    parentNodeId: 'root',
    childNodeId: 'root/child-01',
    childLocation: 'child-01',
    childEntityDef: 'MyChild',
  });
}
function childRemoved(): ChildRemovedOp {
  return makeChildRemovedOp({
    ...BASE,
    parentNodeId: 'root',
    childNodeId: 'root/child-01',
    childLocation: 'child-01',
  });
}
function subscription(nodeIds = ['root/s1']): SubscriptionOp {
  return makeSubscriptionOp({ ...BASE, nodeIds });
}

// ---------------------------------------------------------------------------
// E5.T1 — Operation types, factory helpers, round-trip serialization
// ---------------------------------------------------------------------------

describe('E5.T1 — op factories and JSON round-trip', () => {
  it('PropertyChangedOp has correct shape', () => {
    const op = propChanged();
    expect(op.op).toBe('propertyChanged');
    expect(op.correlationId).toBe('c1');
    expect(op.origin).toBe('test-adapter');
    expect(op.nodeId).toBe('root/s1');
    expect(op.property).toBe('temp');
    expect(op.changeType).toBe('valueChanged');
    expect(op.value).toBe(21.4);
  });

  it('SetPropertyOp has correct shape', () => {
    const op = setProp();
    expect(op.op).toBe('setProperty');
    expect(op.value).toBe(22.0);
  });

  it('MethodInvokeOp has correct shape', () => {
    const op = methodInvoke();
    expect(op.op).toBe('methodInvoke');
    expect(op.methodId).toBe('reset');
    expect(op.args).toEqual({});
  });

  it('MethodResultOp has correct shape', () => {
    const op = methodResult();
    expect(op.op).toBe('methodResult');
    expect(op.status).toBe(200);
  });

  it('ChildAddedOp has correct shape', () => {
    const op = childAdded();
    expect(op.op).toBe('childAdded');
    expect(op.parentNodeId).toBe('root');
    expect(op.childLocation).toBe('child-01');
  });

  it('ChildRemovedOp has correct shape', () => {
    const op = childRemoved();
    expect(op.op).toBe('childRemoved');
    expect(op.childNodeId).toBe('root/child-01');
  });

  it('SubscriptionOp has correct shape', () => {
    const op = subscription();
    expect(op.op).toBe('subscription');
    expect(op.nodeIds).toEqual(['root/s1']);
  });

  it('every op round-trips through JSON losslessly', () => {
    const ops: Operation[] = [
      propChanged(), setProp(), methodInvoke(), methodResult(),
      childAdded(), childRemoved(), subscription(),
    ];
    for (const op of ops) {
      const rt = JSON.parse(JSON.stringify(op)) as Operation;
      expect(rt).toEqual(op);
    }
  });

  it('factory stamps ts when not provided', () => {
    const op = makePropertyChangedOp({
      correlationId: 'c2', origin: 'x',
      nodeId: 'root', property: 'p', changeType: 'valueChanged', value: 1,
    });
    expect(typeof op.ts).toBe('string');
    expect(op.ts.length).toBeGreaterThan(0);
  });

  it('origin is preserved on all op types', () => {
    const ops: Operation[] = [
      propChanged(), setProp(), methodInvoke(), methodResult(),
      childAdded(), childRemoved(), subscription(),
    ];
    for (const op of ops) {
      expect(op.origin).toBe('test-adapter');
    }
  });
});

// ---------------------------------------------------------------------------
// E5.T2 — publish / subscribe / filter
// ---------------------------------------------------------------------------

describe('E5.T2 — unfiltered subscribe receives all ops', () => {
  it('receives published op', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({}, (op) => received.push(op));
    bus.publish(propChanged());
    expect(received).toHaveLength(1);
  });

  it('multiple subscribers all receive the op (fan-out)', () => {
    const bus = new UceBus();
    const a: Operation[] = [];
    const b: Operation[] = [];
    bus.subscribe({}, (op) => a.push(op));
    bus.subscribe({}, (op) => b.push(op));
    bus.publish(propChanged());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('E5.T2 — filter by op type', () => {
  it('only matching op type delivered', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op));
    bus.publish(propChanged());
    bus.publish(setProp());
    expect(received).toHaveLength(1);
    expect(received[0]?.op).toBe('propertyChanged');
  });
});

describe('E5.T2 — filter by nodeId', () => {
  it('exact nodeId match', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ nodeId: 'root/s1' }, (op) => received.push(op));
    bus.publish(propChanged('root/s1'));
    bus.publish(propChanged('root/s2'));
    expect(received).toHaveLength(1);
  });

  it('prefix nodeId matches subtree', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ nodeId: 'root/sensors' }, (op) => received.push(op));
    bus.publish(propChanged('root/sensors/temp'));
    bus.publish(propChanged('root/sensors/humidity'));
    bus.publish(propChanged('root/actuators/fan'));
    expect(received).toHaveLength(2);
  });

  it('subscription op (no nodeId) is not matched by nodeId filter', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ nodeId: 'root/s1' }, (op) => received.push(op));
    bus.publish(subscription(['root/s1']));
    expect(received).toHaveLength(0);
  });

  it('childAdded matched by parentNodeId', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ nodeId: 'root' }, (op) => received.push(op));
    bus.publish(childAdded());
    expect(received).toHaveLength(1);
  });
});

describe('E5.T2 — filter by property', () => {
  it('only matching property delivered', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ property: 'temp' }, (op) => received.push(op));
    bus.publish(propChanged('root/s1', 'temp'));
    bus.publish(propChanged('root/s1', 'humidity'));
    expect(received).toHaveLength(1);
  });

  it('property filter does not match non-property ops', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ property: 'temp' }, (op) => received.push(op));
    bus.publish(methodInvoke());
    bus.publish(subscription());
    expect(received).toHaveLength(0);
  });
});

describe('E5.T2 — combined filters (op + nodeId + property)', () => {
  it('all conditions must match', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({ op: 'propertyChanged', nodeId: 'root/s1', property: 'temp' }, (op) => received.push(op));
    bus.publish(propChanged('root/s1', 'temp'));    // match
    bus.publish(propChanged('root/s1', 'humidity')); // wrong property
    bus.publish(propChanged('root/s2', 'temp'));    // wrong node
    bus.publish(setProp('root/s1', 'temp'));        // wrong op type
    expect(received).toHaveLength(1);
  });
});

describe('E5.T2 — unsubscribe', () => {
  it('stops delivery after unsubscribe', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    const sub = bus.subscribe({}, (op) => received.push(op));
    bus.publish(propChanged());
    sub.unsubscribe();
    bus.publish(propChanged());
    expect(received).toHaveLength(1);
  });

  it('subscriberCount reflects unsubscribe', () => {
    const bus = new UceBus();
    const sub = bus.subscribe({}, () => {});
    expect(bus.subscriberCount()).toBe(1);
    sub.unsubscribe();
    expect(bus.subscriberCount()).toBe(0);
  });

  it('other subscribers still receive after one unsubscribes', () => {
    const bus = new UceBus();
    const a: Operation[] = [];
    const b: Operation[] = [];
    const subA = bus.subscribe({}, (op) => a.push(op));
    bus.subscribe({}, (op) => b.push(op));
    subA.unsubscribe();
    bus.publish(propChanged());
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// E5.T3 — Delivery ordering + faulty-handler isolation
// ---------------------------------------------------------------------------

describe('E5.T3 — ordered delivery per nodeId', () => {
  it('ops for same nodeId arrive in publish order', () => {
    const bus = new UceBus();
    const values: unknown[] = [];
    bus.subscribe({ nodeId: 'root/s1' }, (op) => {
      if (op.op === 'propertyChanged') values.push(op.value);
    });
    bus.publish(propChanged('root/s1', 'temp', 1));
    bus.publish(propChanged('root/s1', 'temp', 2));
    bus.publish(propChanged('root/s1', 'temp', 3));
    expect(values).toEqual([1, 2, 3]);
  });

  it('ops for different nodeIds are interleaved in publish order', () => {
    const bus = new UceBus();
    const seen: string[] = [];
    bus.subscribe({}, (op) => {
      if (op.op === 'propertyChanged') seen.push(op.nodeId);
    });
    bus.publish(propChanged('root/a'));
    bus.publish(propChanged('root/b'));
    bus.publish(propChanged('root/a'));
    expect(seen).toEqual(['root/a', 'root/b', 'root/a']);
  });
});

describe('E5.T3 — faulty-handler isolation', () => {
  it('throwing handler does not prevent subsequent handlers from receiving', () => {
    const errors: unknown[] = [];
    const bus = new UceBus({ error: (_m, e) => errors.push(e) });
    const received: Operation[] = [];

    bus.subscribe({}, () => { throw new Error('boom'); });
    bus.subscribe({}, (op) => received.push(op));

    bus.publish(propChanged());
    expect(received).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('bus remains healthy after handler error (can publish again)', () => {
    const bus = new UceBus({ error: () => {} });
    const received: Operation[] = [];
    bus.subscribe({}, () => { throw new Error('boom'); });
    bus.subscribe({}, (op) => received.push(op));
    bus.publish(propChanged());
    bus.publish(propChanged());
    expect(received).toHaveLength(2);
  });

  it('logs the error with correlationId and origin', () => {
    const logArgs: [string, unknown][] = [];
    const bus = new UceBus({ error: (msg, err) => logArgs.push([msg, err]) });
    bus.subscribe({}, () => { throw new Error('kaboom'); });
    bus.publish(propChanged());
    expect(logArgs).toHaveLength(1);
    expect(logArgs[0]?.[0]).toContain('c1');
    expect(logArgs[0]?.[0]).toContain('test-adapter');
  });
});

// ---------------------------------------------------------------------------
// E5.T4 — Correlation propagation
// ---------------------------------------------------------------------------

describe('E5.T4 — correlationId propagation', () => {
  it('correlationId is preserved through a single publish', () => {
    const bus = new UceBus();
    const received: Operation[] = [];
    bus.subscribe({}, (op) => received.push(op));

    const op = propChanged();
    bus.publish(op);
    expect(received[0]?.correlationId).toBe('c1');
  });

  it('correlationId is preserved through fan-out to multiple handlers', () => {
    const bus = new UceBus();
    const ids: string[] = [];
    bus.subscribe({}, (op) => ids.push(op.correlationId));
    bus.subscribe({}, (op) => ids.push(op.correlationId));
    bus.subscribe({}, (op) => ids.push(op.correlationId));

    bus.publish(propChanged());
    expect(ids).toEqual(['c1', 'c1', 'c1']);
  });

  it('trace a simulated ingress → derived op chain: correlationId stays constant', () => {
    const bus = new UceBus();
    const log: string[] = [];

    // Simulate: ingress emits PropertyChangedOp → engine handler emits MethodResultOp
    //           (in reality E6 would do this; here we drive it manually)
    bus.subscribe({ op: 'propertyChanged' }, (op) => {
      log.push(`changed:${op.correlationId}`);
      // Engine derives a downstream op reusing the same correlationId
      bus.publish(makeMethodResultOp({
        correlationId: op.correlationId,
        origin: 'engine',
        nodeId: 'root/s1',
        methodId: 'onChanged',
        status: 200,
      }));
    });

    bus.subscribe({ op: 'methodResult' }, (op) => {
      log.push(`result:${op.correlationId}`);
    });

    bus.publish(propChanged());
    expect(log).toEqual(['changed:c1', 'result:c1']);
  });

  it('different publishes have independent correlationIds', () => {
    const bus = new UceBus();
    const ids: string[] = [];
    bus.subscribe({}, (op) => ids.push(op.correlationId));

    bus.publish(makePropertyChangedOp({
      correlationId: 'aaa', origin: 'x', nodeId: 'root', property: 'p', changeType: 'valueChanged', value: 1,
    }));
    bus.publish(makePropertyChangedOp({
      correlationId: 'bbb', origin: 'x', nodeId: 'root', property: 'p', changeType: 'valueChanged', value: 2,
    }));
    expect(ids).toEqual(['aaa', 'bbb']);
  });
});

// ---------------------------------------------------------------------------
// Misc — default logger path
// ---------------------------------------------------------------------------

describe('E5.T1 — factory ts auto-stamp for remaining op types', () => {
  it('makeSetPropertyOp stamps ts', () => {
    const op = makeSetPropertyOp({ correlationId: 'x', origin: 'o', nodeId: 'root', property: 'p', value: 1 });
    expect(typeof op.ts).toBe('string');
  });
  it('makeMethodInvokeOp stamps ts', () => {
    const op = makeMethodInvokeOp({ correlationId: 'x', origin: 'o', nodeId: 'root', methodId: 'm', args: {} });
    expect(typeof op.ts).toBe('string');
  });
  it('makeMethodResultOp stamps ts', () => {
    const op = makeMethodResultOp({ correlationId: 'x', origin: 'o', nodeId: 'root', methodId: 'm', status: 200 });
    expect(typeof op.ts).toBe('string');
  });
  it('makeChildAddedOp stamps ts', () => {
    const op = makeChildAddedOp({ correlationId: 'x', origin: 'o', parentNodeId: 'root', childNodeId: 'root/c', childLocation: 'c', childEntityDef: 'E' });
    expect(typeof op.ts).toBe('string');
  });
  it('makeChildRemovedOp stamps ts', () => {
    const op = makeChildRemovedOp({ correlationId: 'x', origin: 'o', parentNodeId: 'root', childNodeId: 'root/c', childLocation: 'c' });
    expect(typeof op.ts).toBe('string');
  });
  it('makeSubscriptionOp stamps ts', () => {
    const op = makeSubscriptionOp({ correlationId: 'x', origin: 'o', nodeIds: [] });
    expect(typeof op.ts).toBe('string');
  });
});

describe('UceBus — default logger', () => {
  it('writes to stderr when no logger injected (does not throw)', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const bus = new UceBus();
    bus.subscribe({}, () => { throw new Error('oops'); });
    bus.publish(propChanged());
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
