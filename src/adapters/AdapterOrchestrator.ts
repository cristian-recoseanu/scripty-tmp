/**
 * E9.T3 — Lifecycle orchestrator: ordered init→start, reverse-order stop,
 *          failure rollback.
 * E9.T4 — Implicit fan-out: wire bus so every PropertyChangedOp originating
 *          from the single Ingress is forwarded to every Egress adapter, and
 *          vice-versa (write-back), without any routing table.
 *
 * Fan-out is implicit: the UCE engine already handles origin-excluding fan-out
 * via UceBus; the orchestrator's job is merely to ensure all adapters share the
 * same bus/tree/types context so that wiring is automatic.
 */

import type { Adapter, AdapterContext } from './Adapter.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// ---------------------------------------------------------------------------
// E9.T3 — AdapterOrchestrator
// ---------------------------------------------------------------------------

export class AdapterOrchestrator {
  private readonly _adapters: Adapter[];
  private readonly _ctx: AdapterContext;
  /** Tracks adapters that have been successfully started (for rollback). */
  private _started: Adapter[] = [];

  /**
   * @param adapters — ordered list of adapters (Ingress first, then Egress).
   * @param ctx      — shared AdapterContext injected into every adapter's init().
   */
  constructor(adapters: Adapter[], ctx: AdapterContext) {
    this._adapters = adapters;
    this._ctx = ctx;
  }

  // -------------------------------------------------------------------------
  // E9.T3 — start(): init all, then start all in order
  // -------------------------------------------------------------------------

  /**
   * Initialise then start all adapters in declaration order.
   * If any `start()` call throws, all already-started adapters are stopped
   * in reverse order before re-throwing.
   */
  async start(): Promise<void> {
    // Phase 1: init all adapters
    for (const adapter of this._adapters) {
      try {
        await adapter.init(this._ctx);
      } catch (err) {
        throw new OrchestratorError(
          `Adapter '${adapter.id}' (${adapter.protocol}) failed during init: ${String(err)}`,
          err,
        );
      }
    }

    // Phase 2: start all adapters; rollback on failure
    this._started = [];
    for (const adapter of this._adapters) {
      try {
        await adapter.start();
        this._started.push(adapter);
      } catch (err) {
        // Rollback: stop already-started adapters in reverse order
        await this._rollback();
        throw new OrchestratorError(
          `Adapter '${adapter.id}' (${adapter.protocol}) failed during start: ${String(err)}`,
          err,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // E9.T3 — stop(): reverse-order graceful shutdown
  // -------------------------------------------------------------------------

  /**
   * Stop all started adapters in reverse start order.
   * Errors from individual `stop()` calls are collected and reported together
   * rather than aborting the remaining stops.
   */
  async stop(): Promise<void> {
    const errors: string[] = [];
    const reversed = [...this._started].reverse();
    for (const adapter of reversed) {
      try {
        await adapter.stop();
      } catch (err) {
        errors.push(`'${adapter.id}': ${String(err)}`);
      }
    }
    this._started = [];
    if (errors.length > 0) {
      throw new OrchestratorError(`Stop errors: ${errors.join('; ')}`);
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Snapshot of all adapter health statuses (id → HealthStatus). */
  healthSnapshot(): Map<string, ReturnType<Adapter['health']>> {
    const out = new Map<string, ReturnType<Adapter['health']>>();
    for (const adapter of this._adapters) {
      out.set(adapter.id, adapter.health());
    }
    return out;
  }

  /** Adapters that are currently in the started set. */
  get startedAdapters(): readonly Adapter[] {
    return this._started;
  }

  // -------------------------------------------------------------------------
  // Private — rollback helper
  // -------------------------------------------------------------------------

  private async _rollback(): Promise<void> {
    const reversed = [...this._started].reverse();
    for (const adapter of reversed) {
      try {
        await adapter.stop();
      } catch {
        // suppress errors during rollback — best-effort
      }
    }
    this._started = [];
  }
}
