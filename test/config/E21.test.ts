/**
 * E21 — mapping validation dispatch + IS-12 ingress mapping refs tests.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { stringify } from 'yaml';

import { MqttEgressAdapterConfigSchema } from '../../src/adapters/mqtt/egressConfig.js';
import { Is12IngressConfigSchema } from '../../src/adapters/nmos-is12/ingressConfig.js';
import { mappingValidationKind } from '../../src/config/mappingKind.js';
import {
  egressInstanceMappingRefs,
  ingressMappingRefs,
  is12IngressMappingRefs,
  validateAdapterMapping,
  validateIs12IngressMapping,
  validateIngressMapping,
} from '../../src/config/validateMappings.js';
import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { EntityRegistry } from '../../src/engine/types/EntityRegistry.js';

function makeTree(): InstanceTree {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Block', path: 'root' },
    [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  tree.setRoot(root);
  return tree;
}

function makeEntities(): EntityRegistry {
  const reg = new EntityRegistry();
  reg.register({
    entity_name: 'Block',
    properties: [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
    methods: [],
  });
  return reg;
}

describe('E21 — mappingValidationKind', () => {
  it('dispatches mqtt ingress/egress to ingress-rules', () => {
    expect(mappingValidationKind('mqtt', 'ingress')).toBe('ingress-rules');
    expect(mappingValidationKind('mqtt', 'egress')).toBe('ingress-rules');
  });

  it('dispatches nmos-is12 ingress/egress to egress-class-projection', () => {
    expect(mappingValidationKind('nmos-is12', 'ingress')).toBe('egress-class-projection');
    expect(mappingValidationKind('nmos-is12', 'egress')).toBe('egress-class-projection');
  });

  it('throws for unknown protocol', () => {
    expect(() => mappingValidationKind('ghost', 'ingress')).toThrow(/ghost/);
  });
});

describe('E21 — ingressMappingRefs', () => {
  it('skips targets whose location contains capture templates', () => {
    const refs = ingressMappingRefs({
      version: 1,
      rules: [
        {
          match: { topicFilter: 'devices/{id}/set' },
          target: { location: 'devices/{id}', property: 'userLabel' },
          decode: { format: 'raw-string' },
          transform: [],
        },
        {
          match: { topicFilter: 'bridge/root/userLabel/set' },
          target: { location: 'root', property: 'userLabel' },
          decode: { format: 'raw-string' },
          transform: [],
        },
      ],
    });
    expect(refs).toEqual([{ nodeId: 'root', property: 'userLabel' }]);
  });
});

describe('E21 — is12IngressMappingRefs', () => {
  it('extracts UCE node/property refs from class-projection mapping', () => {
    const refs = is12IngressMappingRefs({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }, makeTree());
    expect(refs).toEqual([{ nodeId: 'root', property: 'userLabel' }]);
  });

  it('walks child nodes and ignores entities without class mapping', () => {
    const tree = new InstanceTree();
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    const child = new InstanceNodeImpl(
      { location: 'child', entity_def: 'Unknown', path: 'root/child' },
      [{ id: 'x', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    root.addChild(child);
    tree.setRoot(root);
    const refs = is12IngressMappingRefs({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }, tree);
    expect(refs).toEqual([{ nodeId: 'root', property: 'userLabel' }]);
  });

  it('returns empty refs when tree has no root', () => {
    const refs = is12IngressMappingRefs({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }, new InstanceTree());
    expect(refs).toEqual([]);
  });
});

describe('E21 — validateIs12IngressMapping', () => {
  it('accepts a valid IS-12 ingress mapping file', () => {
    const dir = join(tmpdir(), `e21-map-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'ingress.is12.yaml');
    writeFileSync(path, stringify({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }));
    expect(() => validateIs12IngressMapping(path, makeTree(), 'test')).not.toThrow();
  });

  it('rejects mapping referencing unknown property', () => {
    const dir = join(tmpdir(), `e21-bad-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'bad.yaml');
    writeFileSync(path, stringify({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'missing', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }));
    expect(() => validateIs12IngressMapping(path, makeTree(), 'test')).toThrow(/missing/);
  });

  it('rejects invalid mapping schema', () => {
    const dir = join(tmpdir(), `e21-schema-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'bad-schema.yaml');
    writeFileSync(path, 'version: 2\nclasses: []\n');
    expect(() => validateIs12IngressMapping(path, makeTree(), 'test')).toThrow(/schema/);
  });
});

describe('E21 — validateAdapterMapping dispatch', () => {
  it('routes mqtt egress to ingress-rules validator', () => {
    const dir = join(tmpdir(), `e21-mqtt-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'egress.mqtt.yaml');
    writeFileSync(path, stringify({
      version: 1,
      rules: [{
        match: { topicFilter: 't/set' },
        target: { location: 'root', property: 'userLabel' },
        decode: { format: 'raw-string' },
        transform: [],
        reverse: { topicTemplate: 't/state', writeStrategy: 'single', encode: { format: 'raw-string' } },
      }],
    }));
    expect(() => validateAdapterMapping('mqtt', 'egress', path, makeTree(), makeEntities(), 'test'))
      .not.toThrow();
  });

  it('routes nmos-is12 egress to egress validator and rejects gaps', () => {
    const dir = join(tmpdir(), `e21-eg-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'egress.is12.yaml');
    writeFileSync(path, stringify({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }));
    expect(() => validateAdapterMapping('nmos-is12', 'egress', path, makeTree(), makeEntities(), 'test'))
      .not.toThrow();
  });

  it('routes nmos-is12 ingress to IS-12 ingress validator', () => {
    const dir = join(tmpdir(), `e21-in-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'ingress.is12.yaml');
    writeFileSync(path, stringify({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }));
    expect(() => validateAdapterMapping('nmos-is12', 'ingress', path, makeTree(), makeEntities(), 'test'))
      .not.toThrow();
  });
});

describe('E21 — adapter config schemas', () => {
  it('Is12IngressConfigSchema requires wsUrl', () => {
    expect(Is12IngressConfigSchema.safeParse({ mapping: '/x' }).success).toBe(false);
    expect(Is12IngressConfigSchema.safeParse({
      wsUrl: 'ws://localhost:9001',
      mapping: '/x',
    }).success).toBe(true);
  });

  it('MqttEgressAdapterConfigSchema accepts minimal egress config', () => {
    expect(MqttEgressAdapterConfigSchema.safeParse({
      url: 'mqtt://localhost:1883',
      mapping: '/x',
    }).success).toBe(true);
  });

  it('validateIngressMapping rejects bad rule target', () => {
    const dir = join(tmpdir(), `e21-ing-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'bad-ingress.yaml');
    writeFileSync(path, stringify({
      version: 1,
      rules: [{
        match: { topicFilter: 't' },
        target: { location: 'missing', property: 'userLabel' },
        decode: { format: 'raw-string' },
        transform: [],
      }],
    }));
    expect(() => validateIngressMapping(path, makeTree(), 'test')).toThrow(/missing/);
  });

  it('egressInstanceMappingRefs extracts instance locations', () => {
    expect(egressInstanceMappingRefs({
      version: 1,
      classes: [],
      instances: [{ location: 'root/child', classId: [1, 1] }],
    })).toEqual([{ nodeId: 'root/child' }]);
  });

  it('validateAdapterMapping rejects incomplete nmos-is12 egress mapping', () => {
    const reg = new EntityRegistry();
    reg.register({
      entity_name: 'Block',
      properties: [
        { id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
        { id: 'extra', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
      ],
      methods: [],
    });
    const tree = makeTree();
    const dir = join(tmpdir(), `e21-gap-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'gappy.yaml');
    writeFileSync(path, stringify({
      version: 1,
      classes: [{
        entityDef: 'Block',
        classId: [1, 1],
        properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 } }],
        methods: [],
      }],
    }));
    expect(() => validateAdapterMapping('nmos-is12', 'egress', path, tree, reg, 'test'))
      .toThrow(/incomplete/);
  });
});
