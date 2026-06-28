/**
 * E8 — Mapping Engine tests.
 * T1: Ingress DSL schema + wildcard parsing
 * T2: IngressMapper runtime (resolve / onUnresolved policy)
 * T3: Decoders
 * T4: Transform pipeline
 * T5: EgressMapper
 * T6: Reverse mapping
 */

import { describe, it, expect } from 'vitest';

import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { EntityRegistry } from '../../src/engine/types/EntityRegistry.js';
import { decode } from '../../src/mapping/decoders.js';
import { EgressMapper } from '../../src/mapping/EgressMapper.js';
import { IngressMapper, renderReverse } from '../../src/mapping/IngressMapper.js';
import { applyTransforms } from '../../src/mapping/transforms.js';
import {
  IngressMappingSchema,
  IngressRuleSchema,
  EgressMappingSchema,
  ReverseSchema,
  parseTopicFilter,
  extractCaptures,
  interpolateLocation,
} from '../../src/mapping/types.js';

import type { MapperLogger } from '../../src/mapping/IngressMapper.js';
import type { IngressMapping } from '../../src/mapping/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): MapperLogger & { warns: string[]; errors: string[] } {
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    warns,
    errors,
    warn: (m: string) => { warns.push(m); },
    error: (m: string) => { errors.push(m); },
  };
}

