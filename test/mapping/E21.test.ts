/**
 * E21 — IngressMapper accessor tests for MQTT egress snapshot.
 */

import { describe, it, expect } from 'vitest';

import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { IngressMapper } from '../../src/mapping/IngressMapper.js';

const silent = { warn: () => {}, error: () => {} };

describe('E21 — IngressMapper accessors', () => {
  it('exposes rule targets and reverse descriptors by index', () => {
    const tree = new InstanceTree();
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    root.setProperty('userLabel', 'x');
    tree.setRoot(root);

    const mapper = new IngressMapper({
      version: 1,
      rules: [{
        match: { topicFilter: 't/set' },
        target: { location: 'root', property: 'userLabel' },
        decode: { format: 'raw-string' },
        transform: [],
        reverse: { topicTemplate: 't/state', writeStrategy: 'single', encode: { format: 'raw-string' } },
      }],
    }, tree, silent);

    expect(mapper.ruleCount).toBe(1);
    expect(mapper.getRuleTarget(0)?.property).toBe('userLabel');
    expect(mapper.getRuleReverse(0)?.topicTemplate).toBe('t/state');
    expect(mapper.getRuleTarget(99)).toBeUndefined();
    expect(mapper.getRuleReverse(99)).toBeUndefined();
  });
});
