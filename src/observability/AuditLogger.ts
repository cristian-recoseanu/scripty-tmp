/**
 * E12.T2 — Operation/message audit logging.
 *
 * Subscribes to the UCE bus and logs every operation with its
 * correlationId, origin, op type, and key fields. This makes a
 * single ingress event traceable end-to-end via correlationId.
 */

import type { Operation } from '../engine/bus/operations.js';
import type { UceBus, Subscription } from '../engine/bus/UceBus.js';

import type { BridgeLogger } from './BridgeLogger.js';

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

export class AuditLogger {
  private readonly _logger: BridgeLogger;
  private _sub: Subscription | undefined;

  constructor(logger: BridgeLogger) {
    this._logger = logger;
  }

  /**
   * Start listening — subscribes to all ops on the bus.
   * Idempotent: calling attach() a second time without detach() is a no-op.
   */
  attach(bus: UceBus): void {
    if (this._sub !== undefined) return;
    this._sub = bus.subscribe({}, (op) => {
      this._logOp(op);
    });
  }

  /**
   * Stop listening — unsubscribes from the bus.
   */
  detach(): void {
    this._sub?.unsubscribe();
    this._sub = undefined;
  }

  get isAttached(): boolean {
    return this._sub !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Private — format and emit
  // ---------------------------------------------------------------------------

  private _logOp(op: Operation): void {
    const base = {
      correlationId: op.correlationId,
      origin: op.origin,
      ts: op.ts,
    };

    switch (op.op) {
      case 'propertyChanged':
        this._logger.info('audit:propertyChanged', {
          ...base,
          nodeId: op.nodeId,
          property: op.property,
          changeType: op.changeType,
        });
        break;

      case 'setProperty':
        this._logger.info('audit:setProperty', {
          ...base,
          nodeId: op.nodeId,
          property: op.property,
        });
        break;

      case 'methodInvoke':
        this._logger.info('audit:methodInvoke', {
          ...base,
          nodeId: op.nodeId,
          methodId: op.methodId,
        });
        break;

      case 'methodResult':
        this._logger.info('audit:methodResult', {
          ...base,
          nodeId: op.nodeId,
          methodId: op.methodId,
          status: op.status,
        });
        break;

      case 'childAdded':
        this._logger.info('audit:childAdded', {
          ...base,
          parentNodeId: op.parentNodeId,
          childNodeId: op.childNodeId,
        });
        break;

      case 'childRemoved':
        this._logger.info('audit:childRemoved', {
          ...base,
          parentNodeId: op.parentNodeId,
          childNodeId: op.childNodeId,
        });
        break;

      case 'subscription':
        this._logger.debug('audit:subscription', {
          ...base,
          nodeIds: op.nodeIds,
        });
        break;
    }
  }
}
