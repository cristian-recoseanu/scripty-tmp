/**
 * E7.T3 — Model file loaders: entities, datatypes, tree.
 * E7.T4 — Cross-validation: entity_def/type_def resolution + value conformance.
 *
 * All loaders fail fast with actionable errors via ConfigError.
 */

import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';

import type { MethodDescriptor, ModelValue, PropertyDescriptor } from '../engine/model/ObjectNode.js';
import { InstanceNodeImpl } from '../engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../engine/model/ObjectTree.js';
import type { DatatypeDefinition, FieldDef, ValueConstraints } from '../engine/types/Datatype.js';
import { DatatypeRegistry, DatatypeRegistryError } from '../engine/types/DatatypeRegistry.js';
import type { EntityDefinition } from '../engine/types/EntityDefinition.js';
import { EntityRegistry, EntityRegistryError } from '../engine/types/EntityRegistry.js';
import { validateModelValue } from '../engine/types/valueValidator.js';

import { ConfigError } from './loader.js';
import type {
  ParsedDatatypesFile,
  ParsedEntitiesFile,
  ParsedEntityDef,
  ParsedTreeNode,
} from './types.js';
import {
  DatatypesFileSchema,
  EntitiesFileSchema,
  TreeNodeSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers — YAML → zod parse
// ---------------------------------------------------------------------------

function readYaml(filePath: string): unknown {
  try {
    const text = readFileSync(filePath, 'utf8');
    return parseYaml(text) as unknown;
  } catch (err) {
    throw new ConfigError(`Failed to read file '${filePath}': ${String(err)}`, err);
  }
}

function zodParse<T>(schema: { parse: (v: unknown) => T }, raw: unknown, label: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const msgs = err.issues.map((i) => `  ${i.path.join('.')} — ${i.message}`).join('\n');
      throw new ConfigError(`${label} schema validation failed:\n${msgs}`, err);
    }
    throw new ConfigError(`${label} parse error: ${String(err)}`, err);
  }
}

// Safely build a ValueConstraints object stripping undefined fields for exactOptionalPropertyTypes.
// The input comes from zod which infers `number | undefined`, hence the explicit cast below.
function _toConstraints(c: Record<string, unknown> | undefined): ValueConstraints | undefined {
  if (c === undefined) return undefined;
  const out: ValueConstraints = {};
  if (typeof c['min'] === 'number') out.min = c['min'];
  if (typeof c['max'] === 'number') out.max = c['max'];
  if (typeof c['step'] === 'number') out.step = c['step'];
  if (typeof c['minLength'] === 'number') out.minLength = c['minLength'];
  if (typeof c['maxLength'] === 'number') out.maxLength = c['maxLength'];
  if (typeof c['pattern'] === 'string') out.pattern = c['pattern'];
  if (typeof c['minItems'] === 'number') out.minItems = c['minItems'];
  if (typeof c['maxItems'] === 'number') out.maxItems = c['maxItems'];
  return out;
}

// ---------------------------------------------------------------------------
// E7.T3 — Load datatypes.yaml → DatatypeRegistry
// ---------------------------------------------------------------------------

