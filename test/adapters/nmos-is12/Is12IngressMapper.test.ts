/**
 * E21 — Is12IngressMapper unit tests.
 */

import { describe, it, expect } from 'vitest';

import { Is12IngressMapper } from '../../../src/adapters/nmos-is12/Is12IngressMapper.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';

function makeFixture(): { tree: InstanceTree; entities: EntityRegistry } {
  const entities = new EntityRegistry();
  entities.register({
    entity_name: 'Block',
    properties: [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    methods: [],
  });
  entities.register({
    entity_name: 'ChildBlock',
    properties: [{ id: 'name', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    methods: [],
  });
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Block', path: 'root' },
    [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  const child = new InstanceNodeImpl(
    { location: 'child', entity_def: 'ChildBlock', path: 'root/child' },
    [{ id: 'name', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  root.addChild(child);
  tree.setRoot(root);
  return { tree, entities };
}

describe('E21 — Is12IngressMapper', () => {
  it('maps wire property ids to UCE locations and back', () => {
    const { tree, entities } = makeFixture();
    const mapper = new Is12IngressMapper({
      version: 1,
      classes: [
        {
          entityDef: 'Block',
          classId: [1, 1],
          properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 }, readOnly: false }],
          methods: [],
        },
        {
          entityDef: 'ChildBlock',
          classId: [1, 1],
          properties: [{ id: 'name', targetId: { level: 1, index: 6 }, readOnly: true }],
          methods: [],
        },
      ],
    }, tree, entities, 1);

    expect(mapper.subscriptionOids()).toEqual([1, 2]);
    expect(mapper.resolveFromWire(1, { level: 1, index: 6 })).toEqual({ nodeId: 'root', property: 'userLabel' });
    expect(mapper.resolveToWire('root', 'userLabel')?.readOnly).toBe(false);
    expect(mapper.resolveToWire('root/child', 'name')?.oid).toBe(2);
    expect(mapper.resolveToWire('root/child', 'name')?.readOnly).toBe(true);
    expect(mapper.resolveFromWire(99, { level: 1, index: 6 })).toBeUndefined();
  });

  it('skips properties without targetId and handles empty tree', () => {
    const { tree, entities } = makeFixture();
    const empty = new InstanceTree();
    const mapper = new Is12IngressMapper({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [
          { id: 'userLabel', targetId: { level: 1, index: 6 } },
          { id: 'skipped', targetId: undefined },
        ],
        methods: [],
      }],
    }, tree, entities, 1);
    expect(mapper.resolveToWire('root', 'skipped')).toBeUndefined();

    const noRoot = new Is12IngressMapper({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }, empty, entities, 1);
    expect(noRoot.mappedProperties()).toEqual([]);
  });
});
