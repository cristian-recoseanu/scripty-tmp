/**
 * E8.T5 — Egress mapping DSL + EgressMapper.
 *
 * Projects UCE EntityDefinitions → protocol-specific class/property/method identifiers.
 * Reports gaps (unmapped UCE properties/methods) at load time.
 */

import type { EgressMapping, EgressClassMapping, NcTouchpoint } from './types.js';
import type { EntityRegistry } from '../engine/types/EntityRegistry.js';


// ---------------------------------------------------------------------------
// Gap report
// ---------------------------------------------------------------------------

export interface EgressGap {
  entityDef: string;
  kind: 'property' | 'method';
  id: string;
}

// ---------------------------------------------------------------------------
// Resolved egress class view
// ---------------------------------------------------------------------------

export interface ResolvedEgressClass {
  entityDef: string;
  classId: unknown;
  inheritsFrom?: string;
  /** property UCE id → egress mapping entry */
  properties: Map<string, EgressClassMapping['properties'][number]>;
  /** method UCE id → egress mapping entry */
  methods: Map<string, EgressClassMapping['methods'][number]>;
}

// ---------------------------------------------------------------------------
// E8.T5 — EgressMapper
// ---------------------------------------------------------------------------

/** Resolved per-instance config (keyed by full tree location path). */
interface ResolvedEgressInstance {
  touchpoints?: NcTouchpoint[];
}

export class EgressMapper {
  private readonly _classes = new Map<string, ResolvedEgressClass>();
  private readonly _instances = new Map<string, ResolvedEgressInstance>();
  private readonly _gaps: EgressGap[] = [];

  constructor(mapping: EgressMapping, entityRegistry: EntityRegistry) {
    this._build(mapping, entityRegistry);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** All gaps detected at construction: UCE properties/methods with no egress mapping. */
  get gaps(): readonly EgressGap[] {
    return this._gaps;
  }

  /** Returns true if any gaps exist. */
  hasGaps(): boolean {
    return this._gaps.length > 0;
  }

  /** Look up the resolved class for a given entityDef name. */
  getClass(entityDef: string): ResolvedEgressClass | undefined {
    return this._classes.get(entityDef);
  }

  /** All entity_def names covered by this mapping. */
  entityDefs(): string[] {
    return Array.from(this._classes.keys());
  }

  /**
   * Returns the statically configured NcTouchpoints for the given tree location path,
   * or null if no instance entry exists or the entry has no touchpoints configured.
   */
  getTouchpoints(location: string): NcTouchpoint[] | null {
    return this._instances.get(location)?.touchpoints ?? null;
  }

  // -------------------------------------------------------------------------
  // Private — build + gap detection
  // -------------------------------------------------------------------------

  private _build(mapping: EgressMapping, entityRegistry: EntityRegistry): void {
    // Index per-instance overrides (e.g. static touchpoints for NcReceiverMonitor nodes).
    for (const instance of mapping.instances ?? []) {
      const resolved: ResolvedEgressInstance = {};
      if (instance.touchpoints !== undefined) resolved.touchpoints = instance.touchpoints;
      this._instances.set(instance.location, resolved);
    }

    for (const classEntry of mapping.classes) {
      // E8.T5 — resolve entity_def against registry
      if (!entityRegistry.has(classEntry.entityDef)) {
        this._gaps.push({
          entityDef: classEntry.entityDef,
          kind: 'property',
          id: '<entity not registered>',
        });
        continue;
      }
      const entityDef = entityRegistry.get(classEntry.entityDef);

      // Build lookup maps
      const propMap = new Map(classEntry.properties.map((p) => [p.id, p]));
      const methodMap = new Map(classEntry.methods.map((m) => [m.id, m]));

      // Detect unmapped UCE properties
      for (const prop of entityDef.properties) {
        if (!propMap.has(prop.id)) {
          this._gaps.push({ entityDef: classEntry.entityDef, kind: 'property', id: prop.id });
        }
      }

      // Detect unmapped UCE methods
      for (const method of entityDef.methods) {
        if (!methodMap.has(method.id)) {
          this._gaps.push({ entityDef: classEntry.entityDef, kind: 'method', id: method.id });
        }
      }

      const resolved: ResolvedEgressClass = {
        entityDef: classEntry.entityDef,
        classId: classEntry.classId,
        properties: propMap,
        methods: methodMap,
      };
      if (classEntry.inheritsFrom !== undefined) resolved.inheritsFrom = classEntry.inheritsFrom;
      this._classes.set(classEntry.entityDef, resolved);
    }
  }
}
