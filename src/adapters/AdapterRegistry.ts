/**
 * E9.T2 — AdapterRegistry & factory.
 *
 * Maps protocol tokens to AdapterFactory instances and produces Adapter
 * instances from bridge config entries.
 */

import type { Adapter, AdapterFactory } from './Adapter.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class AdapterRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterRegistryError';
  }
}

// ---------------------------------------------------------------------------
// E9.T2 — AdapterRegistry
// ---------------------------------------------------------------------------

export class AdapterRegistry {
  private readonly _factories = new Map<string, AdapterFactory>();

  /**
   * Register a factory for a given protocol.
   * Silently replaces any previously registered factory for the same protocol.
   */
  register(factory: AdapterFactory): void {
    this._factories.set(factory.protocol, factory);
  }

  /** Returns true if a factory for the given protocol has been registered. */
  has(protocol: string): boolean {
    return this._factories.has(protocol);
  }

  /** All registered protocol tokens. */
  protocols(): string[] {
    return Array.from(this._factories.keys());
  }

  /**
   * Create an Adapter instance for the given config entry.
   *
   * @param id      — instance id (from `ingress.id` / `egress[n].id`).
   * @param kind    — 'ingress' | 'egress'.
   * @param protocol — protocol token (from `ingress.protocol` / `egress[n].protocol`).
   * @param config  — raw config block for this instance.
   * @throws AdapterRegistryError if no factory for the protocol is registered.
   */
  create(
    id: string,
    kind: 'ingress' | 'egress',
    protocol: string,
    config: unknown,
  ): Adapter {
    const factory = this._factories.get(protocol);
    if (factory === undefined) {
      throw new AdapterRegistryError(
        `No factory registered for protocol '${protocol}'. ` +
          `Known protocols: ${this.protocols().join(', ') || '(none)'}`,
      );
    }
    return factory.create(id, kind, config);
  }
}
