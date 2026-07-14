/**
 * E21.T4 — Maps IS-12 ingress class-projection mapping ↔ UCE tree locations.
 *
 * Remote wire targets are identified by **role path** (resolved to runtime oids at
 * connect). Mapping files must not pin oids.
 */

import { EgressMapper } from '../../mapping/EgressMapper.js';

import type { InstanceTree } from '../../engine/model/ObjectTree.js';
import type { EntityRegistry } from '../../engine/types/EntityRegistry.js';
import type { EgressMapping } from '../../mapping/types.js';

export interface Is12IngressMappedProperty {
  readonly nodeId: string;
  readonly property: string;
  readonly propertyId: { level: number; index: number };
  readonly readOnly: boolean;
  readonly rolePath: string;
  /** Populated after role-path resolution at connect. */
  oid?: number;
}

export class Is12IngressMapper {
  private readonly _mapper: EgressMapper;
  private readonly _rolePathByLocation = new Map<string, string>();
  private readonly _static: Is12IngressMappedProperty[] = [];
  private readonly _entries: Is12IngressMappedProperty[] = [];
  private readonly _byWire = new Map<string, { nodeId: string; property: string }>();
  private readonly _byUce = new Map<string, Is12IngressMappedProperty>();

  constructor(
    mapping: EgressMapping,
    tree: InstanceTree,
    entities: EntityRegistry,
  ) {
    this._mapper = new EgressMapper(mapping, entities);
    for (const inst of mapping.instances ?? []) {
      if (inst.rolePath !== undefined) {
        this._rolePathByLocation.set(inst.location, inst.rolePath);
      }
    }
    this._build(tree);
  }

  mappedProperties(): readonly Is12IngressMappedProperty[] {
    return this._entries;
  }

  rolePaths(): string[] {
    return [...new Set(this._static.map((e) => e.rolePath))];
  }

  subscriptionOids(): number[] {
    const oids = new Set(
      this._entries.map((e) => e.oid).filter((o): o is number => o !== undefined),
    );
    return Array.from(oids);
  }

  /** Bind runtime oids resolved from role paths (after connect / reconnect). */
  bindOids(resolved: ReadonlyMap<string, number>): void {
    this._byWire.clear();
    this._byUce.clear();
    this._entries.length = 0;

    for (const entry of this._static) {
      const oid = resolved.get(entry.rolePath);
      if (oid === undefined) continue;
      const bound: Is12IngressMappedProperty = { ...entry, oid };
      this._entries.push(bound);
      this._byWire.set(this._wireKey(oid, bound.propertyId), { nodeId: bound.nodeId, property: bound.property });
      this._byUce.set(`${bound.nodeId}:${bound.property}`, bound);
    }
  }

  resolveFromWire(
    oid: number,
    propertyId: { level: number; index: number },
  ): { nodeId: string; property: string } | undefined {
    return this._byWire.get(this._wireKey(oid, propertyId));
  }

  resolveToWire(
    nodeId: string,
    property: string,
  ): Is12IngressMappedProperty | undefined {
    return this._byUce.get(`${nodeId}:${property}`);
  }

  private _build(tree: InstanceTree): void {
    const walk = (nodeId: string): void => {
      const lookup = tree.findById(nodeId);
      if (!lookup.ok) return;

      const rolePath = this._rolePathByLocation.get(nodeId);
      const entityDef = lookup.node.identity.entity_def;
      const cls = this._mapper.getClass(entityDef);

      if (cls !== undefined && rolePath !== undefined) {
        for (const [propName, entry] of cls.properties) {
          const tid = entry.targetId as { level: number; index: number } | undefined;
          if (tid === undefined) continue;
          this._static.push({
            nodeId,
            property: propName,
            propertyId: tid,
            readOnly: entry.readOnly ?? false,
            rolePath,
          });
        }
      }

      for (const child of lookup.node.children.values()) {
        walk(child.identity.path);
      }
    };

    const root = tree.root;
    if (root !== undefined) {
      walk(root.identity.path);
    }
  }

  private _wireKey(oid: number, propertyId: { level: number; index: number }): string {
    return `${oid}:${propertyId.level}:${propertyId.index}`;
  }
}
