/**
 * E12.T3 — Metrics & health.
 *
 * MetricsCollector: subscribes to the bus and counts ops by type.
 * HealthAggregator: collects health snapshots from registered adapters and
 *                   serves a /healthz HTTP endpoint.
 */

import { createServer } from 'node:http';
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';

import type { Adapter, HealthStatus } from '../adapters/Adapter.js';
import type { Operation, OpType } from '../engine/bus/operations.js';
import type { UceBus, Subscription } from '../engine/bus/UceBus.js';

// ---------------------------------------------------------------------------
// MetricsCollector — counters per op type
// ---------------------------------------------------------------------------

export interface OpCounts {
  readonly propertyChanged: number;
  readonly setProperty: number;
  readonly methodInvoke: number;
  readonly methodResult: number;
  readonly childAdded: number;
  readonly childRemoved: number;
  readonly subscription: number;
  readonly errors: number;
}

export class MetricsCollector {
  private _counts: Record<OpType, number> = {
    propertyChanged: 0,
    setProperty: 0,
    methodInvoke: 0,
    methodResult: 0,
    childAdded: 0,
    childRemoved: 0,
    subscription: 0,
  };
  private _errors = 0;
  private _sub: Subscription | undefined;

  attach(bus: UceBus): void {
    if (this._sub !== undefined) return;
    this._sub = bus.subscribe({}, (op) => {
      this._record(op);
    });
  }

  detach(): void {
    this._sub?.unsubscribe();
    this._sub = undefined;
  }

  /** Increment the error counter manually (called by adapter error handlers). */
  incrementErrors(): void {
    this._errors++;
  }

  get counts(): OpCounts {
    return {
      propertyChanged: this._counts['propertyChanged'],
      setProperty: this._counts['setProperty'],
      methodInvoke: this._counts['methodInvoke'],
      methodResult: this._counts['methodResult'],
      childAdded: this._counts['childAdded'],
      childRemoved: this._counts['childRemoved'],
      subscription: this._counts['subscription'],
      errors: this._errors,
    };
  }

  /** Reset all counters to zero. */
  reset(): void {
    this._counts = {
      propertyChanged: 0,
      setProperty: 0,
      methodInvoke: 0,
      methodResult: 0,
      childAdded: 0,
      childRemoved: 0,
      subscription: 0,
    };
    this._errors = 0;
  }

  get isAttached(): boolean {
    return this._sub !== undefined;
  }

  private _record(op: Operation): void {
    this._counts[op.op]++;
  }
}

// ---------------------------------------------------------------------------
// HealthAggregator — collects adapter health + optional /healthz HTTP server
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
  status: 'ok' | 'degraded' | 'error';
  adapters: Record<string, HealthStatus>;
}

export class HealthAggregator {
  private readonly _adapters: Map<string, Adapter> = new Map();
  private _server: HttpServer | undefined;

  /** Register an adapter whose health() will be polled. */
  register(adapter: Adapter): void {
    this._adapters.set(adapter.id, adapter);
  }

  /** Unregister by id. */
  unregister(id: string): void {
    this._adapters.delete(id);
  }

  /** Compute a point-in-time health snapshot across all registered adapters. */
  snapshot(): HealthSnapshot {
    const adapters: Record<string, HealthStatus> = {};
    let overallDegraded = false;
    let overallError = false;

    for (const [id, adapter] of this._adapters) {
      const h = adapter.health();
      adapters[id] = h;
      if (h.state === 'error') overallError = true;
      else if (h.state === 'degraded') overallDegraded = true;
    }

    const status: HealthSnapshot['status'] = overallError
      ? 'error'
      : overallDegraded
        ? 'degraded'
        : 'ok';

    return { status, adapters };
  }

  /**
   * Start a minimal HTTP server serving GET /healthz as JSON.
   * Returns the bound port (useful in tests when port=0).
   */
  startHttpServer(port: number = 0): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          if (req.method === 'GET' && req.url === '/healthz') {
            const snap = this.snapshot();
            const body = JSON.stringify(snap);
            const httpStatus = snap.status === 'ok' ? 200 : snap.status === 'degraded' ? 200 : 503;
            res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
            res.end(body);
          } else {
            res.writeHead(404);
            res.end();
          }
        },
      );

      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        this._server = server;
        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;
        resolve(boundPort);
      });
    });
  }

  stopHttpServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._server === undefined) {
        resolve();
        return;
      }
      this._server.close((err) => {
        this._server = undefined;
        if (err !== undefined) reject(err);
        else resolve();
      });
    });
  }

  get serverListening(): boolean {
    return this._server?.listening === true;
  }
}
