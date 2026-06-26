/**
 * UCE Operation union — E5.T1.
 *
 * All operations are JSON-serializable. Every op carries:
 *  - `correlationId`  — unique id assigned at ingress; propagated through all derived ops.
 *  - `origin`         — adapter instance id that first emitted this op.
 *  - `ts`             — ISO-8601 timestamp string (UTC).
 *
 * `nodeId` is the derived location-path (e.g. "root/sensors/temp-1") — the protocol-neutral
 * addressing key for bus filtering. No protocol-specific identifiers may appear here.
 */

import type { ModelValue } from '../model/ObjectNode.js';

// ---------------------------------------------------------------------------
// Shared base fields
// ---------------------------------------------------------------------------

interface OpBase {
  /** Unique id, set at ingress and preserved on all derived ops. */
  correlationId: string;
  /** Adapter instance id that originated this op. */
  origin: string;
  /** ISO-8601 UTC timestamp. */
  ts: string;
}

// ---------------------------------------------------------------------------
// E5.T1 — Individual operation types
// ---------------------------------------------------------------------------

/** Engine re-publishes this after applying a validated state change. */
export interface PropertyChangedOp extends OpBase {
  readonly op: 'propertyChanged';
  /** Protocol-neutral node path (location chain from root). */
  nodeId: string;
  property: string;
  /** 'valueChanged' is the only change type in the core; adapters may extend. */
  changeType: 'valueChanged';
  value: ModelValue;
}

/** Egress (or test harness) requests the engine to set a property value. */
export interface SetPropertyOp extends OpBase {
  readonly op: 'setProperty';
  nodeId: string;
  property: string;
  value: ModelValue;
}

/** Adapter requests a method invocation on the engine. */
export interface MethodInvokeOp extends OpBase {
  readonly op: 'methodInvoke';
  nodeId: string;
  methodId: string;
  args: Record<string, ModelValue>;
}

/** Engine replies to a MethodInvokeOp with the result. */
export interface MethodResultOp extends OpBase {
  readonly op: 'methodResult';
  nodeId: string;
  methodId: string;
  /** HTTP-style status: 200 = OK, 4xx/5xx = error. */
  status: number;
  value?: ModelValue;
  errorMessage?: string;
}

/** Engine emits this when a child node is added to a parent. */
export interface ChildAddedOp extends OpBase {
  readonly op: 'childAdded';
  parentNodeId: string;
  childNodeId: string;
  childLocation: string;
  childEntityDef: string;
}

/** Engine emits this when a child node is removed from a parent. */
export interface ChildRemovedOp extends OpBase {
  readonly op: 'childRemoved';
  parentNodeId: string;
  childNodeId: string;
  childLocation: string;
}

/**
 * Adapter registers or updates its interest in a set of nodeIds.
 * The engine uses this to drive the observation registry (E6.T3).
 */
export interface SubscriptionOp extends OpBase {
  readonly op: 'subscription';
  /** nodeId paths the adapter wants to observe. Empty array = clear all. */
  nodeIds: string[];
}

// ---------------------------------------------------------------------------
// Operation union
// ---------------------------------------------------------------------------

export type Operation =
  | PropertyChangedOp
  | SetPropertyOp
  | MethodInvokeOp
  | MethodResultOp
  | ChildAddedOp
  | ChildRemovedOp
  | SubscriptionOp;

export type OpType = Operation['op'];

// ---------------------------------------------------------------------------
// Factory helpers (produce ops with current timestamp)
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

export function makePropertyChangedOp(
  fields: Omit<PropertyChangedOp, 'op' | 'ts'> & { ts?: string },
): PropertyChangedOp {
  return { op: 'propertyChanged', ts: fields.ts ?? now(), ...fields };
}

export function makeSetPropertyOp(
  fields: Omit<SetPropertyOp, 'op' | 'ts'> & { ts?: string },
): SetPropertyOp {
  return { op: 'setProperty', ts: fields.ts ?? now(), ...fields };
}

export function makeMethodInvokeOp(
  fields: Omit<MethodInvokeOp, 'op' | 'ts'> & { ts?: string },
): MethodInvokeOp {
  return { op: 'methodInvoke', ts: fields.ts ?? now(), ...fields };
}

export function makeMethodResultOp(
  fields: Omit<MethodResultOp, 'op' | 'ts'> & { ts?: string },
): MethodResultOp {
  return { op: 'methodResult', ts: fields.ts ?? now(), ...fields };
}

export function makeChildAddedOp(
  fields: Omit<ChildAddedOp, 'op' | 'ts'> & { ts?: string },
): ChildAddedOp {
  return { op: 'childAdded', ts: fields.ts ?? now(), ...fields };
}

export function makeChildRemovedOp(
  fields: Omit<ChildRemovedOp, 'op' | 'ts'> & { ts?: string },
): ChildRemovedOp {
  return { op: 'childRemoved', ts: fields.ts ?? now(), ...fields };
}

export function makeSubscriptionOp(
  fields: Omit<SubscriptionOp, 'op' | 'ts'> & { ts?: string },
): SubscriptionOp {
  return { op: 'subscription', ts: fields.ts ?? now(), ...fields };
}
