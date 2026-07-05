/**
 * E7.T4 — Startup mapping validation (validateMappings.ts).
 */

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { ConfigError } from '../../src/config/loader.js';
import { loadDatatypes, loadEntities, loadTree } from '../../src/config/modelLoader.js';
import {
  assertNoEgressGaps,
  validateEgressMapping,
  validateIngressMapping,
} from '../../src/config/validateMappings.js';
import { EgressMapper } from '../../src/mapping/EgressMapper.js';

const SCENARIO_03 = resolve('Scenarios/Scenario-03');
const SCENARIO_03_MODEL = join(SCENARIO_03, 'model');

function loadScenario03Tree() {
  const entities = loadEntities(join(SCENARIO_03_MODEL, 'entities.yaml'));
  const datatypes = loadDatatypes(join(SCENARIO_03_MODEL, 'datatypes.yaml'));
  const tree = loadTree(join(SCENARIO_03_MODEL, 'tree.yaml'), entities, datatypes);
  return { entities, tree };
}

describe('E7.T4 — validateIngressMapping', () => {
  it('passes for Scenario-03 ingress mapping', () => {
    const { tree } = loadScenario03Tree();
    expect(() =>
      validateIngressMapping(join(SCENARIO_03, 'mapping/ingress.mqtt.json'), tree, 'mqtt-ingress'),
    ).not.toThrow();
  });

  it('throws ConfigError when ingress targets a missing node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingress-val-'));
    const mappingPath = join(dir, 'bad-ingress.json');
    writeFileSync(
      mappingPath,
      JSON.stringify({
        version: 1,
        rules: [{
          match: { topicFilter: 'devices/x/status' },
          target: { location: 'root/ghost-monitor', property: 'linkStatus', onUnresolved: 'warn' },
          decode: { format: 'raw-number' },
        }],
      }),
    );

    const { tree } = loadScenario03Tree();
    expect(() => validateIngressMapping(mappingPath, tree, 'mqtt-ingress')).toThrow(ConfigError);
    expect(() => validateIngressMapping(mappingPath, tree, 'mqtt-ingress')).toThrow(/ghost-monitor/);
  });

  it('throws ConfigError when ingress targets a missing property', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingress-val-'));
    const mappingPath = join(dir, 'bad-prop.json');
    writeFileSync(
      mappingPath,
      JSON.stringify({
        version: 1,
        rules: [{
          match: { topicFilter: 'devices/x/status' },
          target: {
            location: 'root/receiver-monitors/rx-monitor-01',
            property: 'notAProperty',
            onUnresolved: 'warn',
          },
          decode: { format: 'raw-number' },
        }],
      }),
    );

    const { tree } = loadScenario03Tree();
    expect(() => validateIngressMapping(mappingPath, tree, 'mqtt-ingress')).toThrow(/notAProperty/);
  });
});

describe('E7.T4 — validateEgressMapping', () => {
  it('passes for Scenario-03 egress mapping', () => {
    const { entities, tree } = loadScenario03Tree();
    expect(() =>
      validateEgressMapping(
        join(SCENARIO_03, 'mapping/egress.is12.json'),
        tree,
        entities,
        'is12-egress',
      ),
    ).not.toThrow();
  });

  it('throws ConfigError when egress instance location is missing from tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'egress-val-'));
    const mappingPath = join(dir, 'bad-instance.json');
    const { entities, tree } = loadScenario03Tree();
    writeFileSync(
      mappingPath,
      JSON.stringify({
        version: 1,
        classes: [{ entityDef: 'Block', classId: [1, 1], properties: [], methods: [] }],
        instances: [{ location: 'root/ghost-monitors/tx-monitor-01', touchpoints: [] }],
      }),
    );

    expect(() => validateEgressMapping(mappingPath, tree, entities, 'is12-egress')).toThrow(
      /ghost-monitors/,
    );
  });

  it('throws ConfigError when egress mapping has property gaps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'egress-gap-'));
    const mappingPath = join(dir, 'gappy.json');
    const { entities, tree } = loadScenario03Tree();
    writeFileSync(
      mappingPath,
      JSON.stringify({
        version: 1,
        classes: [{
          entityDef: 'ReceiverMonitor',
          classId: [1, 2, 2, 1],
          properties: [{ id: 'linkStatus', targetId: { level: 4, index: 1 } }],
          methods: [],
        }],
      }),
    );

    expect(() => validateEgressMapping(mappingPath, tree, entities, 'is12-egress')).toThrow(
      /incomplete/,
    );
    expect(() => validateEgressMapping(mappingPath, tree, entities, 'is12-egress')).toThrow(
      /overallStatus/,
    );
  });
});

describe('E7.T4 — assertNoEgressGaps', () => {
  it('throws with gap details when properties are unmapped', () => {
    const reg = loadEntities(join(SCENARIO_03_MODEL, 'entities.yaml'));
    const mapping = {
      version: 1 as const,
      classes: [{
        entityDef: 'ReceiverMonitor',
        classId: [1, 2, 2, 1],
        properties: [{ id: 'linkStatus', targetId: { level: 4, index: 1 } }],
        methods: [],
      }],
    };
    const mapper = new EgressMapper(mapping, reg);
    expect(() => assertNoEgressGaps(mapper, 'test-egress')).toThrow(/overallStatus/);
  });
});
