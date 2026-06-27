/**
 * E14.T1 — Shared test builders, factories, and custom Vitest matchers.
 *
 * Usage:
 *   import { nodeBuilder, opBuilder, makeTestCtx, expect } from '../helpers/builders.js';
 */

import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import { makePropertyChangedOp, makeSetPropertyOp } from '../../src/engine/bus/operations.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../src/engine/types/EntityRegistry.js';

import type { AdapterContext, AdapterLogger } from '../../src/adapters/Adapter.js';
import type {
  Operation,
  PropertyChangedOp,
  SetPropertyOp,
} from '../../src/engine/bus/operations.js';
import type { ModelValue, PropertyDescriptor } from '../../src/engine/model/ObjectNode.js';

// ---------------------------------------------------------------------------
// Silent logger
// ---------------------------------------------------------------------------

export const silentLogger: AdapterLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ---------------------------------------------------------------------------
// Node builder
// ---------------------------------------------------------------------------

export interface NodeBuilderOptions {
  location?: string;
  entityDef?: string;
  properties?: PropertyDescriptor[];
  initialValues?: Record<string, ModelValue>;
}

/**
 * Returns a pre-populated InstanceNodeImpl using sensible defaults.
 * Default: one `numeric` property `temperature` (read-write) set to 20.0.
 */
export function buildNode(opts: NodeBuilderOptions = {}): InstanceNodeImpl {
  const {
    location = 'root',
    entityDef = 'TestDevice',
    properties = [
      {
        id: 'temperature',
        type: 'numeric',
        is_array: false,
        read_only: false,
        observable: true,
        nullable: false,
      },
    ],
    initialValues = { temperature: 20.0 },
  } = opts;

  const node = new InstanceNodeImpl(
    { location, entity_def: entityDef, path: location },
    properties,
    [],
  );
  for (const [k, v] of Object.entries(initialValues)) {
    node.setProperty(k, v);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

export interface TreeBuilderResult {
  tree: InstanceTree;
  root: InstanceNodeImpl;
}

/** Creates a single-node InstanceTree with the given root node options. */
export function buildTree(opts: NodeBuilderOptions = {}): TreeBuilderResult {
  const tree = new InstanceTree();
  const root = buildNode(opts);
  tree.setRoot(root);
  return { tree, root };
}

// ---------------------------------------------------------------------------
// EntityRegistry builder
// ---------------------------------------------------------------------------

/**
 * Builds an EntityRegistry that mirrors the properties of the given node options.
 * Needed so IS-12 adapter can build its catalogue correctly.
 */
export function buildEntityRegistry(opts: NodeBuilderOptions = {}): EntityRegistry {
  const {
    entityDef = 'TestDevice',
    properties = [
      {
        id: 'temperature',
        type: 'numeric',
        is_array: false,
        read_only: false,
        observable: true,
        nullable: false,
      },
    ],
  } = opts;

  const reg = new EntityRegistry();
  reg.register({ entity_name: entityDef, properties, methods: [] });
  return reg;
}

// ---------------------------------------------------------------------------
// Op builders
// ---------------------------------------------------------------------------

export interface SetOpOptions {
  origin?: string;
  correlationId?: string;
  nodeId?: string;
  property?: string;
  value?: ModelValue;
}

/** Builds a SetPropertyOp with sensible defaults. */
export function buildSetOp(opts: SetOpOptions = {}): SetPropertyOp {
  return makeSetPropertyOp({
    origin: opts.origin ?? 'test-origin',
    correlationId: opts.correlationId ?? randomUUID(),
    nodeId: opts.nodeId ?? 'root',
    property: opts.property ?? 'temperature',
    value: opts.value ?? 42.0,
  });
}

export interface ChangedOpOptions {
  origin?: string;
  correlationId?: string;
  nodeId?: string;
  property?: string;
  value?: ModelValue;
  changeType?: 'valueChanged';
}

/** Builds a PropertyChangedOp with sensible defaults. */
export function buildChangedOp(opts: ChangedOpOptions = {}): PropertyChangedOp {
  return makePropertyChangedOp({
    origin: opts.origin ?? 'test-origin',
    correlationId: opts.correlationId ?? randomUUID(),
    nodeId: opts.nodeId ?? 'root',
    property: opts.property ?? 'temperature',
    value: opts.value ?? 42.0,
    changeType: opts.changeType ?? 'valueChanged',
  });
}

// ---------------------------------------------------------------------------
// AdapterContext builder
// ---------------------------------------------------------------------------

export interface CtxOptions {
  port?: number;
  tree?: InstanceTree;
  bus?: UceBus;
  entities?: EntityRegistry;
  nodeOpts?: NodeBuilderOptions;
  extraConfig?: Record<string, unknown>;
}

/** Builds a fully wired AdapterContext. */
export function buildCtx(opts: CtxOptions = {}): AdapterContext {
  const { tree } = opts.tree !== undefined
    ? { tree: opts.tree }
    : buildTree(opts.nodeOpts);

  return {
    bus: opts.bus ?? new UceBus(),
    tree,
    types: new DatatypeRegistry(),
    entities: opts.entities ?? buildEntityRegistry(opts.nodeOpts),
    logger: silentLogger,
    config: {
      wsPort: opts.port ?? 0,
      ...opts.extraConfig,
    },
  };
}

// ---------------------------------------------------------------------------
// Op collector helper
// ---------------------------------------------------------------------------

/** Subscribes to all ops on a bus and collects them into an array. */
export function collectOps(bus: UceBus): Operation[] {
  const ops: Operation[] = [];
  bus.subscribe({}, (op) => ops.push(op));
  return ops;
}

// ---------------------------------------------------------------------------
// Custom Vitest matchers
// ---------------------------------------------------------------------------

interface CustomMatchers<R = unknown> {
  toBePropertyChangedOp(nodeId: string, property: string, value: ModelValue): R;
  toHaveOrigin(origin: string): R;
  toHaveCorrelationId(id: string): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toBePropertyChangedOp(
    received: unknown,
    nodeId: string,
    property: string,
    value: ModelValue,
  ) {
    const op = received as Record<string, unknown>;
    const pass =
      op.op === 'propertyChanged' &&
      op.nodeId === nodeId &&
      op.property === property &&
      op.value === value;
    return {
      pass,
      message: () =>
        pass
          ? `Expected op NOT to be PropertyChangedOp(${nodeId}, ${property}, ${JSON.stringify(value)})`
          : `Expected PropertyChangedOp(${nodeId}, ${property}, ${JSON.stringify(value)}) but got: ${JSON.stringify(op)}`,
    };
  },

  toHaveOrigin(received: unknown, origin: string) {
    const op = received as Record<string, unknown>;
    const pass = op.origin === origin;
    return {
      pass,
      message: () =>
        pass
          ? `Expected op NOT to have origin '${origin}'`
          : `Expected origin '${origin}' but got '${String(op.origin)}'`,
    };
  },

  toHaveCorrelationId(received: unknown, id: string) {
    const op = received as Record<string, unknown>;
    const pass = op.correlationId === id;
    return {
      pass,
      message: () =>
        pass
          ? `Expected op NOT to have correlationId '${id}'`
          : `Expected correlationId '${id}' but got '${String(op.correlationId)}'`,
    };
  },
});

export { expect };
