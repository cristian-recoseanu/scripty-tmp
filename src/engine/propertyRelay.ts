/**
 * E22 — UCE property relay: mirror property changes between two tree locations.
 *
 * Used by Scenario-06 (receivers-block ↔ egress-block userLabel sync) and wired from
 * optional `relays` entries in bridge.yaml.
 */

import type { PropertyChangedOp } from './bus/operations.js';
import type { UceBus } from './bus/UceBus.js';
import type { UceEngine } from './UceEngine.js';

export const UCE_RELAY_ORIGIN = 'uce-relay';

export interface PropertyRef {
  readonly location: string;
  readonly property: string;
}

export interface PropertyRelaySpec {
  readonly from: PropertyRef;
  readonly to: PropertyRef;
  readonly bidirectional?: boolean;
}

let _relaySeq = 0;

function nextCorrelationId(): string {
  return `uce-relay-${Date.now()}-${(_relaySeq++).toString()}`;
}

/**
 * Subscribe to bus property changes and mirror configured property pairs through the engine.
 * Returns an unsubscribe function.
 */
export function wirePropertyRelays(
  bus: UceBus,
  engine: UceEngine,
  relays: readonly PropertyRelaySpec[],
): () => void {
  const sub = bus.subscribe({ op: 'propertyChanged' }, (op) => {
    const pc = op as PropertyChangedOp;
    if (pc.origin === UCE_RELAY_ORIGIN) return;

    for (const relay of relays) {
      if (pc.nodeId === relay.from.location && pc.property === relay.from.property) {
        engine.applySet(
          relay.to.location,
          relay.to.property,
          pc.value,
          UCE_RELAY_ORIGIN,
          nextCorrelationId(),
        );
        continue;
      }
      if (
        relay.bidirectional !== false
        && pc.nodeId === relay.to.location
        && pc.property === relay.to.property
      ) {
        engine.applySet(
          relay.from.location,
          relay.from.property,
          pc.value,
          UCE_RELAY_ORIGIN,
          nextCorrelationId(),
        );
      }
    }
  });

  return () => { sub.unsubscribe(); };
}
