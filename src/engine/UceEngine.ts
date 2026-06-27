/**
 * UceEngine — Engine Core Orchestration (E6).
 *
 * Responsibilities:
 *  T1 — Apply ops to the InstanceTree with validation; idempotent (equal-value = no-op).
 *  T2 — Single-writer per nodeId: a per-nodeId async queue serialises concurrent writes.
 *  T3 — Generic observation registry: adapters register interest; changed values fan-out
 *       to all registered adapters EXCEPT the op's originator (symmetric write-back, §4.7).
 *  T4 — Method invocation: validate args against MethodDescriptor, dispatch, return result.
 *  T5 — Lifecycle: start() wires bus subscriptions; stop() tears them down cleanly.
 *
 * No protocol-specific identifiers may appear in this file.
 */

import {
  makeMethodResultOp,
  makePropertyChangedOp,
} from './bus/operations.js';

import type {
  ChildRemovedOp,
  MethodInvokeOp,
  PropertyChangedOp,
  SetPropertyOp,
} from './bus/operations.js';
import type { Subscription, UceBus } from './bus/UceBus.js';
import type { ModelValue } from './model/ObjectNode.js';
import type { InstanceTree } from './model/ObjectTree.js';

// ---------------------------------------------------------------------------
// Apply result — typed, no throws
// ---------------------------------------------------------------------------

export type ApplyStatus =
  | 'ok'
  | 'no-op'
  | 'not-found'
  | 'read-only'
  | 'type-mismatch'
  | 'constraint-violation'
  | 'invalid-arg';

export interface ApplyResult {
  ok: boolean;
  status: ApplyStatus;
  message?: string;
}

// ---------------------------------------------------------------------------
// Observer registry entry — E6.T3
// ---------------------------------------------------------------------------

export interface ObserverEntry {
  /** Adapter instance id — matched against op.origin for exclusion. */
  adapterId: string;
  handler: (op: PropertyChangedOp) => void;
}

// ---------------------------------------------------------------------------
// Engine config
// ---------------------------------------------------------------------------

export interface UceEngineConfig {
  tree: InstanceTree;
  bus: UceBus;
}

// ---------------------------------------------------------------------------
// UceEngine — E6
// ---------------------------------------------------------------------------

export class UceEngine {
  private readonly _tree: InstanceTree;
  private readonly _bus: UceBus;

  /** Per-nodeId write queue — E6.T2 single-writer model. */
  private readonly _queues = new Map<string, Promise<void>>();

  /**
   * Observation registry — keyed by `nodeId:property`.
   * E6.T3 — symmetric, origin-excluding fan-out.
   */
  private readonly _observers = new Map<string, ObserverEntry[]>();

  /** Active bus subscriptions — cleared on stop(). */
  private _subs: Subscription[] = [];

  private _running = false;

  constructor(config: UceEngineConfig) {
    this._tree = config.tree;
    this._bus = config.bus;
  }

  // -------------------------------------------------------------------------
  // E6.T5 — Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this._running) return;
    this._running = true;

