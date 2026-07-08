/**
 * E9.T2 — AdapterRegistry & factory.
 * E21.T1 — Key factories by (protocol, kind) so the same protocol can register
 *           both ingress and egress factories (e.g. mqtt, nmos-is12).
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
// Helpers
// ---------------------------------------------------------------------------

function registryKey(protocol: string, kind: 'ingress' | 'egress'): string {
  return `${protocol}:${kind}`;
}

// ---------------------------------------------------------------------------
// E9.T2 — AdapterRegistry
// ---------------------------------------------------------------------------

export class AdapterRegistry {
  private readonly _factories = new Map<string, AdapterFactory>();

  /**
   * Register a factory for a given protocol + adapter kind.
   * Silently replaces any previously registered factory for the same pair.
   */
  register(factory: AdapterFactory): void {
    this._factories.set(registryKey(factory.protocol, factory.kind), factory);
  }

  /** Returns true if a factory for the given (protocol, kind) has been registered. */
  has(protocol: string, kind: 'ingress' | 'egress'): boolean {
    return this._factories.has(registryKey(protocol, kind));
  }

  /** All registered protocol tokens (may list the same protocol twice). */
  protocols(): string[] {
    return Array.from(this._factories.values()).map((f) => f.protocol);
  }

  /** All registered (protocol, kind) pairs. */
  entries(): { protocol: string; kind: 'ingress' | 'egress' }[] {
    return Array.from(this._factories.values()).map((f) => ({
      protocol: f.protocol,
      kind: f.kind,
    }));
  }

  /**
   * Create an Adapter instance for the given config entry.
   *
   * @param id      — instance id (from `ingress.id` / `egress[n].id`).
   * @param kind    — 'ingress' | 'egress'.
   * @param protocol — protocol token (from `ingress.protocol` / `egress[n].protocol`).
   * @param config  — raw config block for this instance.
   * @throws AdapterRegistryError if no factory for the (protocol, kind) pair is registered.
   */
  create(
    id: string,
    kind: 'ingress' | 'egress',
    protocol: string,
    config: unknown,
  ): Adapter {
    const factory = this._factories.get(registryKey(protocol, kind));
    if (factory === undefined) {
      const known = this.entries()
        .map((e) => `${e.protocol}:${e.kind}`)
        .join(', ');
      throw new AdapterRegistryError(
        `No factory registered for protocol '${protocol}' kind '${kind}'. ` +
          `Known pairs: ${known || '(none)'}`,
      );
    }
    return factory.create(id, kind, config);
  }
}
