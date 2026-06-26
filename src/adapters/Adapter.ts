/**
 * E9.T1 — Adapter & AdapterContext interfaces.
 *
 * Adapters only depend on these generic contracts; they never import
 * protocol-specific or engine-internal symbols directly.
 */

import type { UceBus } from '../engine/bus/index.js';
import type { InstanceTree } from '../engine/model/ObjectTree.js';
import type { DatatypeRegistry } from '../engine/types/DatatypeRegistry.js';
import type { EntityRegistry } from '../engine/types/EntityRegistry.js';

// ---------------------------------------------------------------------------
// Logger (subset — adapters see only warn/error/info/debug)
// ---------------------------------------------------------------------------

export interface AdapterLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

// ---------------------------------------------------------------------------
// Health status
// ---------------------------------------------------------------------------

export type HealthState = 'initialising' | 'healthy' | 'degraded' | 'stopped' | 'error';

export interface HealthStatus {
  state: HealthState;
  /** Optional human-readable detail. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// JSON Schema type (opaque — adapters declare their own config schemas)
// ---------------------------------------------------------------------------

export type JSONSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// E9.T1 — AdapterContext
//
// Adapters receive this object from the orchestrator during `init()`.
// They MUST NOT retain a reference to any engine internals beyond what is
// exposed here.
// ---------------------------------------------------------------------------

export interface AdapterContext {
  /** The engine's internal pub/sub bus. */
  bus: UceBus;
  /** The live instance tree (read via findById; never mutate directly). */
  tree: InstanceTree;
  /** Registered datatype definitions. */
  types: DatatypeRegistry;
  /** Registered entity definitions (for egress adapters to build class catalogues). */
  entities: EntityRegistry;
  /** Injected logger — no console.* in adapters. */
  logger: AdapterLogger;
  /** The adapter's own validated config block. */
  config: unknown;
}

// ---------------------------------------------------------------------------
// E9.T1 — Adapter interface
// ---------------------------------------------------------------------------

export interface Adapter {
  /** Instance id from the bridge config (e.g. "plant-mqtt"). */
  readonly id: string;
  /** 'ingress' or 'egress'. */
  readonly kind: 'ingress' | 'egress';
  /** Protocol token used to look up the factory (e.g. "mqtt", "nmos-is12"). */
  readonly protocol: string;

  /** Self-describing config JSON Schema — used for validation and tooling. */
  configSchema(): JSONSchema;

  /** Called once: receive context, validate config, allocate resources. */
  init(ctx: AdapterContext): Promise<void>;
  /** Called after init: open connections, begin subscribing. */
  start(): Promise<void>;
  /** Graceful shutdown — must not throw. */
  stop(): Promise<void>;
  /** Snapshot of current health — synchronous. */
  health(): HealthStatus;
}

// ---------------------------------------------------------------------------
// E9.T2 — AdapterFactory
//
// Protocol implementations register a factory; the orchestrator calls it
// to produce an Adapter instance from config.
// ---------------------------------------------------------------------------

export interface AdapterFactory {
  /** Protocol token this factory handles. */
  readonly protocol: string;
  /**
   * Create a new Adapter instance for the given instance config.
   *
   * @param id  — instance id from the bridge config.
   * @param kind — 'ingress' | 'egress'.
   * @param config — raw config block (will be validated by the adapter via configSchema()).
   */
  create(id: string, kind: 'ingress' | 'egress', config: unknown): Adapter;
}
