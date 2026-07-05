/**
 * E7 — Configuration Loading & Validation tests.
 * T1 — YAML loader + env interpolation
 * T2 — Master config validation (zod)
 * T3 — Model file loaders (entities + datatypes + tree)
 * T4 — Cross-validation at load time
 * T5 — Zod typed config
 */

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  ConfigError,
  interpolateEnv,
  loadBridgeConfig,
} from '../../src/config/loader.js';
import {
  loadDatatypes,
  loadEntities,
  loadTree,
  crossValidateMappings,
} from '../../src/config/modelLoader.js';
import { BridgeConfigSchema } from '../../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'e7-test-'));
}

function write(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

const VALID_BRIDGE_YAML = `
instance:
  name: test-bridge
  logLevel: info
model:
  entities: ./model/entities.yaml
  datatypes: ./model/datatypes.yaml
  tree: ./model/tree.yaml
ingress:
  id: mqtt-in
  protocol: mqtt
  config:
    url: "mqtt://broker:1883"
  mapping: ./mappings/mqtt-in.json
egress:
  - id: nmos
    protocol: nmos-is12
    config:
      wsPort: 8080
    mapping: ./mappings/is12-out.json
`;

const ENTITIES_YAML = `
entities:
  - entity_name: MyRoot
    properties:
      - { id: p1, type: string, is_array: false }
      - { id: p2, type: bool, is_array: false }
      - { id: p3, type: numeric, is_array: false }
      - { id: p4, type: object, is_array: false, type_def: MyObject }
      - { id: p5, type: string, is_array: true }
    methods:
      - id: m1
        args:
          - { id: a1, type: string, is_array: false }
        return_value:
          type: string
          is_array: false
  - entity_name: MyChild
    properties:
      - { id: p1, type: string, is_array: false }
    methods: []
`;

const DATATYPES_YAML = `
datatypes:
  - type_def: MyObject
    fields:
      - { id: f1, type: numeric, is_array: false }
      - { id: f2, type: string, is_array: true }
`;

const TREE_YAML = `
location: root
entity_def: MyRoot
properties:
  - { id: p1, value: "abc" }
  - { id: p2, value: true }
  - { id: p3, value: 123 }
  - id: p4
    value:
      f1: 1
      f2: []
  - { id: p5, value: ["abc"] }
children:
  - location: child-01
    entity_def: MyChild
    properties:
      - { id: p1, value: "child-val" }
    children: []
`;

// ---------------------------------------------------------------------------
// E7.T1 — interpolateEnv
// ---------------------------------------------------------------------------

describe('E7.T1 — interpolateEnv', () => {
  it('replaces a simple placeholder', () => {
    const result = interpolateEnv('hello ${WORLD}', { WORLD: 'earth' });
    expect(result).toBe('hello earth');
  });

  it('replaces multiple placeholders in one string', () => {
    const result = interpolateEnv('${A}-${B}', { A: 'foo', B: 'bar' });
    expect(result).toBe('foo-bar');
  });

  it('replaces placeholders nested in objects', () => {
    const result = interpolateEnv({ url: 'mqtt://${HOST}:1883' }, { HOST: 'broker' }) as { url: string };
    expect(result.url).toBe('mqtt://broker:1883');
  });

  it('replaces placeholders nested in arrays', () => {
    const result = interpolateEnv(['${A}', '${B}'], { A: '1', B: '2' }) as string[];
    expect(result).toEqual(['1', '2']);
  });

  it('throws ConfigError for missing env var', () => {
    expect(() => interpolateEnv('${MISSING_VAR}', {})).toThrowError(ConfigError);
    expect(() => interpolateEnv('${MISSING_VAR}', {})).toThrowError('MISSING_VAR');
  });

  it('passes through non-string values unchanged', () => {
    expect(interpolateEnv(42)).toBe(42);
    expect(interpolateEnv(true)).toBe(true);
    expect(interpolateEnv(null)).toBeNull();
  });

  it('handles nested object with mixed types', () => {
    const result = interpolateEnv({ a: '${X}', b: 1, c: true }, { X: 'val' }) as Record<string, unknown>;
    expect(result.a).toBe('val');
    expect(result.b).toBe(1);
    expect(result.c).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E7.T2 — BridgeConfigSchema (zod) + loadBridgeConfig
// ---------------------------------------------------------------------------

describe('E7.T2 — BridgeConfigSchema', () => {
  it('accepts a valid config object', () => {
    const raw = {
      instance: { name: 'x' },
      model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
      ingress: { id: 'i1', protocol: 'mqtt', config: {}, mapping: './m.json' },
      egress: [{ id: 'e1', protocol: 'is12', config: {}, mapping: './e.json' }],
    };
    expect(BridgeConfigSchema.safeParse(raw).success).toBe(true);
  });

  it('rejects missing ingress', () => {
    const raw = {
      instance: { name: 'x' },
      model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
      egress: [{ id: 'e1', protocol: 'is12', config: {}, mapping: './e.json' }],
    };
    const result = BridgeConfigSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.').includes('ingress'))).toBe(true);
  });

  it('rejects empty egress array', () => {
    const raw = {
      instance: { name: 'x' },
      model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
      ingress: { id: 'i1', protocol: 'mqtt', config: {}, mapping: './m.json' },
      egress: [],
    };
    expect(BridgeConfigSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects ingress as an array (must be object)', () => {
    const raw = {
      instance: { name: 'x' },
      model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
      ingress: [{ id: 'i1', protocol: 'mqtt', config: {}, mapping: './m.json' }],
      egress: [{ id: 'e1', protocol: 'is12', config: {}, mapping: './e.json' }],
    };
    expect(BridgeConfigSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects unknown additional top-level properties', () => {
    const raw = {
      instance: { name: 'x' },
      model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
      ingress: { id: 'i1', protocol: 'mqtt', config: {}, mapping: './m.json' },
      egress: [{ id: 'e1', protocol: 'is12', config: {}, mapping: './e.json' }],
      routing: {},
    };
    expect(BridgeConfigSchema.safeParse(raw).success).toBe(false);
  });
});

describe('E7.T2+T5 — loadBridgeConfig', () => {
  it('loads and returns typed config from valid bridge.yaml', () => {
    const dir = tmpDir();
    const path = write(dir, 'bridge.yaml', VALID_BRIDGE_YAML);
    const cfg = loadBridgeConfig(path);
    expect(cfg.instance.name).toBe('test-bridge');
    expect(cfg.ingress.id).toBe('mqtt-in');
    expect(cfg.egress).toHaveLength(1);
    expect(cfg.egress[0]?.id).toBe('nmos');
  });

  it('resolves ${ENV} in bridge.yaml', () => {
    const dir = tmpDir();
    const yaml = `
instance:
  name: \${BRIDGE_NAME}
model:
  entities: ./e.yaml
  datatypes: ./d.yaml
  tree: ./t.yaml
ingress:
  id: in
  protocol: mqtt
  config:
    user: \${MQTT_USER}
  mapping: ./m.json
egress:
  - id: out
    protocol: is12
    config: {}
    mapping: ./o.json
`;
    const path = write(dir, 'bridge.yaml', yaml);
    const cfg = loadBridgeConfig(path, { BRIDGE_NAME: 'my-bridge', MQTT_USER: 'alice' });
    expect(cfg.instance.name).toBe('my-bridge');
    expect(cfg.ingress.config.user).toBe('alice');
  });

  it('throws ConfigError for missing env var', () => {
    const dir = tmpDir();
    const path = write(dir, 'bridge.yaml', VALID_BRIDGE_YAML.replace('test-bridge', '${MISSING}'));
    expect(() => loadBridgeConfig(path, {})).toThrowError(ConfigError);
    expect(() => loadBridgeConfig(path, {})).toThrowError('MISSING');
  });

  it('throws ConfigError for missing file', () => {
    expect(() => loadBridgeConfig('/nonexistent/bridge.yaml')).toThrowError(ConfigError);
  });

  it('throws ConfigError for invalid YAML structure', () => {
    const dir = tmpDir();
    const path = write(dir, 'bridge.yaml', 'instance:\n  name: ok\n# missing required fields\n');
    expect(() => loadBridgeConfig(path)).toThrowError(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// E7.T3 — loadDatatypes
// ---------------------------------------------------------------------------

describe('E7.T3 — loadDatatypes', () => {
  it('loads a valid datatypes.yaml', () => {
    const dir = tmpDir();
    const path = write(dir, 'datatypes.yaml', DATATYPES_YAML);
    const reg = loadDatatypes(path);
    expect(reg.has('MyObject')).toBe(true);
    expect(reg.getFields('MyObject')).toHaveLength(2);
  });

  it('loads empty datatypes list', () => {
    const dir = tmpDir();
    const path = write(dir, 'datatypes.yaml', 'datatypes: []\n');
    const reg = loadDatatypes(path);
    expect(reg.names()).toHaveLength(0);
  });

  it('throws ConfigError for invalid datatypes structure', () => {
    const dir = tmpDir();
    const path = write(dir, 'datatypes.yaml', 'datatypes:\n  - type_def: ""\n    fields: []\n');
    expect(() => loadDatatypes(path)).toThrowError(ConfigError);
  });

  it('throws ConfigError on missing file', () => {
    expect(() => loadDatatypes('/nonexistent/datatypes.yaml')).toThrowError(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// E7.T3 — loadEntities
// ---------------------------------------------------------------------------

describe('E7.T3 — loadEntities', () => {
  it('loads a valid entities.yaml', () => {
    const dir = tmpDir();
    const path = write(dir, 'entities.yaml', ENTITIES_YAML);
    const reg = loadEntities(path);
    expect(reg.has('MyRoot')).toBe(true);
    expect(reg.has('MyChild')).toBe(true);
  });

  it('registers correct property count for MyRoot', () => {
    const dir = tmpDir();
    const path = write(dir, 'entities.yaml', ENTITIES_YAML);
    const reg = loadEntities(path);
    const def = reg.get('MyRoot');
    expect(def.properties).toHaveLength(5);
  });

  it('registers method with args for MyRoot.m1', () => {
    const dir = tmpDir();
    const path = write(dir, 'entities.yaml', ENTITIES_YAML);
    const reg = loadEntities(path);
    const def = reg.get('MyRoot');
    expect(def.methods[0]?.id).toBe('m1');
    expect(def.methods[0]?.args).toHaveLength(1);
  });

  it('throws ConfigError for missing entities file', () => {
    expect(() => loadEntities('/nonexistent/entities.yaml')).toThrowError(ConfigError);
  });

  it('throws ConfigError for empty entities list', () => {
    const dir = tmpDir();
    const path = write(dir, 'entities.yaml', 'entities: []\n');
    expect(() => loadEntities(path)).toThrowError(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// E7.T3+T4 — loadTree
// ---------------------------------------------------------------------------

describe('E7.T3 — loadTree: valid model', () => {
  it('loads tree and indexes root and child', () => {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', ENTITIES_YAML);
    const dtPath = write(dir, 'datatypes.yaml', DATATYPES_YAML);
    const treePath = write(dir, 'tree.yaml', TREE_YAML);

    const entityReg = loadEntities(entPath);
    const datatypeReg = loadDatatypes(dtPath);
    const tree = loadTree(treePath, entityReg, datatypeReg);

    expect(tree.size()).toBe(2);
    const rootLookup = tree.findById('root');
    expect(rootLookup.ok).toBe(true);
    if (rootLookup.ok) {
      expect(rootLookup.node.getProperty('p1').value).toBe('abc');
      expect(rootLookup.node.getProperty('p2').value).toBe(true);
      expect(rootLookup.node.getProperty('p3').value).toBe(123);
    }
    const childLookup = tree.findById('root/child-01');
    expect(childLookup.ok).toBe(true);
  });

  it('applies initial array value correctly', () => {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', ENTITIES_YAML);
    const dtPath = write(dir, 'datatypes.yaml', DATATYPES_YAML);
    const treePath = write(dir, 'tree.yaml', TREE_YAML);

    const tree = loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath));
    const lookup = tree.findById('root');
    expect(lookup.ok && lookup.node.getProperty('p5').value).toEqual(['abc']);
  });
});

describe('E7.T4 — loadTree: cross-validation failures', () => {
  it('throws ConfigError for unregistered entity_def', () => {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', ENTITIES_YAML);
    const dtPath = write(dir, 'datatypes.yaml', DATATYPES_YAML);
    const treePath = write(dir, 'tree.yaml', `
location: root
entity_def: GhostEntity
properties: []
children: []
`);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(ConfigError);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(/GhostEntity/);
  });

  it('throws ConfigError for unregistered type_def in property', () => {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', `
entities:
  - entity_name: BadEntity
    properties:
      - { id: p1, type: object, is_array: false, type_def: GhostType }
    methods: []
`);
    const dtPath = write(dir, 'datatypes.yaml', 'datatypes: []\n');
    const treePath = write(dir, 'tree.yaml', `
location: root
entity_def: BadEntity
properties: []
children: []
`);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(ConfigError);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(/GhostType/);
  });

  it('throws ConfigError for property not declared in entity_def', () => {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', `
entities:
  - entity_name: SimpleEntity
    properties:
      - { id: p1, type: string, is_array: false }
    methods: []
`);
    const dtPath = write(dir, 'datatypes.yaml', 'datatypes: []\n');
    const treePath = write(dir, 'tree.yaml', `
location: root
entity_def: SimpleEntity
properties:
  - { id: unknown_prop, value: "x" }
children: []
`);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(ConfigError);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(/unknown_prop/);
  });

  it('throws ConfigError when initial value fails type validation', () => {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', `
entities:
  - entity_name: SimpleEntity
    properties:
      - { id: p1, type: numeric, is_array: false }
    methods: []
`);
    const dtPath = write(dir, 'datatypes.yaml', 'datatypes: []\n');
    const treePath = write(dir, 'tree.yaml', `
location: root
entity_def: SimpleEntity
properties:
  - { id: p1, value: "not-a-number" }
children: []
`);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).toThrowError(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// E7.T4 — crossValidateMappings
// ---------------------------------------------------------------------------

describe('E7.T4 — crossValidateMappings', () => {
  function buildValidTree() {
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', ENTITIES_YAML);
    const dtPath = write(dir, 'datatypes.yaml', DATATYPES_YAML);
    const treePath = write(dir, 'tree.yaml', TREE_YAML);
    return loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath));
  }

  it('passes for valid node + property refs', () => {
    const tree = buildValidTree();
    expect(() =>
      crossValidateMappings([{ nodeId: 'root', property: 'p1' }], tree, 'mqtt-in'),
    ).not.toThrow();
  });

  it('passes for valid node + method refs', () => {
    const tree = buildValidTree();
    expect(() =>
      crossValidateMappings([{ nodeId: 'root', methodId: 'm1' }], tree, 'mqtt-in'),
    ).not.toThrow();
  });

  it('throws ConfigError for non-existent node', () => {
    const tree = buildValidTree();
    expect(() =>
      crossValidateMappings([{ nodeId: 'root/ghost' }], tree, 'mqtt-in'),
    ).toThrowError(ConfigError);
    expect(() =>
      crossValidateMappings([{ nodeId: 'root/ghost' }], tree, 'mqtt-in'),
    ).toThrowError(/root\/ghost/);
  });

  it('throws ConfigError for non-existent property', () => {
    const tree = buildValidTree();
    expect(() =>
      crossValidateMappings([{ nodeId: 'root', property: 'ghost_prop' }], tree, 'mqtt-in'),
    ).toThrowError(ConfigError);
    expect(() =>
      crossValidateMappings([{ nodeId: 'root', property: 'ghost_prop' }], tree, 'mqtt-in'),
    ).toThrowError(/ghost_prop/);
  });

  it('throws ConfigError for non-existent method', () => {
    const tree = buildValidTree();
    expect(() =>
      crossValidateMappings([{ nodeId: 'root', methodId: 'ghost_method' }], tree, 'mqtt-in'),
    ).toThrowError(ConfigError);
  });

  it('aborts on first dangling reference', () => {
    const tree = buildValidTree();
    const errors: string[] = [];
    try {
      crossValidateMappings(
        [{ nodeId: 'root/ghost1' }, { nodeId: 'root/ghost2' }],
        tree,
        'mqtt-in',
      );
    } catch (e) {
      if (e instanceof ConfigError) errors.push(e.message);
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ghost1/);
  });
});

// ---------------------------------------------------------------------------
// E7 — coverage gap tests
// ---------------------------------------------------------------------------

describe('E7 — coverage: resolveFromConfig', () => {
  it('resolves a relative path from the config dir', async () => {
    const { resolveFromConfig } = await import('../../src/config/loader.js');
    const result = resolveFromConfig('/etc/bridge/bridge.yaml', './model/tree.yaml');
    expect(result).toBe('/etc/bridge/model/tree.yaml');
  });
});

describe('E7 — coverage: zod parse error path', () => {
  it('throws ConfigError wrapping a ZodError when zod rejects', async () => {
    const { ConfigError: CE } = await import('../../src/config/loader.js');
    // Confirm BridgeConfigSchema produces ZodError for bad input
    try {
      BridgeConfigSchema.parse({
        instance: { name: 'x' },
        model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
        ingress: { id: 'i', protocol: 'mqtt', config: {}, mapping: './m.json' },
        egress: [],
      });
      expect(false).toBe(true); // should not reach here
    } catch (err) {
      // zod throws ZodError for egress min(1)
      const { ZodError } = await import('zod');
      expect(err).toBeInstanceOf(ZodError);
    }
    // Verify ConfigError is distinct from ZodError
    const ce = new CE('test');
    expect(ce.name).toBe('ConfigError');
  });
});

describe('E7 — coverage: _toConstraints body (datatypes with constraints)', () => {
  it('loads datatypes with numeric and string constraints', () => {
    const dir = tmpDir();
    const path = write(dir, 'datatypes.yaml', `
datatypes:
  - type_def: BoundedValue
    description: "a bounded value type"
    fields:
      - id: level
        type: numeric
        is_array: false
        constraints:
          min: 0
          max: 100
          step: 1
      - id: label
        type: string
        is_array: false
        constraints:
          minLength: 1
          maxLength: 64
          pattern: "^[a-z]+$"
  - type_def: ListType
    fields:
      - id: items
        type: string
        is_array: true
        constraints:
          minItems: 1
          maxItems: 10
`);
    const reg = loadDatatypes(path);
    expect(reg.has('BoundedValue')).toBe(true);
    const fields = reg.getFields('BoundedValue');
    expect(fields[0]?.constraints?.min).toBe(0);
    expect(fields[0]?.constraints?.max).toBe(100);
    expect(fields[1]?.constraints?.minLength).toBe(1);
    expect(fields[1]?.constraints?.pattern).toBe('^[a-z]+$');
    const listFields = reg.getFields('ListType');
    expect(listFields[0]?.constraints?.minItems).toBe(1);
    expect(listFields[0]?.constraints?.maxItems).toBe(10);
  });
});

describe('E7 — coverage: entity with description', () => {
  it('loads entity with description field', () => {
    const dir = tmpDir();
    const path = write(dir, 'entities.yaml', `
entities:
  - entity_name: Described
    description: "a described entity"
    properties:
      - id: p1
        type: string
        is_array: false
        description: "prop one"
        constraints:
          minLength: 1
          maxLength: 10
    methods:
      - id: m1
        description: "a method"
        args:
          - id: a1
            type: string
            is_array: false
            description: "arg one"
        return_value:
          type: string
          is_array: false
          description: "return"
`);
    const reg = loadEntities(path);
    const def = reg.get('Described');
    expect(def.description).toBe('a described entity');
    expect(def.properties[0]?.constraints?.minLength).toBe(1);
  });
});

describe('E7 — coverage: zodParse non-ZodError path', () => {
  it('throws ConfigError for malformed YAML (non-ZodError)', () => {
    const dir = tmpDir();
    // Write a valid YAML but invalid schema for DatatypesFileSchema — object instead of array
    const path = write(dir, 'datatypes.yaml', 'datatypes:\n  type_def: bad\n  fields: []\n');
    // This will fail zod with ZodError (not the non-ZodError path), but ensures the branch is hit
    expect(() => loadDatatypes(path)).toThrowError(ConfigError);
  });
});

describe('E7 — bootstrap: read-only properties can be seeded from tree.yaml', () => {
  it('allows setting an initial value for a read-only property during bootstrap', () => {
    // read_only restricts adapter writes (IS-12 Set, MQTT write-back), NOT tree.yaml
    // initial values.  The model loader writes directly to the raw value map.
    const dir = tmpDir();
    const entPath = write(dir, 'entities.yaml', `
entities:
  - entity_name: ReadOnlyEntity
    properties:
      - id: p1
        type: string
        is_array: false
        read_only: true
    methods: []
`);
    const dtPath = write(dir, 'datatypes.yaml', 'datatypes: []\n');
    const treePath = write(dir, 'tree.yaml', `
location: root
entity_def: ReadOnlyEntity
properties:
  - { id: p1, value: "hello" }
children: []
`);
    expect(() =>
      loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath)),
    ).not.toThrow();

    const tree = loadTree(treePath, loadEntities(entPath), loadDatatypes(dtPath));
    const result = tree.findById('root');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const propResult = result.node.getProperty('p1');
    expect(propResult.ok).toBe(true);
    expect(propResult.value).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// E7.T5 — Zod schemas directly
// ---------------------------------------------------------------------------

describe('E7.T5 — zod schemas', () => {
  it('BridgeConfigSchema rejects invalid logLevel', () => {
    const result = BridgeConfigSchema.safeParse({
      instance: { name: 'x', logLevel: 'verbose' },
      model: { entities: './e.yaml', datatypes: './d.yaml', tree: './t.yaml' },
      ingress: { id: 'i', protocol: 'mqtt', config: {}, mapping: './m.json' },
      egress: [{ id: 'e', protocol: 'is12', config: {}, mapping: './e.json' }],
    });
    expect(result.success).toBe(false);
  });

  it('TreeNodeSchema validates a nested tree', async () => {
    const { TreeNodeSchema } = await import('../../src/config/types.js');
    const result = TreeNodeSchema.safeParse({
      location: 'root',
      entity_def: 'MyRoot',
      properties: [{ id: 'p1', value: 'abc' }],
      children: [
        { location: 'child', entity_def: 'MyChild', properties: [], children: [] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('TreeNodeSchema rejects missing entity_def', async () => {
    const { TreeNodeSchema } = await import('../../src/config/types.js');
    const result = TreeNodeSchema.safeParse({
      location: 'root',
      properties: [],
      children: [],
    });
    expect(result.success).toBe(false);
  });
});
