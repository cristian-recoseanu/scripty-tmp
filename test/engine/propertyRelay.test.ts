/**
 * E22 — UCE property relay unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makePropertyChangedOp } from '../../src/engine/bus/operations.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { wirePropertyRelays } from '../../src/engine/propertyRelay.js';
import { UceEngine } from '../../src/engine/UceEngine.js';

function makeTree(): InstanceTree {
  const tree = new InstanceTree();
  const propDef = {
    id: 'userLabel',
    type: 'string' as const,
    is_array: false,
    read_only: false,
    observable: true,
    nullable: false,
  };
  const ingress = new InstanceNodeImpl(
    { location: 'ingress-block', entity_def: 'Block', path: 'root/ingress-block' },
    [propDef],
    [],
  );
  ingress.setProperty('userLabel', 'a');
  const egress = new InstanceNodeImpl(
    { location: 'egress-block', entity_def: 'Block', path: 'root/egress-block' },
    [propDef],
    [],
  );
  egress.setProperty('userLabel', 'b');
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Block', path: 'root' },
    [],
    [],
  );
  root.addChild(ingress);
  root.addChild(egress);
  tree.setRoot(root);
  return tree;
}

describe('E22 — wirePropertyRelays', () => {
  let bus: UceBus;
  let engine: UceEngine;
  let unwire: (() => void) | undefined;

  beforeEach(() => {
    bus = new UceBus();
    engine = new UceEngine({ tree: makeTree(), bus });
    engine.start();
    unwire = wirePropertyRelays(bus, engine, [{
      from: { location: 'root/ingress-block', property: 'userLabel' },
      to: { location: 'root/egress-block', property: 'userLabel' },
      bidirectional: true,
    }]);
  });

  afterEach(() => {
    unwire?.();
    engine.stop();
  });

  it('mirrors ingress-block changes to egress-block', () => {
    bus.publish(makePropertyChangedOp({
      origin: 'is12-ingress',
      nodeId: 'root/ingress-block',
      property: 'userLabel',
      value: 'synced',
    }));

    const egress = engine.tree.findById('root/egress-block');
    expect(egress.ok).toBe(true);
    if (!egress.ok) return;
    const prop = egress.node.getProperty('userLabel');
    expect(prop.ok).toBe(true);
    if (prop.ok) expect(prop.value).toBe('synced');
  });

  it('mirrors egress-block changes to ingress-block', () => {
    bus.publish(makePropertyChangedOp({
      origin: 'is12-egress',
      nodeId: 'root/egress-block',
      property: 'userLabel',
      value: 'other-way',
    }));

    const ingress = engine.tree.findById('root/ingress-block');
    expect(ingress.ok).toBe(true);
    if (!ingress.ok) return;
    const prop = ingress.node.getProperty('userLabel');
    expect(prop.ok).toBe(true);
    if (prop.ok) expect(prop.value).toBe('other-way');
  });

  it('does not loop on relay-originated changes', () => {
    const received: string[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => {
      received.push(`${(op as { nodeId: string }).nodeId}:${(op as { origin: string }).origin}`);
    });

    bus.publish(makePropertyChangedOp({
      origin: 'is12-ingress',
      nodeId: 'root/ingress-block',
      property: 'userLabel',
      value: 'once',
    }));

    // One mirror to egress-block; bidirectional echo back to ingress-block is a no-op (same value).
    expect(received.filter((e) => e.startsWith('root/egress-block:'))).toHaveLength(1);
  });
});
