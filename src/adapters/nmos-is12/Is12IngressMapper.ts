/**
 * E21.T4 — Maps IS-12 ingress class-projection mapping ↔ UCE tree locations.
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
  readonly oid: number;
}

export class Is12IngressMapper {
  private readonly _mapper: EgressMapper;
  private readonly _entries: Is12IngressMappedProperty[] = [];
  private readonly _byWire = new Map<string, { nodeId: string; property: string }>();
  private readonly _byUce = new Map<string, Is12IngressMappedProperty>();

  constructor(
    mapping: EgressMapping,
    tree: InstanceTree,
    entities: EntityRegistry,
    rootOid: number,
  ) {
    this._mapper = new EgressMapper(mapping, entities);
    this._build(tree, rootOid);
  }

  mappedProperties(): readonly Is12IngressMappedProperty[] {
    return this._entries;
  }

  subscriptionOids(): number[] {
    const oids = new Set(this._entries.map((e) => e.oid));
    return Array.from(oids);
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

  private _build(tree: InstanceTree, rootOid: number): void {
    const walk = (nodeId: string, oid: number): void => {
      const lookup = tree.findById(nodeId);
      if (!lookup.ok) return;

      const entityDef = lookup.node.identity.entity_def;
      const cls = this._mapper.getClass(entityDef);
      if (cls !== undefined) {
        for (const [propName, entry] of cls.properties) {
          const tid = entry.targetId as { level: number; index: number } | undefined;
          if (tid === undefined) continue;
          const mapped: Is12IngressMappedProperty = {
            nodeId,
            property: propName,
            propertyId: tid,
            readOnly: entry.readOnly ?? false,
            oid,
          };
          this._entries.push(mapped);
          this._byWire.set(this._wireKey(oid, tid), { nodeId, property: propName });
          this._byUce.set(`${nodeId}:${propName}`, mapped);
        }
      }

      let childIndex = 0;
      for (const child of lookup.node.children.values()) {
        childIndex += 1;
        walk(child.identity.path, oid + childIndex);
      }
    };

    const root = tree.root;
    if (root !== undefined) {
      walk(root.identity.path, rootOid);
    }
  }

  private _wireKey(oid: number, propertyId: { level: number; index: number }): string {
    return `${oid}:${propertyId.level}:${propertyId.index}`;
  }
}
