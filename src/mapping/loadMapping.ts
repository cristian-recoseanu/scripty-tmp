/**
 * Load ingress/egress mapping files (YAML only).
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { ConfigError } from '../config/loader.js';

import { EgressMappingSchema, IngressMappingSchema } from './types.js';

import type { EgressMapping, IngressMapping } from './types.js';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

/**
 * Read and parse a mapping file. Only `.yaml` / `.yml` are accepted.
 */
export function loadMappingFile(filePath: string): unknown {
  const ext = extname(filePath).toLowerCase();
  if (!YAML_EXTENSIONS.has(ext)) {
    throw new ConfigError(
      `Mapping file '${filePath}' must be YAML (.yaml or .yml); JSON mapping files are not supported`,
    );
  }
  try {
    const text = readFileSync(filePath, 'utf8');
    return parseYaml(text) as unknown;
  } catch (err) {
    throw new ConfigError(`Failed to read mapping file '${filePath}': ${String(err)}`, err);
  }
}

export function loadIngressMapping(filePath: string): IngressMapping {
  return IngressMappingSchema.parse(loadMappingFile(filePath));
}

export function loadEgressMapping(filePath: string): EgressMapping {
  return EgressMappingSchema.parse(loadMappingFile(filePath));
}
