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
    entity_name: 'ReceiversBlock',
    properties: [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    methods: [],
  });
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Block', path: 'root' },
    [],
    [],
  );
  const receivers = new InstanceNodeImpl(
    { location: 'receivers-block', entity_def: 'ReceiversBlock', path: 'root/receivers-block' },
    [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  root.addChild(receivers);
  tree.setRoot(root);
  return { tree, entities };
}

const BASE_MAPPING = {
  version: 1 as const,
  classes: [
    {
      entityDef: 'ReceiversBlock',
      classId: [1, 1],
      properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 }, readOnly: false }],
      methods: [],
    },
  ],
  instances: [{ location: 'root/receivers-block', rolePath: 'receivers' }],
};

describe('E21 — Is12IngressMapper', () => {
  it('maps wire property ids to UCE locations after role-path bind', () => {
    const { tree, entities } = makeFixture();
    const mapper = new Is12IngressMapper(BASE_MAPPING, tree, entities);
    expect(mapper.mappedProperties()).toHaveLength(0);
    mapper.bindOids(new Map([['receivers', 9]]));
    expect(mapper.subscriptionOids()).toEqual([9]);
    expect(mapper.resolveFromWire(9, { level: 1, index: 6 }))
      .toEqual({ nodeId: 'root/receivers-block', property: 'userLabel' });
    expect(mapper.resolveToWire('root/receivers-block', 'userLabel')?.oid).toBe(9);
    expect(mapper.resolveToWire('root/receivers-block', 'userLabel')?.readOnly).toBe(false);
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
      instances: [{ location: 'root', rolePath: '.' }],
    }, tree, entities);
    mapper.bindOids(new Map([['.', 1]]));
    expect(mapper.resolveToWire('root', 'skipped')).toBeUndefined();

    const noRoot = new Is12IngressMapper({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
      instances: [{ location: 'root', rolePath: '.' }],
    }, empty, entities);
    expect(noRoot.mappedProperties()).toEqual([]);
  });
});
