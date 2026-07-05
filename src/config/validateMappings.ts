/**
 * E7.T4 — Startup validation: mapping files ↔ model tree and egress completeness.
 *
 * Called from app.ts after loadTree() and before adapter init so misconfigured
 * deployments fail fast with actionable ConfigErrors.
 */

import { readFileSync } from 'node:fs';

import { EgressMapper } from '../mapping/EgressMapper.js';
import { EgressMappingSchema, IngressMappingSchema } from '../mapping/types.js';

import { ConfigError } from './loader.js';
import { crossValidateMappings } from './modelLoader.js';

import type { MappingRef } from './modelLoader.js';
import type { InstanceTree } from '../engine/model/ObjectTree.js';
import type { EntityRegistry } from '../engine/types/EntityRegistry.js';
import type { EgressMapping, IngressMapping } from '../mapping/types.js';

function readJsonFile(filePath: string): unknown {
  try {
    const text = readFileSync(filePath, 'utf8');
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ConfigError(`Failed to read mapping file '${filePath}': ${String(err)}`, err);
  }
}

/** Extract static ingress target refs (skips locations with `{capture}` templates). */
export function ingressMappingRefs(mapping: IngressMapping): MappingRef[] {
  const refs: MappingRef[] = [];
  for (const rule of mapping.rules) {
    const { location, property } = rule.target;
    if (location.includes('{') || location.includes('}')) continue;
    refs.push({ nodeId: location, property });
  }
  return refs;
}

/** Extract egress per-instance tree paths (e.g. touchpoint bindings). */
export function egressInstanceMappingRefs(mapping: EgressMapping): MappingRef[] {
  return (mapping.instances ?? []).map((instance) => ({ nodeId: instance.location }));
}

/** Fail when any UCE property/method lacks an egress projection entry. */
export function assertNoEgressGaps(mapper: EgressMapper, label: string): void {
  if (!mapper.hasGaps()) return;
  const lines = mapper.gaps.map((gap) => {
    const kind = gap.kind === 'property' ? 'property' : 'method';
    return `  ${gap.entityDef}: unmapped ${kind} '${gap.id}'`;
  });
  throw new ConfigError(
    `${label}: egress mapping is incomplete — every UCE property and method must be mapped:\n${lines.join('\n')}`,
  );
}

/**
 * Validate an ingress mapping file against the loaded instance tree.
 * @param mappingPath — absolute path to ingress JSON
 * @param tree — loaded UCE tree
 * @param label — adapter id used in error messages (e.g. `mqtt-ingress`)
 */
export function validateIngressMapping(
  mappingPath: string,
  tree: InstanceTree,
  label: string,
): void {
  const raw = readJsonFile(mappingPath);
  let mapping: IngressMapping;
  try {
    mapping = IngressMappingSchema.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${label}: ingress mapping '${mappingPath}' failed schema validation: ${String(err)}`,
      err,
    );
  }
  crossValidateMappings(ingressMappingRefs(mapping), tree, label);
}

/**
 * Validate an egress mapping file against the tree (instance paths) and entity
 * registry (full property/method projection via {@link EgressMapper} gaps).
 */
export function validateEgressMapping(
  mappingPath: string,
  tree: InstanceTree,
  entities: EntityRegistry,
  label: string,
): void {
  const raw = readJsonFile(mappingPath);
  let mapping: EgressMapping;
  try {
    mapping = EgressMappingSchema.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${label}: egress mapping '${mappingPath}' failed schema validation: ${String(err)}`,
      err,
    );
  }
  crossValidateMappings(egressInstanceMappingRefs(mapping), tree, label);
  assertNoEgressGaps(new EgressMapper(mapping, entities), label);
}
