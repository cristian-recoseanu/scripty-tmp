/**
 * Mapping file loader — YAML-only enforcement.
 */

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { stringify } from 'yaml';

import { ConfigError } from '../../src/config/loader.js';
import { loadIngressMapping, loadMappingFile } from '../../src/mapping/loadMapping.js';

describe('loadMappingFile', () => {
  it('rejects JSON mapping files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'map-load-'));
    const path = join(dir, 'mapping.json');
    writeFileSync(path, '{"version":1,"rules":[]}');
    expect(() => loadMappingFile(path)).toThrow(ConfigError);
    expect(() => loadMappingFile(path)).toThrow(/YAML/);
  });

  it('loads valid ingress YAML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'map-load-'));
    const path = join(dir, 'ingress.yaml');
    writeFileSync(
      path,
      stringify({
        version: 1,
        rules: [{
          match: { topicFilter: 'a/b' },
          target: { location: 'root', property: 'x', onUnresolved: 'warn' },
          decode: { format: 'raw-string' },
        }],
      }),
    );
    const mapping = loadIngressMapping(path);
    expect(mapping.rules).toHaveLength(1);
  });
});