function makeTree(): InstanceTree {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'MyRoot', path: 'root' },
    [
      { id: 'temp', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    [{ id: 'm1', args: [], return_type: null, return_is_array: false }],
  );
  const sensor = new InstanceNodeImpl(
    { location: 'sensor-sensor-1', entity_def: 'Sensor', path: 'root/sensor-sensor-1' },
    [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    [],
  );
  root.addChild(sensor);
  tree.setRoot(root);
  return tree;
}

const VALID_INGRESS_MAPPING: IngressMapping = {
  version: 1,
  rules: [
    {
      match: { topicFilter: 'sensors/+sensorId/temperature' },
      target: { location: 'root/sensor-{sensorId}', property: 'temperature', onUnresolved: 'warn' },
      decode: { format: 'json', pointer: '/value', as: 'numeric' },
      transform: [{ op: 'round', decimals: 2 }],
    },
  ],
};

// ---------------------------------------------------------------------------
// E8.T1 — DSL schema validation
// ---------------------------------------------------------------------------

describe('E8.T1 — IngressMappingSchema validation', () => {
  it('accepts a valid ingress mapping', () => {
    expect(() => IngressMappingSchema.parse(VALID_INGRESS_MAPPING)).not.toThrow();
  });

  it('rejects version !== 1', () => {
    const result = IngressMappingSchema.safeParse({ version: 2, rules: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty rules array', () => {
    const result = IngressMappingSchema.safeParse({ version: 1, rules: [] });
    expect(result.success).toBe(false);
  });

  it('rejects unknown decode format', () => {
    const result = IngressRuleSchema.safeParse({
      match: { topicFilter: 'a/+b' },
      target: { location: 'root/{b}', property: 'p' },
      decode: { format: 'binary', as: 'numeric' },
      transform: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown transform op', () => {
    const result = IngressRuleSchema.safeParse({
      match: { topicFilter: 'a/+b' },
      target: { location: 'root/{b}', property: 'p' },
      decode: { format: 'raw-number' },
      transform: [{ op: 'noop' }],
    });
    expect(result.success).toBe(false);
  });

  it('onUnresolved defaults to warn', () => {
    const rule = IngressRuleSchema.parse({
      match: { topicFilter: 'a/+b' },
      target: { location: 'root/{b}', property: 'p' },
      decode: { format: 'raw-number' },
      transform: [],
    });
    expect(rule.target.onUnresolved).toBe('warn');
  });

  it('transform defaults to empty array', () => {
    const rule = IngressRuleSchema.parse({
      match: { topicFilter: 'a/+b' },
      target: { location: 'root/{b}', property: 'p', onUnresolved: 'drop' },
      decode: { format: 'raw-string' },
      transform: [],
    });
    expect(rule.transform).toEqual([]);
  });

  it('accepts a rule with reverse descriptor', () => {
    const result = IngressRuleSchema.safeParse({
      match: { topicFilter: 'sensors/+id/temp' },
      target: { location: 'root/{id}', property: 'temperature', onUnresolved: 'drop' },
      decode: { format: 'raw-number' },
      transform: [],
      reverse: {
        topicTemplate: 'sensors/{id}/temp/set',
        encode: { format: 'json', template: { value: '{$value}' } },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('E8.T1 — EgressMappingSchema validation', () => {
  it('accepts a valid egress mapping', () => {
    const raw = {
      version: 1,
      classes: [
        {
          entityDef: 'Sensor',
          classId: [1, 2, 1],
          properties: [{ id: 'temperature', targetId: { level: 3, index: 1 }, datatype: 'NcFloat64', observable: true }],
          methods: [],
        },
      ],
    };
    expect(() => EgressMappingSchema.parse(raw)).not.toThrow();
  });

  it('rejects empty classes array', () => {
    const result = EgressMappingSchema.safeParse({ version: 1, classes: [] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E8.T1 — wildcard parsing
// ---------------------------------------------------------------------------

describe('E8.T1 — parseTopicFilter + extractCaptures', () => {
  it('parses a single +name wildcard', () => {
    const pf = parseTopicFilter('sensors/+sensorId/temperature');
    expect(pf.names).toEqual(['sensorId']);
    expect(pf.pattern.source).toContain('sensorId');
  });

  it('extracts captures from a matching topic', () => {
    const pf = parseTopicFilter('sensors/+sensorId/temperature');
    const caps = extractCaptures('sensors/temp-1/temperature', pf);
    expect(caps).toEqual({ sensorId: 'temp-1' });
  });

  it('returns null for non-matching topic', () => {
    const pf = parseTopicFilter('sensors/+sensorId/temperature');
    expect(extractCaptures('sensors/temp-1/humidity', pf)).toBeNull();
  });

  it('matches a bare + wildcard (unnamed)', () => {
    const pf = parseTopicFilter('data/+/value');
    expect(pf.names).toHaveLength(0);
    expect(extractCaptures('data/x/value', pf)).toEqual({});
    expect(extractCaptures('data/x/other', pf)).toBeNull();
  });

  it('matches # multi-level wildcard', () => {
    const pf = parseTopicFilter('root/#');
    expect(extractCaptures('root/a/b/c', pf)).toEqual({});
  });

  it('handles multiple named captures', () => {
    const pf = parseTopicFilter('+site/+device/status');
    const caps = extractCaptures('london/sensor-1/status', pf);
    expect(caps).toEqual({ site: 'london', device: 'sensor-1' });
  });

  it('escapes regex metacharacters in literal segments', () => {
    const pf = parseTopicFilter('a.b/+x/c');
    expect(extractCaptures('a.b/val/c', pf)).not.toBeNull();
    expect(extractCaptures('axb/val/c', pf)).toBeNull();
  });
});

describe('E8.T1 — interpolateLocation', () => {
  it('replaces {var} placeholders with captures', () => {
    expect(interpolateLocation('root/sensors/{sensorId}', { sensorId: 'temp-1' }))
      .toBe('root/sensors/temp-1');
  });

  it('leaves unmatched placeholders intact', () => {
    expect(interpolateLocation('root/{missing}', {})).toBe('root/{missing}');
  });

  it('handles multiple replacements', () => {
    expect(interpolateLocation('{site}/{device}', { site: 'a', device: 'b' })).toBe('a/b');
  });
});

// ---------------------------------------------------------------------------
// E8.T3 — Decoders
// ---------------------------------------------------------------------------

describe('E8.T3 — decode: json', () => {
  it('decodes a JSON payload with pointer to numeric', () => {
    const result = decode('{"value":21.4}', { format: 'json', pointer: '/value', as: 'numeric' });
    expect(result).toEqual({ ok: true, value: 21.4 });
  });

  it('decodes JSON without pointer', () => {
    const result = decode('42', { format: 'json', as: 'numeric' });
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('decodes JSON pointer into nested object', () => {
    const result = decode('{"a":{"b":5}}', { format: 'json', pointer: '/a/b', as: 'numeric' });
    expect(result).toEqual({ ok: true, value: 5 });
  });

  it('coerces string to numeric', () => {
    const result = decode('"99.5"', { format: 'json', as: 'numeric' });
    expect(result).toEqual({ ok: true, value: 99.5 });
  });

  it('coerces to bool from json', () => {
    const result = decode('true', { format: 'json', as: 'bool' });
    expect(result).toEqual({ ok: true, value: true });
  });

  it('returns error for invalid JSON', () => {
    const result = decode('{bad}', { format: 'json', as: 'numeric' });
    expect(result.ok).toBe(false);
  });

  it('returns error when coercion fails', () => {
    const result = decode('"not-a-number"', { format: 'json', as: 'numeric' });
    expect(result.ok).toBe(false);
  });

  it('accepts Buffer input', () => {
    const result = decode(Buffer.from('{"v":7}'), { format: 'json', pointer: '/v', as: 'numeric' });
    expect(result).toEqual({ ok: true, value: 7 });
  });

  it('decodes JSON to string type', () => {
    const result = decode('"hello"', { format: 'json', as: 'string' });
    expect(result).toEqual({ ok: true, value: 'hello' });
  });

  it('decodes JSON array pointer', () => {
    const result = decode('[10, 20, 30]', { format: 'json', pointer: '/1', as: 'numeric' });
    expect(result).toEqual({ ok: true, value: 20 });
  });
});

describe('E8.T3 — decode: raw-number', () => {
  it('decodes a numeric string', () => {
    expect(decode('3.14', { format: 'raw-number' })).toEqual({ ok: true, value: 3.14 });
  });

  it('handles whitespace', () => {
    expect(decode('  42  ', { format: 'raw-number' })).toEqual({ ok: true, value: 42 });
  });

  it('returns error for non-numeric', () => {
    expect(decode('abc', { format: 'raw-number' }).ok).toBe(false);
  });

  it('accepts Buffer', () => {
    expect(decode(Buffer.from('7'), { format: 'raw-number' })).toEqual({ ok: true, value: 7 });
  });
});

describe('E8.T3 — decode: raw-string', () => {
  it('returns the string as-is', () => {
    expect(decode('hello world', { format: 'raw-string' })).toEqual({ ok: true, value: 'hello world' });
  });

  it('accepts Buffer and converts to string', () => {
    expect(decode(Buffer.from('hi'), { format: 'raw-string' })).toEqual({ ok: true, value: 'hi' });
  });
});

describe('E8.T3 — decode: custom', () => {
  it('returns an error (adapter must resolve custom handlers)', () => {
    const result = decode('payload', { format: 'custom', handler: './myDecoder.js' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/custom/);
  });
});

// ---------------------------------------------------------------------------
// E8.T4 — Transforms
// ---------------------------------------------------------------------------

describe('E8.T4 — applyTransforms', () => {
  it('identity: empty pipeline returns value unchanged', () => {
    expect(applyTransforms(42, [])).toEqual({ ok: true, value: 42 });
  });

  it('round: rounds to given decimals', () => {
    expect(applyTransforms(3.14159, [{ op: 'round', decimals: 2 }])).toEqual({ ok: true, value: 3.14 });
  });

  it('round: rounds to 0 decimals (integer)', () => {
    expect(applyTransforms(7.7, [{ op: 'round', decimals: 0 }])).toEqual({ ok: true, value: 8 });
  });

  it('round: errors on non-number', () => {
    expect(applyTransforms('hello', [{ op: 'round', decimals: 1 }]).ok).toBe(false);
  });

  it('scale: multiplies value', () => {
    expect(applyTransforms(5, [{ op: 'scale', factor: 2 }])).toEqual({ ok: true, value: 10 });
  });

  it('scale: errors on non-number', () => {
    expect(applyTransforms('x', [{ op: 'scale', factor: 2 }]).ok).toBe(false);
  });

  it('enum-map: maps known key', () => {
    const result = applyTransforms('on', [{ op: 'enum-map', map: { on: true, off: false } }]);
    expect(result).toEqual({ ok: true, value: true });
  });

  it('enum-map: errors on unknown key', () => {
    const result = applyTransforms('maybe', [{ op: 'enum-map', map: { on: 1, off: 0 } }]);
    expect(result.ok).toBe(false);
  });

  it('template: replaces {$value}', () => {
    const result = applyTransforms(42, [{ op: 'template', template: 'val={$value}' }]);
    expect(result).toEqual({ ok: true, value: 'val=42' });
  });

  it('clamp: clamps below min', () => {
    expect(applyTransforms(-5, [{ op: 'clamp', min: 0, max: 100 }])).toEqual({ ok: true, value: 0 });
  });

  it('clamp: clamps above max', () => {
    expect(applyTransforms(200, [{ op: 'clamp', min: 0, max: 100 }])).toEqual({ ok: true, value: 100 });
  });

  it('clamp: passes through in-range value', () => {
    expect(applyTransforms(50, [{ op: 'clamp', min: 0, max: 100 }])).toEqual({ ok: true, value: 50 });
  });

  it('clamp: errors on non-number', () => {
    expect(applyTransforms('x', [{ op: 'clamp', min: 0, max: 1 }]).ok).toBe(false);
  });

  it('chains transforms deterministically', () => {
    const result = applyTransforms(21.4, [
      { op: 'round', decimals: 1 },
      { op: 'scale', factor: 2 },
    ]);
    expect(result).toEqual({ ok: true, value: 42.8 });
  });

  it('short-circuits pipeline on first error', () => {
    const result = applyTransforms('bad', [
      { op: 'round', decimals: 1 },    // will fail
      { op: 'scale', factor: 2 },      // never reached
    ]);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E8.T2 — IngressMapper
// ---------------------------------------------------------------------------

describe('E8.T2 — IngressMapper.map()', () => {
  it('resolves existing node and returns MapResult', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapper = new IngressMapper(VALID_INGRESS_MAPPING, tree, logger);
    const result = mapper.map('sensors/sensor-1/temperature', '{"value":21.4}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodeId).toBe('root/sensor-sensor-1');
      expect(result.property).toBe('temperature');
      expect(result.value).toBe(21.4);
      expect(result.captures).toEqual({ sensorId: 'sensor-1' });
    }
  });

  it('drops when topic matches no rule', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapper = new IngressMapper(VALID_INGRESS_MAPPING, tree, logger);
    const result = mapper.map('other/topic', '{}');
    expect(result.ok).toBe(false);
    expect((result as { dropped: boolean }).dropped).toBe(true);
  });

  it('onUnresolved=warn: logs warning and drops when node not in tree', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapping: IngressMapping = {
      version: 1,
      rules: [{
        match: { topicFilter: 'sensors/+sensorId/temperature' },
        target: { location: 'root/sensor-{sensorId}', property: 'temperature', onUnresolved: 'warn' },
        decode: { format: 'raw-number' },
        transform: [],
      }],
    };
    const mapper = new IngressMapper(mapping, tree, logger);
    const result = mapper.map('sensors/ghost/temperature', '21.4');
    expect(result.ok).toBe(false);
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toMatch(/ghost/);
  });

  it('onUnresolved=error: logs error and returns dropped:false', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapping: IngressMapping = {
      version: 1,
      rules: [{
        match: { topicFilter: 'sensors/+sensorId/temperature' },
        target: { location: 'root/sensor-{sensorId}', property: 'temperature', onUnresolved: 'error' },
        decode: { format: 'raw-number' },
        transform: [],
      }],
    };
    const mapper = new IngressMapper(mapping, tree, logger);
    const result = mapper.map('sensors/ghost/temperature', '21.4');
    expect(result.ok).toBe(false);
    expect((result as { dropped: boolean }).dropped).toBe(false);
    expect(logger.errors).toHaveLength(1);
  });

  it('onUnresolved=drop: silent drop when node not in tree', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapping: IngressMapping = {
      version: 1,
      rules: [{
        match: { topicFilter: 'sensors/+sensorId/temperature' },
        target: { location: 'root/sensor-{sensorId}', property: 'temperature', onUnresolved: 'drop' },
        decode: { format: 'raw-number' },
        transform: [],
      }],
    };
    const mapper = new IngressMapper(mapping, tree, logger);
    const result = mapper.map('sensors/ghost/temperature', '21.4');
    expect(result.ok).toBe(false);
    expect(logger.warns).toHaveLength(0);
    expect(logger.errors).toHaveLength(0);
  });

  it('drops on decode failure', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapper = new IngressMapper(VALID_INGRESS_MAPPING, tree, logger);
    const result = mapper.map('sensors/sensor-1/temperature', '{bad json}');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/[Dd]ecode/);
  });

  it('drops on transform failure', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapping: IngressMapping = {
      version: 1,
      rules: [{
        match: { topicFilter: 'sensors/+sensorId/temperature' },
        target: { location: 'root/sensor-{sensorId}', property: 'temperature', onUnresolved: 'warn' },
        decode: { format: 'raw-string' },
        transform: [{ op: 'round', decimals: 1 }],
      }],
    };
    const mapper = new IngressMapper(mapping, tree, logger);
    const result = mapper.map('sensors/sensor-1/temperature', 'not-a-number');
    expect(result.ok).toBe(false);
  });

  it('drops when property not declared on node', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapping: IngressMapping = {
      version: 1,
      rules: [{
        match: { topicFilter: 'sensors/+sensorId/temperature' },
        target: { location: 'root/sensor-{sensorId}', property: 'ghost_prop', onUnresolved: 'warn' },
        decode: { format: 'raw-number' },
        transform: [],
      }],
    };
    const mapper = new IngressMapper(mapping, tree, logger);
    const result = mapper.map('sensors/sensor-1/temperature', '21.4');
    expect(result.ok).toBe(false);
    expect(logger.warns[0]).toMatch(/ghost_prop/);
  });

  it('skips rules without topicFilter match key', () => {
    const tree = makeTree();
    const logger = makeLogger();
    const mapping: IngressMapping = {
      version: 1,
      rules: [{
        match: { channel: 'x' }, // no topicFilter
        target: { location: 'root', property: 'temp', onUnresolved: 'drop' },
        decode: { format: 'raw-number' },
        transform: [],
      }],
    };
    const mapper = new IngressMapper(mapping, tree, logger);
    const result = mapper.map('any/topic', '1');
    expect(result.ok).toBe(false);
    expect((result as { dropped: boolean }).dropped).toBe(true);
  });
});

describe('E8.T2 — IngressMapper.reverse()', () => {
  it('returns error for non-existent rule index', () => {
    const tree = makeTree();
    const mapper = new IngressMapper(VALID_INGRESS_MAPPING, tree, makeLogger());
    const result = mapper.reverse(99, {}, 21.4);
    expect(result.ok).toBe(false);
  });

  it('returns error for rule with no reverse descriptor', () => {
    const tree = makeTree();
    const mapper = new IngressMapper(VALID_INGRESS_MAPPING, tree, makeLogger());
    const result = mapper.reverse(0, { sensorId: 'temp-1' }, 21.4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no reverse/);
  });
});

// ---------------------------------------------------------------------------
// E8.T5 — EgressMapper
// ---------------------------------------------------------------------------

describe('E8.T5 — EgressMapper', () => {
  function makeEntityRegistry() {
    const reg = new EntityRegistry();
    reg.register({
      entity_name: 'Sensor',
      properties: [
        { id: 'temperature', type: 'numeric' },
        { id: 'label', type: 'string' },
      ],
      methods: [{ id: 'reset', args: [], return_value: { type: null } }],
    });
    return reg;
  }

  it('builds class map for a fully-mapped entity', () => {
    const reg = makeEntityRegistry();
    const mapping = EgressMappingSchema.parse({
      version: 1,
      classes: [{
        entityDef: 'Sensor',
        classId: [1, 2, 1],
        properties: [
          { id: 'temperature', targetId: { level: 3, index: 1 }, datatype: 'NcFloat64' },
          { id: 'label', targetId: { level: 3, index: 2 } },
        ],
        methods: [{ id: 'reset', targetId: { level: 3, index: 1 } }],
      }],
    });
    const mapper = new EgressMapper(mapping, reg);
    expect(mapper.hasGaps()).toBe(false);
    expect(mapper.entityDefs()).toContain('Sensor');
    const cls = mapper.getClass('Sensor');
    expect(cls?.properties.has('temperature')).toBe(true);
    expect(cls?.properties.get('temperature')?.datatype).toBe('NcFloat64');
  });

  it('reports gap for unmapped property', () => {
    const reg = makeEntityRegistry();
    const mapping = EgressMappingSchema.parse({
      version: 1,
      classes: [{
        entityDef: 'Sensor',
        classId: [1, 2, 1],
        properties: [
          { id: 'temperature', targetId: { level: 3, index: 1 } },
          // label is missing
        ],
        methods: [{ id: 'reset', targetId: { level: 3, index: 1 } }],
      }],
    });
    const mapper = new EgressMapper(mapping, reg);
    expect(mapper.hasGaps()).toBe(true);
    const gap = mapper.gaps.find((g) => g.id === 'label');
    expect(gap).toBeDefined();
    expect(gap?.kind).toBe('property');
  });

  it('reports gap for unmapped method', () => {
    const reg = makeEntityRegistry();
    const mapping = EgressMappingSchema.parse({
      version: 1,
      classes: [{
        entityDef: 'Sensor',
        classId: [1, 2, 1],
        properties: [
          { id: 'temperature', targetId: {} },
          { id: 'label', targetId: {} },
        ],
        methods: [], // reset is missing
      }],
    });
    const mapper = new EgressMapper(mapping, reg);
    const gap = mapper.gaps.find((g) => g.id === 'reset');
    expect(gap?.kind).toBe('method');
  });

  it('reports gap for unregistered entityDef', () => {
    const reg = makeEntityRegistry();
    const mapping = EgressMappingSchema.parse({
      version: 1,
      classes: [{ entityDef: 'GhostEntity', classId: [], properties: [], methods: [] }],
    });
    const mapper = new EgressMapper(mapping, reg);
    expect(mapper.hasGaps()).toBe(true);
    expect(mapper.getClass('GhostEntity')).toBeUndefined();
  });

  it('returns undefined for unknown entityDef', () => {
    const reg = makeEntityRegistry();
    const mapping = EgressMappingSchema.parse({
      version: 1,
      classes: [{ entityDef: 'Sensor', classId: [], properties: [], methods: [] }],
    });
    const mapper = new EgressMapper(mapping, reg);
    expect(mapper.getClass('Unknown')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E8.T6 — Reverse mapping (renderReverse)
// ---------------------------------------------------------------------------

describe('E8.T6 — renderReverse', () => {
  it('renders a JSON reverse with {$value} in template', () => {
    const desc = ReverseSchema.parse({
      topicTemplate: 'sensors/{sensorId}/temperature/set',
      encode: { format: 'json', template: { value: '{$value}' } },
    });
    const result = renderReverse(desc, { sensorId: 'temp-1' }, 22.0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.topic).toBe('sensors/temp-1/temperature/set');
      expect(JSON.parse(result.payload)).toEqual({ value: '22' });
    }
  });

  it('renders raw-string format', () => {
    const desc = ReverseSchema.parse({
      topicTemplate: 'devices/{id}/set',
      encode: { format: 'raw-string' },
    });
    const result = renderReverse(desc, { id: 'dev-1' }, 'on');
    expect(result).toEqual({ ok: true, topic: 'devices/dev-1/set', payload: 'on' });
  });

  it('renders raw-number format', () => {
    const desc = ReverseSchema.parse({
      topicTemplate: 'devices/{id}/value',
      encode: { format: 'raw-number' },
    });
    const result = renderReverse(desc, { id: 'dev-1' }, 42);
    expect(result).toEqual({ ok: true, topic: 'devices/dev-1/value', payload: '42' });
  });

  it('renders JSON with no template (serialises value directly)', () => {
    const desc = ReverseSchema.parse({
      topicTemplate: 'topic/{id}',
      encode: { format: 'json' },
    });
    const result = renderReverse(desc, { id: 'x' }, 99);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.payload)).toBe(99);
  });

  it('renders topic with multiple capture vars', () => {
    const desc = ReverseSchema.parse({
      topicTemplate: '{site}/{device}/set',
      encode: { format: 'raw-string' },
    });
    const result = renderReverse(desc, { site: 'london', device: 'sensor-1' }, 'on');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.topic).toBe('london/sensor-1/set');
  });
});