export function loadDatatypes(filePath: string): DatatypeRegistry {
  const raw = readYaml(filePath);
  const parsed: ParsedDatatypesFile = zodParse(DatatypesFileSchema, raw, 'datatypes.yaml');

  const registry = new DatatypeRegistry();
  for (const def of parsed.datatypes) {
    const fields: FieldDef[] = def.fields.map((f) => {
      const field: FieldDef = { id: f.id, type: f.type };
      if (f.is_array !== undefined) field.is_array = f.is_array;
      if (f.type_def !== undefined) field.type_def = f.type_def;
      if (f.nullable !== undefined) field.nullable = f.nullable;
      if (f.description !== undefined) field.description = f.description;
      const c = _toConstraints(f.constraints);
      if (c !== undefined) field.constraints = c;
      return field;
    });
    const dt: DatatypeDefinition = { type_def: def.type_def, fields };
    if (def.description !== undefined) dt.description = def.description;
    registry.register(dt);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// E7.T3 — Load entities.yaml → EntityRegistry
// ---------------------------------------------------------------------------

export function loadEntities(filePath: string): EntityRegistry {
  const raw = readYaml(filePath);
  const parsed: ParsedEntitiesFile = zodParse(EntitiesFileSchema, raw, 'entities.yaml');

  const registry = new EntityRegistry();
  for (const def of parsed.entities) {
    registry.register(_toEntityDefinition(def));
  }
  return registry;
}

function _toEntityDefinition(def: ParsedEntityDef): EntityDefinition {
  return {
    entity_name: def.entity_name,
    properties: def.properties.map((p) => {
      const pd: EntityDefinition['properties'][number] = { id: p.id, type: p.type };
      if (p.is_array !== undefined) pd.is_array = p.is_array;
      if (p.type_def !== undefined) pd.type_def = p.type_def;
      if (p.read_only !== undefined) pd.read_only = p.read_only;
      if (p.observable !== undefined) pd.observable = p.observable;
      if (p.nullable !== undefined) pd.nullable = p.nullable;
      if (p.description !== undefined) pd.description = p.description;
      const c = _toConstraints(p.constraints);
      if (c !== undefined) pd.constraints = c;
      return pd;
    }),
    methods: def.methods.map((m) => ({
      id: m.id,
      args: m.args.map((a) => {
        const ad: EntityDefinition['methods'][number]['args'][number] = { id: a.id, type: a.type };
        if (a.is_array !== undefined) ad.is_array = a.is_array;
        if (a.type_def !== undefined) ad.type_def = a.type_def;
        if (a.description !== undefined) ad.description = a.description;
        return ad;
      }),
      return_value: {
        type: m.return_value.type,
        ...(m.return_value.is_array !== undefined ? { is_array: m.return_value.is_array } : {}),
        ...(m.return_value.type_def !== undefined ? { type_def: m.return_value.type_def } : {}),
      },
      ...(m.description !== undefined ? { description: m.description } : {}),
    })),
    ...(def.description !== undefined ? { description: def.description } : {}),
  };
}

// ---------------------------------------------------------------------------
// E7.T3+T4 — Load tree.yaml → InstanceTree (with cross-validation)
// ---------------------------------------------------------------------------

/**
 * Load the instance tree from a YAML file, validating every `entity_def` and
 * `type_def` reference and every initial property value against the declared type.
 */
export function loadTree(
  filePath: string,
  entityRegistry: EntityRegistry,
  datatypeRegistry: DatatypeRegistry,
): InstanceTree {
  const raw = readYaml(filePath);
  const parsed: ParsedTreeNode = zodParse(TreeNodeSchema, raw, 'tree.yaml');

  const tree = new InstanceTree();
  const root = _buildNode(parsed, parsed.location, entityRegistry, datatypeRegistry);
  tree.setRoot(root);
  return tree;
}

function _buildNode(
  node: ParsedTreeNode,
  nodePath: string,
  entityRegistry: EntityRegistry,
  datatypeRegistry: DatatypeRegistry,
): InstanceNodeImpl {
  // E7.T4 — resolve entity_def (EntityRegistry.get() throws EntityRegistryError if missing)
  let entityDef: EntityDefinition;
  try {
    entityDef = entityRegistry.get(node.entity_def);
  } catch (err) {
    if (err instanceof EntityRegistryError) {
      throw new ConfigError(
        `Node '${nodePath}': entity_def '${node.entity_def}' is not registered. ` +
          `Available: ${entityRegistry.names().join(', ') || '(none)'}`,
        err,
      );
    }
    throw err;
  }

  // Build PropertyDescriptors, cross-validating type_def refs — E7.T4
  const propDescriptors: PropertyDescriptor[] = entityDef.properties.map((p) => {
    if (p.type === 'object' && p.type_def !== undefined && !datatypeRegistry.has(p.type_def)) {
      throw new ConfigError(
        `Node '${nodePath}', property '${p.id}': type_def '${p.type_def}' is not registered.`,
      );
    }
    const pd: PropertyDescriptor = {
      id: p.id,
      type: p.type,
      is_array: p.is_array ?? false,
      read_only: p.read_only ?? false,
      observable: p.observable ?? true,
      nullable: p.nullable ?? false,
    };
    if (p.type_def !== undefined) pd.type_def = p.type_def;
    if (p.description !== undefined) pd.description = p.description;
    if (p.constraints !== undefined) pd.constraints = p.constraints;
    return pd;
  });

  // Build MethodDescriptors
  const methodDescriptors: MethodDescriptor[] = entityDef.methods.map((m) => {
    const md: MethodDescriptor = {
      id: m.id,
      args: m.args.map((a) => {
        const ad: MethodDescriptor['args'][number] = {
          id: a.id,
          type: a.type,
          is_array: a.is_array ?? false,
        };
        if (a.type_def !== undefined) ad.type_def = a.type_def;
        return ad;
      }),
      return_type: m.return_value.type,
      return_is_array: m.return_value.is_array ?? false,
    };
    if (m.return_value.type_def !== undefined) md.return_type_def = m.return_value.type_def;
    if (m.description !== undefined) md.description = m.description;
    return md;
  });

  const impl = new InstanceNodeImpl(
    { location: node.location, entity_def: node.entity_def, path: nodePath },
    propDescriptors,
    methodDescriptors,
  );

  // E7.T3+T4 — apply initial property values with type validation
  for (const pv of node.properties) {
    const descriptor = propDescriptors.find((d) => d.id === pv.id);
    if (descriptor === undefined) {
      throw new ConfigError(
        `Node '${nodePath}': property '${pv.id}' is not declared in entity_def '${node.entity_def}'.`,
      );
    }

    const slotDescriptor = {
      type: descriptor.type,
      is_array: descriptor.is_array,
      nullable: descriptor.nullable,
      ...(descriptor.type_def !== undefined ? { type_def: descriptor.type_def } : {}),
      ...(descriptor.constraints !== undefined ? { constraints: descriptor.constraints } : {}),
    };
    const validationResult = validateModelValue(pv.value, slotDescriptor, datatypeRegistry);
    if (!validationResult.ok) {
      throw new ConfigError(
        `Node '${nodePath}', property '${pv.id}': initial value fails validation — ` +
          validationResult.violations.map((v) => v.reason).join('; '),
      );
    }

    // Use the raw-values map directly so read-only properties can be seeded
    // from tree.yaml during bootstrap (read_only restricts adapter writes, not
    // the initial model state).
    impl._getRawValues().set(pv.id, pv.value as ModelValue);
  }

  // Build children recursively — E7.T4 cross-validates the whole subtree
  for (const child of node.children) {
    const childPath = `${nodePath}/${child.location}`;
    const childNode = _buildNode(child, childPath, entityRegistry, datatypeRegistry);
    impl.addChild(childNode);
  }

  return impl;
}

// ---------------------------------------------------------------------------
// E7.T4 — Cross-validate mapping references against existing nodes/types/methods
// ---------------------------------------------------------------------------

export interface MappingRef {
  nodeId: string;
  property?: string;
  methodId?: string;
}

/**
 * Verify that every mapping reference points to an existing node/property/method.
 * Throws ConfigError on the first dangling reference.
 */
export function crossValidateMappings(
  refs: MappingRef[],
  tree: InstanceTree,
  label: string,
): void {
  for (const ref of refs) {
    const lookup = tree.findById(ref.nodeId);
    if (!lookup.ok) {
      throw new ConfigError(
        `${label}: mapping references node '${ref.nodeId}' which does not exist in the tree.`,
      );
    }
    const node = lookup.node;
    if (ref.property !== undefined && !node.properties.has(ref.property)) {
      throw new ConfigError(
        `${label}: mapping references property '${ref.property}' on node '${ref.nodeId}' which is not declared.`,
      );
    }
    if (ref.methodId !== undefined && !node.methods.has(ref.methodId)) {
      throw new ConfigError(
        `${label}: mapping references method '${ref.methodId}' on node '${ref.nodeId}' which is not declared.`,
      );
    }
  }
}

// Re-export DatatypeRegistryError so callers can catch it without a separate import
export { DatatypeRegistryError, EntityRegistryError };

