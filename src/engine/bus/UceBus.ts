/**
 * UceBus — typed in-process pub/sub bus.
 * Covers E5.T2 (publish/subscribe/filter), E5.T3 (ordered delivery + error isolation),
 * E5.T4 (correlationId propagation).
 *
 * Delivery guarantees:
 *  - Handlers for the same nodeId receive ops in publish order (FIFO per nodeId queue).
 *  - A handler that throws is caught, logged, and does not break other handlers.
 *  - correlationId is carried unchanged from the published op to every matching handler.
 *
 * No protocol-specific identifiers may appear in this file.
 */

import type { Operation, OpType } from './operations.js';

// ---------------------------------------------------------------------------
// Filter & handler types — E5.T2
// ---------------------------------------------------------------------------

export interface OpFilter {
  /** If set, only ops with this op type are delivered. */
  op?: OpType;
  /** If set, only ops whose nodeId starts with this prefix are delivered.
   *  Use the full path for exact match, or a prefix like "root/sensors" for subtree. */
  nodeId?: string;
  /** If set, only PropertyChangedOp / SetPropertyOp with this property id are delivered. */
  property?: string;
}

export type OpHandler = (op: Operation) => void;

export interface Subscription {
  unsubscribe(): void;
}

// ---------------------------------------------------------------------------
// Internal subscriber record
// ---------------------------------------------------------------------------

interface SubscriberEntry {
  id: number;
  filter: OpFilter;
  handler: OpHandler;
}

// ---------------------------------------------------------------------------
// UceBus — E5.T2 / E5.T3
// ---------------------------------------------------------------------------

export class UceBus {
  private _subscribers: SubscriberEntry[] = [];
  private _nextId = 1;

  /**
   * Optional logger — injected to avoid a hard dependency on a logging library.
   * Receives caught handler errors.
   */
  readonly logger: { error(msg: string, err: unknown): void };

  constructor(logger?: { error(msg: string, err: unknown): void }) {
    this.logger = logger ?? {
      error(msg: string, err: unknown) {
        process.stderr.write(`[UceBus] ${msg} ${String(err)}\n`);
      },
    };
  }

  // -------------------------------------------------------------------------
  // subscribe — E5.T2
  // -------------------------------------------------------------------------

  subscribe(filter: OpFilter, handler: OpHandler): Subscription {
    const id = this._nextId++;
    this._subscribers.push({ id, filter, handler });
    return {
      unsubscribe: () => {
        this._subscribers = this._subscribers.filter((s) => s.id !== id);
      },
    };
  }

  // -------------------------------------------------------------------------
  // publish — E5.T2 + E5.T3 (ordered + isolated delivery)
  // -------------------------------------------------------------------------

  publish(op: Operation): void {
    for (const sub of this._subscribers) {
      if (!_matches(op, sub.filter)) continue;
      try {
        sub.handler(op);
      } catch (err) {
        this.logger.error(
          `Handler error for op '${op.op}' correlationId='${op.correlationId}' origin='${op.origin}'`,
          err,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // subscriberCount — useful for testing
  // -------------------------------------------------------------------------

  subscriberCount(): number {
    return this._subscribers.length;
  }
}

// ---------------------------------------------------------------------------
// Filter matching — E5.T2
// ---------------------------------------------------------------------------

function _matches(op: Operation, filter: OpFilter): boolean {
  if (filter.op !== undefined && op.op !== filter.op) return false;

  // nodeId matching — applicable to ops that carry nodeId
  if (filter.nodeId !== undefined) {
    const nodeId = _getNodeId(op);
    if (nodeId === undefined) return false;
    if (!nodeId.startsWith(filter.nodeId)) return false;
  }

  // property matching — applicable to propertyChanged / setProperty
  if (filter.property !== undefined) {
    if (op.op !== 'propertyChanged' && op.op !== 'setProperty') return false;
    if (op.property !== filter.property) return false;
  }

  return true;
}

function _getNodeId(op: Operation): string | undefined {
  switch (op.op) {
    case 'propertyChanged':
    case 'setProperty':
    case 'methodInvoke':
    case 'methodResult':
      return op.nodeId;
    case 'childAdded':
    case 'childRemoved':
      return op.parentNodeId;
    case 'subscription':
      return undefined;
  }
}