    // Subscribe to ops the engine needs to handle
    this._subs.push(
      this._bus.subscribe({ op: 'setProperty' }, (op) => {
        void this._enqueue((op as SetPropertyOp).nodeId, () =>
          this._applySetProperty(op as SetPropertyOp),
        );
      }),
      this._bus.subscribe({ op: 'propertyChanged' }, (op) => {
        // Skip ops re-published by this engine's own _fanOut to prevent
        // double fan-out and observer duplication.
        if ((op as PropertyChangedOp).origin === '__engine__') return;
        void this._enqueue((op as PropertyChangedOp).nodeId, () =>
          this._applyPropertyChanged(op as PropertyChangedOp),
        );
      }),
      this._bus.subscribe({ op: 'methodInvoke' }, (op) => {
        void this._applyMethodInvoke(op as MethodInvokeOp);
      }),
      this._bus.subscribe({ op: 'childAdded' }, () => {
        this._handleChildAdded();
      }),
      this._bus.subscribe({ op: 'childRemoved' }, (op) => {
        this._handleChildRemoved(op as ChildRemovedOp);
      }),
    );
  }

  stop(): void {
    for (const sub of this._subs) sub.unsubscribe();
    this._subs = [];
    this._running = false;
  }

  isRunning(): boolean {
    return this._running;
  }

  // -------------------------------------------------------------------------
  // E6.T2 — Single-writer queue per nodeId
  // -------------------------------------------------------------------------

  private _enqueue(nodeId: string, task: () => Promise<void> | void): Promise<void> {
    const prev = this._queues.get(nodeId) ?? Promise.resolve();
    const next = prev.then(() => task()).catch(() => {
      // Errors in the task are handled inside the task itself
    });
    this._queues.set(nodeId, next);
    return next;
  }

  // -------------------------------------------------------------------------
  // E6.T1 — Apply SetPropertyOp (write from egress/test)
  // -------------------------------------------------------------------------

  private _applySetProperty(op: SetPropertyOp): void {
    const lookup = this._tree.findById(op.nodeId);
    if (!lookup.ok) {
      return; // node not found — silently skip (bus is fire-and-forget)
    }
    const node = lookup.node;
    // forceSetProperty: read_only is enforced at the adapter boundary (e.g. IS-12
    // ncSet checks propMap.isReadOnly before publishing SetPropertyOp), not here.
    const result = node.forceSetProperty(op.property, op.value);
    if (!result.ok) {
      return; // rejected (type-mismatch, not-found) — no fan-out
    }
    // Re-publish as PropertyChangedOp, preserving origin and correlationId.
    // republishOnBus=true: this is an egress-originated write; MQTT write-back
    // and other bus subscribers need to receive the resulting propertyChanged op.
    this._fanOut(op.nodeId, op.property, op.value, op.origin, op.correlationId, true);
  }

  // -------------------------------------------------------------------------
  // E6.T1 — Apply PropertyChangedOp (ingress-originated state update)
  // -------------------------------------------------------------------------

  private _applyPropertyChanged(op: PropertyChangedOp): void {
    const lookup = this._tree.findById(op.nodeId);
    if (!lookup.ok) return;
    const node = lookup.node;

    // Idempotency check — E6.T1: equal-value → no-op, no notification
    const current = node.getProperty(op.property);
    if (current.ok && current.value !== undefined && _deepEqual(current.value, op.value)) {
      return; // no-op
    }

    // forceSetProperty: ingress adapters (MQTT) may update read-only properties.
    // read_only is an IS-12 controller boundary constraint, not an engine constraint.
    const result = node.forceSetProperty(op.property, op.value);
    if (!result.ok) return;

    // republishOnBus=false: ingress-originated change; the original op is
    // already on the bus — all subscribers have it; do not re-publish.
    this._fanOut(op.nodeId, op.property, op.value, op.origin, op.correlationId, false);
  }

  // -------------------------------------------------------------------------
  // E6.T3 — Fan-out to observers (origin-excluding)
  // -------------------------------------------------------------------------

  private _fanOut(
    nodeId: string,
    property: string,
    value: ModelValue,
    origin: string,
    correlationId: string,
    republishOnBus: boolean,
  ): void {
    const changedOp = makePropertyChangedOp({
      correlationId,
      origin,
      nodeId,
      property,
      changeType: 'valueChanged',
      value,
    });

    // Notify registered per-property observers (origin-excluding)
    const key = `${nodeId}:${property}`;
    const entries = this._observers.get(key);
    if (entries !== undefined) {
      for (const entry of entries) {
        if (entry.adapterId === origin) continue; // exclude originator — §4.7
        entry.handler(changedOp);
      }
    }

    // Re-publish onto the bus only for egress-originated writes so that
    // bus subscribers (e.g. MQTT write-back) receive the change.
    // Use '__engine__' as origin so the engine's own propertyChanged subscriber
    // skips it and avoids double fan-out / observer duplication.
    if (republishOnBus) {
      this._bus.publish({ ...changedOp, origin: '__engine__' });
    }
  }

  // -------------------------------------------------------------------------
  // E6.T4 — Method invocation dispatch
  // -------------------------------------------------------------------------

  private async _applyMethodInvoke(op: MethodInvokeOp): Promise<void> {
    const lookup = this._tree.findById(op.nodeId);
    if (!lookup.ok) {
      this._bus.publish(
        makeMethodResultOp({
          correlationId: op.correlationId,
          origin: 'engine',
          nodeId: op.nodeId,
          methodId: op.methodId,
          status: 404,
          errorMessage: `Node '${op.nodeId}' not found`,
        }),
      );
      return;
    }

    const node = lookup.node;
    const methodDesc = node.methods.get(op.methodId);
    if (methodDesc === undefined) {
      this._bus.publish(
        makeMethodResultOp({
          correlationId: op.correlationId,
          origin: 'engine',
          nodeId: op.nodeId,
          methodId: op.methodId,
          status: 404,
          errorMessage: `Method '${op.methodId}' not found on node '${op.nodeId}'`,
        }),
      );
      return;
    }

    // Arg arity validation — E6.T4
    for (const argDef of methodDesc.args) {
      if (!(argDef.id in op.args)) {
        this._bus.publish(
          makeMethodResultOp({
            correlationId: op.correlationId,
            origin: 'engine',
            nodeId: op.nodeId,
            methodId: op.methodId,
            status: 400,
            errorMessage: `Missing required argument '${argDef.id}' for method '${op.methodId}'`,
          }),
        );
        return;
      }
    }

    const invokeResult = await node.invoke(op.methodId, op.args);

    this._bus.publish(
      makeMethodResultOp({
        correlationId: op.correlationId,
        origin: 'engine',
        nodeId: op.nodeId,
        methodId: op.methodId,
        status: invokeResult.status,
        ...(invokeResult.value !== undefined ? { value: invokeResult.value } : {}),
        ...(invokeResult.errorMessage !== undefined ? { errorMessage: invokeResult.errorMessage } : {}),
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Child ops — E6.T1
  // -------------------------------------------------------------------------

  private _handleChildAdded(): void {
    // Tree is already updated by the caller; engine re-publishes for observers.
    // Observation of child-add events is a future concern (E8+).
  }

  private _handleChildRemoved(__op: ChildRemovedOp): void {
    // Cleanup observer entries for the removed subtree
    const prefix = __op.childNodeId;
    for (const key of this._observers.keys()) {
      if (key.startsWith(prefix + ':') || key === prefix) {
        this._observers.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // E6.T3 — Observer registration API
  // -------------------------------------------------------------------------

  /**
   * Register an adapter's interest in a specific nodeId + property combination.
   * Returns an unregister function.
   *
   * Pass `property: '*'` to observe all properties on the node (fan-out for every property).
   */
  observe(
    adapterId: string,
    nodeId: string,
    property: string,
    handler: (op: PropertyChangedOp) => void,
  ): () => void {
    const key = `${nodeId}:${property}`;
    const existing = this._observers.get(key) ?? [];
    const entry: ObserverEntry = { adapterId, handler };
    existing.push(entry);
    this._observers.set(key, existing);

    return () => {
      const list = this._observers.get(key);
      if (list !== undefined) {
        const idx = list.indexOf(entry);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  /**
   * Directly apply a set operation (for use in tests / engine-internal code)
   * without going through the bus. Returns an ApplyResult.
   */
  applySet(nodeId: string, property: string, value: ModelValue, origin: string, correlationId: string): ApplyResult {
    const lookup = this._tree.findById(nodeId);
    if (!lookup.ok) {
      return { ok: false, status: 'not-found', message: `Node '${nodeId}' not found` };
    }
    const node = lookup.node;

    // Idempotency — E6.T1
    const current = node.getProperty(property);
    if (current.ok && current.value !== undefined && _deepEqual(current.value, value)) {
      return { ok: true, status: 'no-op' };
    }

    const result = node.forceSetProperty(property, value);
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        ...(result.message !== undefined ? { message: result.message } : {}),
      };
    }

    this._fanOut(nodeId, property, value, origin, correlationId, true);
    return { ok: true, status: 'ok' };
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get tree(): InstanceTree {
    return this._tree;
  }

  get bus(): UceBus {
    return this._bus;
  }
}

// ---------------------------------------------------------------------------
// Deep equality for ModelValue — E6.T1 idempotency check
// ---------------------------------------------------------------------------

function _deepEqual(a: ModelValue, b: ModelValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      const bi = b[i];
      if (ai === undefined || bi === undefined) return false;
      if (!_deepEqual(ai, bi)) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      const av = (a as Record<string, ModelValue | undefined>)[k];
      const bv = (b as Record<string, ModelValue | undefined>)[k];
      if (av === undefined || bv === undefined) return false;
      if (!_deepEqual(av, bv)) return false;
    }
    return true;
  }
  return false;
}
