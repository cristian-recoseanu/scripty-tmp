/**
 * E7.T4 — Startup validation: mapping files ↔ model tree and egress completeness.
 *
 * Called from app.ts after loadTree() and before adapter init so misconfigured
 * deployments fail fast with actionable ConfigErrors.
 */

import { EgressMapper } from '../mapping/EgressMapper.js';
import { loadEgressMapping, loadIngressMapping } from '../mapping/loadMapping.js';

import { ConfigError } from './loader.js';
import { mappingValidationKind } from './mappingKind.js';
import { crossValidateMappings } from './modelLoader.js';

import type { MappingRef } from './modelLoader.js';
import type { InstanceTree } from '../engine/model/ObjectTree.js';
import type { EntityRegistry } from '../engine/types/EntityRegistry.js';
import type { EgressMapping, IngressMapping } from '../mapping/types.js';

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

/** Extract IS-12 ingress class-projection refs (UCE nodes + properties). */
export function is12IngressMappingRefs(
  mapping: EgressMapping,
  tree: InstanceTree,
): MappingRef[] {
  const classByEntity = new Map(mapping.classes.map((c) => [c.entityDef, c]));
  const refs: MappingRef[] = [];

  const walk = (nodeId: string): void => {
    const lookup = tree.findById(nodeId);
    if (!lookup.ok) return;
    const cls = classByEntity.get(lookup.node.identity.entity_def);
    if (cls !== undefined) {
      for (const prop of cls.properties) {
        refs.push({ nodeId, property: prop.id });
      }
    }
    for (const child of lookup.node.children.values()) {
      walk(child.identity.path);
    }
  };

  const root = tree.root;
  if (root !== undefined) walk(root.identity.path);
  return refs;
}

/**
 * Validate an adapter mapping file using the schema appropriate for (protocol, kind).
 */
export function validateAdapterMapping(
  protocol: string,
  kind: 'ingress' | 'egress',
  mappingPath: string,
  tree: InstanceTree,
  entities: EntityRegistry,
  label: string,
): void {
  const validationKind = mappingValidationKind(protocol, kind);
  if (validationKind === 'ingress-rules') {
    validateIngressMapping(mappingPath, tree, label);
    return;
  }
  if (kind === 'ingress' && protocol === 'nmos-is12') {
    validateIs12IngressMapping(mappingPath, tree, label);
    return;
  }
  validateEgressMapping(mappingPath, tree, entities, label);
}

/**
 * Validate an IS-12 ingress mapping (class-projection shape) against the UCE tree.
 */
export function validateIs12IngressMapping(
  mappingPath: string,
  tree: InstanceTree,
  label: string,
): void {
  let mapping: EgressMapping;
  try {
    mapping = loadEgressMapping(mappingPath);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      `${label}: IS-12 ingress mapping '${mappingPath}' failed schema validation: ${String(err)}`,
      err,
    );
  }
  crossValidateMappings(is12IngressMappingRefs(mapping, tree), tree, label);
  validateIs12IngressRolePaths(mapping, tree, label);
}

/** Every ingress-mapped UCE node with properties must declare instances.rolePath. */
export function validateIs12IngressRolePaths(
  mapping: EgressMapping,
  tree: InstanceTree,
  label: string,
): void {
  const instanceByLocation = new Map((mapping.instances ?? []).map((i) => [i.location, i]));
  const classByEntity = new Map(mapping.classes.map((c) => [c.entityDef, c]));

  const walk = (nodeId: string): void => {
    const lookup = tree.findById(nodeId);
    if (!lookup.ok) return;
    const cls = classByEntity.get(lookup.node.identity.entity_def);
    if (cls !== undefined && cls.properties.length > 0) {
      const inst = instanceByLocation.get(nodeId);
      if (inst?.rolePath === undefined || inst.rolePath.length === 0) {
        throw new ConfigError(
          `${label}: IS-12 ingress mapping missing instances.rolePath for UCE node '${nodeId}'`,
        );
      }
    }
    for (const child of lookup.node.children.values()) {
      walk(child.identity.path);
    }
  };

  const root = tree.root;
  if (root !== undefined) walk(root.identity.path);
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
 * @param mappingPath — absolute path to ingress YAML
 * @param tree — loaded UCE tree
 * @param label — adapter id used in error messages (e.g. `mqtt-ingress`)
 */
export function validateIngressMapping(
  mappingPath: string,
  tree: InstanceTree,
  label: string,
): void {
  let mapping: IngressMapping;
  try {
    mapping = loadIngressMapping(mappingPath);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
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
  let mapping: EgressMapping;
  try {
    mapping = loadEgressMapping(mappingPath);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      `${label}: egress mapping '${mappingPath}' failed schema validation: ${String(err)}`,
      err,
    );
  }
  crossValidateMappings(egressInstanceMappingRefs(mapping), tree, label);
  assertNoEgressGaps(new EgressMapper(mapping, entities), label);
}
