/**
 * E11.T3 / E11.T4 — Core MS-05 object method dispatcher.
 *
 * Implements the NcObject generic methods defined by MS-05:
 *   1  Get               — read whole property value
 *   2  Set               — write whole property value
 *   3  GetSequenceItem   — read element at index
 *   4  SetSequenceItem   — write element at index
 *   5  AddSequenceItem   — append element
 *   6  RemoveSequenceItem — remove element by index
 *   7  GetSequenceLength  — return array length
 *
 * Also covers NcDeviceManager and NcClassManager query methods.
 *
 * Array operations are synthesized by the adapter (read-modify-write on
 * the whole property via SetPropertyOp) because the engine has no
 * per-element array ops.
 */

import { makePropertyChangedOp, makeSetPropertyOp } from '../../../engine/bus/operations.js';

import { OID_ROOT, OID_DEVICE_MANAGER, OID_CLASS_MANAGER } from './IdentityRegistry.js';
import {
  computeOverallStatusForClassId,
  isReceiverMonitorClassId,
  isSenderMonitorClassId,
} from './overallStatus.js';
import {
  NcMethodStatus,
  type NcMethodResult,
  type NcMethodResultPropertyValue,
  type NcMethodResultError,
  type NcMethodResultId,
  type NcDatatypeDescriptor,
  type NcClassDescriptor,
  type NcBlockMemberDescriptor,
} from './types.js';

import type { Catalogue } from './catalogue.js';
import type { IdentityRegistry } from './IdentityRegistry.js';
import type { UceBus } from '../../../engine/bus/UceBus.js';
import type { ModelValue } from '../../../engine/model/ObjectNode.js';
import type { InstanceTree } from '../../../engine/model/ObjectTree.js';



// ---------------------------------------------------------------------------
// Method IDs (MS-05 level 1 = NcObject)
// ---------------------------------------------------------------------------

export const NC_OBJECT_METHOD = {
  Get: { level: 1, index: 1 },
  Set: { level: 1, index: 2 },
  GetSequenceItem: { level: 1, index: 3 },
  SetSequenceItem: { level: 1, index: 4 },
  AddSequenceItem: { level: 1, index: 5 },
  RemoveSequenceItem: { level: 1, index: 6 },
  GetSequenceLength: { level: 1, index: 7 },
} as const;

// NcBlock methods (level 2 in MS-05 class hierarchy)
export const NC_BLOCK_METHOD = {
  GetMemberDescriptors: { level: 2, index: 1 },
  FindMembersByPath: { level: 2, index: 2 },
  FindMembersByRole: { level: 2, index: 3 },
  FindMembersByClassId: { level: 2, index: 4 },
} as const;

// NcClassManager methods (level 3 in MS-05 class hierarchy)
export const NC_CLASS_MANAGER_METHOD = {
  GetControlClass: { level: 3, index: 1 },
  GetDatatype: { level: 3, index: 2 },
} as const;

// NcReceiverMonitor methods (BCP-008-01, classId [1,2,2,1], level 4)
export const NC_RECEIVER_MONITOR_METHOD = {
  GetLostPacketCounters:    { level: 4, index: 1 },
  GetLatePacketCounters:    { level: 4, index: 2 },
  ResetCountersAndMessages: { level: 4, index: 3 },
} as const;

// NcSenderMonitor methods (BCP-008-02, classId [1,2,2,2], level 4)
export const NC_SENDER_MONITOR_METHOD = {
  GetTransmissionErrorCounters: { level: 4, index: 1 },
  ResetCountersAndMessages:     { level: 4, index: 2 },
} as const;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function ok(value: unknown): NcMethodResultPropertyValue {
  return { status: NcMethodStatus.Ok, value };
}

function okVoid(): NcMethodResult {
  return { status: NcMethodStatus.Ok };
}

function err(status: NcMethodStatus, message: string): NcMethodResultError {
  return { status, errorMessage: message };
}

// ---------------------------------------------------------------------------
// Context passed to each dispatch call
// ---------------------------------------------------------------------------

export interface DispatchContext {
  oid: number;
  methodId: { level: number; index: number };
  args: Record<string, unknown>;
  tree: InstanceTree;
  bus: UceBus;
  catalogue: Catalogue;
  identityRegistry: IdentityRegistry;
  adapterId: string;
  correlationId: string;
  /** Per-oid mutable userLabel store — shared across all dispatch calls on a session. */
  userLabels: Map<number, string>;
  /** Property ID map — used to resolve tree property names for MQTT write-back. */
  propMap: PropertyIdMap;
  /**
   * Entity-def → classId overrides for user entities whose classId was remapped to a
   * standard classId (e.g. ReceiverMonitorsBlock → [1,1]). These are NOT stored in the
   * catalogue (to avoid duplicate entries in ClassManager ControlClasses) but ARE
   * consulted by getClassId() so that isBlockOid() and member descriptors remain correct.
   */
  classIdOverrides?: ReadonlyMap<string, readonly number[]>;
}

// ---------------------------------------------------------------------------
// Standard NcObject level-1 property IDs (MS-05-02 §6)
// ---------------------------------------------------------------------------

export const NC_OBJECT_PROPERTY = {
  ClassId:                    { level: 1, index: 1 },
  Oid:                        { level: 1, index: 2 },
  ConstantOid:                { level: 1, index: 3 },
  Owner:                      { level: 1, index: 4 },
  Role:                       { level: 1, index: 5 },
  UserLabel:                  { level: 1, index: 6 },
  Touchpoints:                { level: 1, index: 7 },
  RuntimePropertyConstraints: { level: 1, index: 8 },
} as const;

// ---------------------------------------------------------------------------
// Property id → property name resolution (level/index → name)
// Given a propertyId {level, index} we resolve the name from the entity def
// via the tree node's entity_def, then the EntityRegistry.
// For simplicity in Phase 1: the property name *is* the property id string
// stored at level 3, index N (matching how catalogue.ts assigns them).
// The adapter maintains a reverse map: (oid, level, index) → property name.
// We resolve it here by looking up the node's entity def.
// ---------------------------------------------------------------------------

export interface PropertyIdMap {
  /** (oid, level, index) → property name */
  resolvePropertyName(oid: number, level: number, index: number): string | undefined;
  /** property name → (level, index) for an oid */
  resolvePropertyId(oid: number, name: string): { level: number; index: number } | undefined;
  /** whether a property is read-only */
  isReadOnly(oid: number, propertyName: string): boolean;
  /** whether a property is an array */
  isSequence(oid: number, propertyName: string): boolean;
  /**
   * Returns the statically configured NcTouchpoints for this oid, or null if none.
   * Sourced from the `instances[].touchpoints` field in egress mapping YAML.
   */
  touchpoints(oid: number): unknown[] | null;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export type DispatchResult = NcMethodResult | NcMethodResultPropertyValue | NcMethodResultError | NcMethodResultId;

export function dispatch(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const { oid, methodId } = ctx;

  // ----- NcDeviceManager -----
  if (oid === OID_DEVICE_MANAGER) {
    return dispatchDeviceManager(ctx);
  }

  // ----- NcClassManager -----
  if (oid === OID_CLASS_MANAGER) {
    return dispatchClassManager(ctx);
  }

  const { level, index } = methodId;

  // ----- NcBlock level-2 methods (any block oid) -----
  if (level === 2 && isBlockOid(ctx)) {
    return dispatchNcBlock(ctx, propMap);
  }

  // ----- NcObject generic level-1 methods -----
  if (level === 1) {
    switch (index) {
      case NC_OBJECT_METHOD.Get.index:
        return ncGet(ctx, propMap);
      case NC_OBJECT_METHOD.Set.index:
        return ncSet(ctx, propMap);
      case NC_OBJECT_METHOD.GetSequenceItem.index:
        return ncGetSequenceItem(ctx, propMap);
      case NC_OBJECT_METHOD.SetSequenceItem.index:
        return ncSetSequenceItem(ctx, propMap);
      case NC_OBJECT_METHOD.AddSequenceItem.index:
        return ncAddSequenceItem(ctx, propMap);
      case NC_OBJECT_METHOD.RemoveSequenceItem.index:
        return ncRemoveSequenceItem(ctx, propMap);
      case NC_OBJECT_METHOD.GetSequenceLength.index:
        return ncGetSequenceLength(ctx, propMap);
      default:
        return err(NcMethodStatus.MethodNotImplemented, `Unknown NcObject method index ${index}`);
    }
  }

  // ----- NcReceiverMonitor level-4 methods (BCP-008-01) -----
  if (level === 4 && isReceiverMonitorOid(ctx)) {
    return dispatchNcReceiverMonitor(ctx);
  }

  // ----- NcSenderMonitor level-4 methods (BCP-008-02) -----
  if (level === 4 && isSenderMonitorOid(ctx)) {
    return dispatchNcSenderMonitor(ctx);
  }

  return err(NcMethodStatus.MethodNotImplemented, `Method level ${level} index ${index} not implemented`);
}

// ---------------------------------------------------------------------------
// Standard NcObject level-1 property read/write
// ---------------------------------------------------------------------------

// NcBlock level-2 property IDs
const NC_BLOCK_PROPERTY = {
  Enabled: { level: 2, index: 1 },
  Members: { level: 2, index: 2 },
} as const;

function resolveStandardProperty(ctx: DispatchContext, propId: { level: number; index: number }): DispatchResult | undefined {
  // Level-2: NcBlock properties — on any block oid
  if (propId.level === 2 && isBlockOid(ctx)) {
    switch (propId.index) {
      case NC_BLOCK_PROPERTY.Enabled.index:
        return ok(true);
      case NC_BLOCK_PROPERTY.Members.index:
        return ok(buildMemberDescriptors(ctx, ctx.oid));
      default:
        return err(NcMethodStatus.PropertyNotImplemented,
          `NcBlock property {level:2,index:${propId.index}} not implemented`);
    }
  }

  // Level-2: NcWorker 'enabled' (2p1) on Worker-derived objects (classId [1,2,...]).
  // NcStatusMonitor / NcReceiverMonitor inherit NcWorker. Per BCP-008-01 §NcWorker
  // inheritance the 'enabled' property has no operational meaning and MUST NOT be
  // interpreted. Devices MAY return InvalidRequest on Set; we return true on Get.
  if (propId.level === 2 && propId.index === NC_BLOCK_PROPERTY.Enabled.index) {
    const classId = getClassId(ctx);
    if (classId.length >= 2 && classId[0] === 1 && classId[1] === 2) {
      return ok(true);
    }
  }

  if (propId.level !== 1) return undefined;
  const oid = ctx.oid;
  const registry = ctx.identityRegistry;
  const path = registry.pathForOid(oid);
  switch (propId.index) {
    case NC_OBJECT_PROPERTY.ClassId.index: {
      const classId = getClassId(ctx);
      return ok(classId);
    }
    case NC_OBJECT_PROPERTY.Oid.index:
      return ok(oid);
    case NC_OBJECT_PROPERTY.ConstantOid.index:
      return ok(true);
    case NC_OBJECT_PROPERTY.Owner.index: {
      if (oid === OID_ROOT) return ok(null);
      if (oid === OID_DEVICE_MANAGER || oid === OID_CLASS_MANAGER) return ok(OID_ROOT);
      // Derive parent oid from path
      if (path !== undefined) {
        const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined;
        if (parentPath !== undefined) {
          const parentOid = registry.pathForOid !== undefined
            ? (() => { try { return ctx.identityRegistry.oidForPath(parentPath); } catch { return OID_ROOT; } })()
            : OID_ROOT;
          return ok(parentOid);
        }
      }
      return ok(OID_ROOT);
    }
    case NC_OBJECT_PROPERTY.Role.index: {
      if (oid === OID_ROOT) return ok('root');
      if (oid === OID_DEVICE_MANAGER) return ok('DeviceManager');
      if (oid === OID_CLASS_MANAGER) return ok('ClassManager');
      // Role is the last path segment (own location), not the full path
      if (path !== undefined && path.includes('/')) {
        return ok(path.slice(path.lastIndexOf('/') + 1));
      }
      return ok(path ?? String(oid));
    }
    case NC_OBJECT_PROPERTY.UserLabel.index: {
      // Prefer the session-local cache (set by IS-12 Set or ingress sync).
      const cached = ctx.userLabels.get(oid);
      if (cached !== undefined) return ok(cached);
      // Fall back to the userLabel tree property only (not other string props).
      const nodePath = ctx.identityRegistry.pathForOid(oid);
      if (nodePath !== undefined) {
        const lookup = ctx.tree.findById(nodePath);
        if (lookup.ok && lookup.node.properties.has('userLabel')) {
          const r = lookup.node.getProperty('userLabel');
          if (r.ok && typeof r.value === 'string') return ok(r.value);
        }
      }
      return ok('');
    }
    case NC_OBJECT_PROPERTY.Touchpoints.index: {
      // Return statically configured touchpoints from egress mapping (instances config),
      // or null if none are configured. For NcReceiverMonitor nodes, touchpoints MUST
      // contain an NcTouchpointNmos entry per BCP-008-01 §Touchpoints and IS-04 receivers.
      const tp = ctx.propMap.touchpoints(ctx.oid);
      return ok(tp);
    }
    case NC_OBJECT_PROPERTY.RuntimePropertyConstraints.index:
      return ok(null);
    default:
      return undefined;
  }
}

function setStandardProperty(ctx: DispatchContext, propId: { level: number; index: number }, value: unknown): DispatchResult | undefined {
  if (propId.level !== 1) return undefined;
  switch (propId.index) {
    case NC_OBJECT_PROPERTY.UserLabel.index: {
      if (typeof value !== 'string') return err(NcMethodStatus.ParameterError, 'userLabel must be a string');
      ctx.userLabels.set(ctx.oid, value);
      // Publish a propertyChanged op so _onPropertyChanged sends the IS-12 Notification
      // with propertyId {level:1,index:6}.  Use '__engine__' as origin so the adapter's
      // self-echo suppression check (op.origin === this.id) does not swallow it.
      ctx.bus.publish(makePropertyChangedOp({
        origin: '__engine__',
        correlationId: ctx.correlationId,
        nodeId: String(ctx.oid),
        property: 'userLabel',
        changeType: 'valueChanged',
        value,
      }));
      // Also propagate as setProperty to the UCE tree for write-back (relays, MQTT, etc.).
      const path = ctx.identityRegistry.pathForOid(ctx.oid);
      if (path !== undefined) {
        const lookup = ctx.tree.findById(path);
        if (lookup.ok && lookup.node.properties.has('userLabel')) {
          ctx.bus.publish(makeSetPropertyOp({
            origin: ctx.adapterId,
            correlationId: ctx.correlationId,
            nodeId: path,
            property: 'userLabel',
            value,
          }));
        } else {
          let treePropName: string | undefined;
          for (let i = 1; i <= 32 && treePropName === undefined; i++) {
            treePropName = ctx.propMap.resolvePropertyName(ctx.oid, 3, i);
          }
          if (treePropName !== undefined) {
            ctx.bus.publish(makeSetPropertyOp({
              origin: ctx.adapterId,
              correlationId: ctx.correlationId,
              nodeId: path,
              property: treePropName,
              value,
            }));
          }
        }
      }
      return okVoid();
    }
    case NC_OBJECT_PROPERTY.ClassId.index:
    case NC_OBJECT_PROPERTY.Oid.index:
    case NC_OBJECT_PROPERTY.ConstantOid.index:
    case NC_OBJECT_PROPERTY.Owner.index:
    case NC_OBJECT_PROPERTY.Role.index:
    case NC_OBJECT_PROPERTY.Touchpoints.index:
    case NC_OBJECT_PROPERTY.RuntimePropertyConstraints.index:
      return err(NcMethodStatus.Readonly, `Standard NcObject property {level:1,index:${propId.index}} is read-only`);
    default:
      return undefined;
  }
}

function getClassId(ctx: DispatchContext): readonly number[] {
  const oid = ctx.oid;
  if (oid === OID_ROOT) return [1, 1];
  if (oid === OID_DEVICE_MANAGER) return [1, 3, 1];
  if (oid === OID_CLASS_MANAGER) return [1, 3, 2];
  const path = ctx.identityRegistry.pathForOid(oid);
  if (path === undefined) return [1, 0];
  const lookup = ctx.tree.findById(path);
  if (!lookup.ok) return [1, 0];
  const entityName = lookup.node.identity.entity_def;
  // classIdOverrides are set when a user entity is remapped to a standard classId
  // (e.g. ReceiverMonitorsBlock → [1,1]). The entry was removed from the catalogue
  // to avoid duplicate ControlClasses entries, so we must consult the override first.
  const override = ctx.classIdOverrides?.get(entityName);
  if (override !== undefined) return override;
  const classDesc = ctx.catalogue.classes.get(entityName);
  return classDesc?.classId ?? [1, 0];
}

/**
 * Returns true if the given oid is a block (root or any node whose classId starts with [1,1]).
 * Uses the catalogue to check the classId prefix.
 */
function isBlockOid(ctx: DispatchContext): boolean {
  const oid = ctx.oid;
  if (oid === OID_ROOT) return true;
  const classId = getClassId(ctx);
  // NcBlock classId is [1,1] or derived (prefix [1,1,...])
  return classId.length >= 2 && classId[0] === 1 && classId[1] === 1;
}

/**
 * Returns true if the oid implements NcReceiverMonitor or a class derived from it.
 * NcReceiverMonitor classId is [1,2,2,1]; derived classes start with that prefix.
 */
function isReceiverMonitorOid(ctx: DispatchContext): boolean {
  return isReceiverMonitorClassId(getClassId(ctx));
}

function isSenderMonitorOid(ctx: DispatchContext): boolean {
  return isSenderMonitorClassId(getClassId(ctx));
}

// ---------------------------------------------------------------------------
// NcBlock (level 2) — device model traversal
// ---------------------------------------------------------------------------

/**
 * Build the list of direct-child member descriptors for the block at `ownerOid`.
 * - Root block (oid=1): includes DeviceManager + ClassManager + direct tree children of root.
 * - Sub-block: direct tree children of the block's tree node.
 * owner = ownerOid, role = child's own location segment.
 */
function buildMemberDescriptors(ctx: DispatchContext, ownerOid: number): NcBlockMemberDescriptor[] {
  const registry = ctx.identityRegistry;
  const members: NcBlockMemberDescriptor[] = [];

  if (ownerOid === OID_ROOT) {
    // DeviceManager and ClassManager are always direct members of root
    members.push({
      oid: OID_DEVICE_MANAGER,
      constantOid: true,
      classId: [1, 3, 1],
      role: 'DeviceManager',
      userLabel: ctx.userLabels.get(OID_DEVICE_MANAGER) ?? '',
      owner: OID_ROOT,
      description: '',
      constraints: null,
    });
    members.push({
      oid: OID_CLASS_MANAGER,
      constantOid: true,
      classId: [1, 3, 2],
      role: 'ClassManager',
      userLabel: ctx.userLabels.get(OID_CLASS_MANAGER) ?? '',
      owner: OID_ROOT,
      description: '',
      constraints: null,
    });
  }

  // Add direct tree children of the block's node
  const ownerPath = registry.pathForOid(ownerOid);
  // For OID_ROOT, ownerPath is the root node's path
  if (ownerPath !== undefined) {
    const lookup = ctx.tree.findById(ownerPath);
    if (lookup.ok) {
      for (const child of lookup.node.children.values()) {
        const childOid = (() => {
          try { return registry.oidForPath(child.identity.path); }
          catch { return undefined; }
        })();
        if (childOid === undefined) continue;
        const classId = getClassId({ ...ctx, oid: childOid });
        members.push({
          oid: childOid,
          constantOid: true,
          classId,
          role: child.identity.location,
          userLabel: ctx.userLabels.get(childOid) ?? '',
          owner: ownerOid,
          description: '',
          constraints: null,
        });
      }
    }
  }

  return members;
}

/**
 * Recursively collect all member descriptors under ownerOid (recurse=true path).
 */
function buildMemberDescriptorsRecursive(ctx: DispatchContext, ownerOid: number): NcBlockMemberDescriptor[] {
  const direct = buildMemberDescriptors(ctx, ownerOid);
  const result: NcBlockMemberDescriptor[] = [...direct];
  for (const m of direct) {
    if (isBlockOid({ ...ctx, oid: m.oid })) {
      result.push(...buildMemberDescriptorsRecursive(ctx, m.oid));
    }
  }
  return result;
}

function dispatchNcBlock(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const { methodId, args } = ctx;
  const ownerOid = ctx.oid;

  // level-1 Get/Set on the block oid — handled by standard ncGet/ncSet
  if (methodId.level === 1) {
    return dispatch({ ...ctx }, propMap);
  }

  switch (methodId.index) {
    case NC_BLOCK_METHOD.GetMemberDescriptors.index: {
      const recurse = (args.recurse as boolean | undefined) ?? false;
      if (!recurse) {
        return ok(buildMemberDescriptors(ctx, ownerOid));
      }
      return ok(buildMemberDescriptorsRecursive(ctx, ownerOid));
    }
    case NC_BLOCK_METHOD.FindMembersByPath.index: {
      const pathArr = args.path as string[] | undefined;
      if (pathArr === undefined || pathArr.length === 0) {
        return err(NcMethodStatus.BadCommandFormat, 'Missing path argument');
      }
      // Walk the path segment by segment from the current block.
      // MS-05-02: the path is a sequence of roles starting from an immediate child of
      // this block, NOT a flat filter of all recursive members.
      let currentMembers = buildMemberDescriptors(ctx, ownerOid);
      for (let i = 0; i < pathArr.length - 1; i++) {
        const segment = pathArr[i]!;
        const intermediate = currentMembers.find((m) => m.role === segment);
        if (intermediate === undefined) {
          return ok([]); // path not found
        }
        if (!isBlockOid({ ...ctx, oid: intermediate.oid })) {
          return ok([]); // intermediate is not a block — path is invalid
        }
        currentMembers = buildMemberDescriptors({ ...ctx, oid: intermediate.oid }, intermediate.oid);
      }
      const lastSegment = pathArr[pathArr.length - 1]!;
      const found = currentMembers.filter((m) => m.role === lastSegment);
      return ok(found);
    }
    case NC_BLOCK_METHOD.FindMembersByRole.index: {
      const role = args.role as string | undefined;
      const caseSensitive = (args.caseSensitive as boolean | undefined) ?? true;
      const matchWholeString = (args.matchWholeString as boolean | undefined) ?? true;
      const recurse = (args.recurse as boolean | undefined) ?? false;
      if (role === undefined) {
        return err(NcMethodStatus.BadCommandFormat, 'Missing role argument');
      }
      const members = recurse
        ? buildMemberDescriptorsRecursive(ctx, ownerOid)
        : buildMemberDescriptors(ctx, ownerOid);
      const target = caseSensitive ? role : role.toLowerCase();
      const filtered = members.filter((m) => {
        const candidate = caseSensitive ? m.role : m.role.toLowerCase();
        return matchWholeString ? candidate === target : candidate.includes(target);
      });
      return ok(filtered);
    }
    case NC_BLOCK_METHOD.FindMembersByClassId.index: {
      const classId = args.classId as readonly number[] | undefined;
      const includeDerived = (args.includeDerived as boolean | undefined) ?? false;
      const recurse = (args.recurse as boolean | undefined) ?? false;
      if (classId === undefined) {
        return err(NcMethodStatus.BadCommandFormat, 'Missing classId argument');
      }
      const members = recurse
        ? buildMemberDescriptorsRecursive(ctx, ownerOid)
        : buildMemberDescriptors(ctx, ownerOid);
      const targetKey = JSON.stringify(classId);
      const filtered = members.filter((m) => {
        const memberKey = JSON.stringify(m.classId);
        const exactMatch = memberKey === targetKey;
        const derivedMatch = includeDerived && m.classId.length >= classId.length &&
          JSON.stringify(m.classId.slice(0, classId.length)) === targetKey;
        return exactMatch || derivedMatch;
      });
      return ok(filtered);
    }
    default:
      return err(NcMethodStatus.MethodNotImplemented, `NcBlock method index ${methodId.index} not implemented`);
  }
}

// NcDeviceManager level-3 property IDs (MS-05-02: NcObject=1, NcManager=2 abstract, NcDeviceManager=3)
const NC_DM_PROP = {
  NcVersion:        { level: 3, index: 1 },
  Manufacturer:     { level: 3, index: 2 },
  Product:          { level: 3, index: 3 },
  SerialNumber:     { level: 3, index: 4 },
  UserInventoryCode:{ level: 3, index: 5 },
  DeviceName:       { level: 3, index: 6 },
  DeviceRole:       { level: 3, index: 7 },
  OperationalState: { level: 3, index: 8 },
  ResetCause:       { level: 3, index: 9 },
  Message:          { level: 3, index: 10 },
} as const;

// NcClassManager level-3 property IDs
const NC_CM_PROP = {
  ControlClasses: { level: 3, index: 1 },
  Datatypes:      { level: 3, index: 2 },
} as const;

// ---------------------------------------------------------------------------
// NcDeviceManager — MS-05-02 compliant
// ---------------------------------------------------------------------------

function dispatchDeviceManager(ctx: DispatchContext): DispatchResult {
  const { methodId } = ctx;
  if (methodId.level !== 1) {
    return err(NcMethodStatus.MethodNotImplemented, 'NcDeviceManager method not implemented');
  }
  if (methodId.index === NC_OBJECT_METHOD.Get.index) {
    const propId = ctx.args.id as { level: number; index: number } | undefined;
    if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
    // Level-1: standard NcObject properties
    const std = resolveStandardProperty({ ...ctx, oid: OID_DEVICE_MANAGER }, propId);
    if (std !== undefined) return std;
    // Level-3: NcDeviceManager-specific properties
    if (propId.level === 3) {
      switch (propId.index) {
        case NC_DM_PROP.NcVersion.index:        return ok('1.0.0');
        case NC_DM_PROP.Manufacturer.index:     return ok({ name: 'UCE Bridge', organizationId: null, website: null });
        case NC_DM_PROP.Product.index:          return ok({ name: 'UCE Bridge', key: 'UCE-BRIDGE', revisionLevel: '1.0.0', brandName: null, uuid: null, description: null });
        case NC_DM_PROP.SerialNumber.index:     return ok('N/A');
        case NC_DM_PROP.UserInventoryCode.index:return ok(null);
        case NC_DM_PROP.DeviceName.index:       return ok(ctx.adapterId);
        case NC_DM_PROP.DeviceRole.index:       return ok(ctx.adapterId);
        case NC_DM_PROP.OperationalState.index: return ok({ generic: 1, deviceSpecificDetails: null }); // NcDeviceGenericState.NormalOperation=1
        case NC_DM_PROP.ResetCause.index:       return ok(0);
        case NC_DM_PROP.Message.index:          return ok(null);
        default: return err(NcMethodStatus.PropertyNotImplemented,
          `NcDeviceManager property {level:3,index:${propId.index}} not implemented`);
      }
    }
    return err(NcMethodStatus.PropertyNotImplemented,
      `NcDeviceManager property {level:${propId.level},index:${propId.index}} not implemented`);
  }
  if (methodId.index === NC_OBJECT_METHOD.Set.index) {
    const propId = ctx.args.id as { level: number; index: number } | undefined;
    if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
    const val = ctx.args.value;
    const std = setStandardProperty({ ...ctx, oid: OID_DEVICE_MANAGER }, propId, val);
    if (std !== undefined) return std;
    return err(NcMethodStatus.Readonly, 'NcDeviceManager properties are read-only');
  }
  if (methodId.index === NC_OBJECT_METHOD.GetSequenceItem.index) {
    const propId = ctx.args.id as { level: number; index: number } | undefined;
    if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
    const idx = ctx.args.index as number | undefined;
    if (idx === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing index argument');
    const seq = resolveStandardSequence({ ...ctx, oid: OID_DEVICE_MANAGER }, propId);
    if (seq === null) return err(NcMethodStatus.PropertyNotImplemented, 'Not a sequence property');
    if (idx < 0 || idx >= seq.length) return err(NcMethodStatus.IndexOutOfBounds, `Index ${idx} out of range (length ${seq.length})`);
    return ok(seq[idx]);
  }
  if (methodId.index === NC_OBJECT_METHOD.GetSequenceLength.index) {
    const propId = ctx.args.id as { level: number; index: number } | undefined;
    if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
    const seq = resolveStandardSequence({ ...ctx, oid: OID_DEVICE_MANAGER }, propId);
    if (seq === null) return err(NcMethodStatus.PropertyNotImplemented, 'Not a sequence property');
    return ok(seq.length);
  }
  return err(NcMethodStatus.MethodNotImplemented, 'NcDeviceManager method not implemented');
}

// ---------------------------------------------------------------------------
// Standard sequence property resolution (touchpoints, runtimePropertyConstraints, NcBlock.members)
// Returns the sequence as an array, or null if the propId is not a standard sequence property.
// ---------------------------------------------------------------------------

function resolveStandardSequence(
  ctx: DispatchContext,
  propId: { level: number; index: number },
): unknown[] | null {
  if (propId.level === 1) {
    // touchpoints (1p7) and runtimePropertyConstraints (1p8) are nullable sequences — treat null as []
    if (propId.index === NC_OBJECT_PROPERTY.Touchpoints.index) return [];
    if (propId.index === NC_OBJECT_PROPERTY.RuntimePropertyConstraints.index) return [];
  }
  if (propId.level === 2 && isBlockOid(ctx)) {
    if (propId.index === NC_BLOCK_PROPERTY.Members.index) return buildMemberDescriptors(ctx, ctx.oid);
  }
  return null;
}

// ---------------------------------------------------------------------------
// NcDatatypeDescriptor wire serialization
// The 'type' field MUST be sent as an integer (NcDatatypeType enum) per MS-05-02.
// Our internal representation uses string discriminants for TypeScript safety.
// ---------------------------------------------------------------------------

const DATATYPE_TYPE_INT: Record<string, number> = {
  Primitive: 0,
  Typedef:   1,
  Struct:    2,
  Enum:      3,
};

function wireDatatype(d: NcDatatypeDescriptor): unknown {
  return { ...d, type: DATATYPE_TYPE_INT[d.type] ?? 0 };
}

// ---------------------------------------------------------------------------
// NcClassManager — GetControlClass / GetDatatype
// ---------------------------------------------------------------------------

function dispatchClassManager(ctx: DispatchContext): DispatchResult {
  const { methodId, catalogue } = ctx;

  // NcObject level-1 methods on class manager — standard NcObject props + level-3 CM properties
  if (methodId.level === 1) {
    const propId = ctx.args.id as { level: number; index: number } | undefined;
    switch (methodId.index) {
      case NC_OBJECT_METHOD.Get.index: {
        if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
        const std = resolveStandardProperty({ ...ctx, oid: OID_CLASS_MANAGER }, propId);
        if (std !== undefined) return std;
        if (propId.level === 3) {
          switch (propId.index) {
            case NC_CM_PROP.ControlClasses.index:
              return ok([...catalogue.classes.values()]);
            case NC_CM_PROP.Datatypes.index:
              return ok([...catalogue.datatypes.values()].map(wireDatatype));
            default:
              return err(NcMethodStatus.PropertyNotImplemented,
                `NcClassManager property {level:3,index:${propId.index}} not implemented`);
          }
        }
        return err(NcMethodStatus.PropertyNotImplemented,
          `NcClassManager property {level:${propId.level},index:${propId.index}} not implemented`);
      }
      case NC_OBJECT_METHOD.Set.index: {
        if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
        const val = ctx.args.value;
        const std = setStandardProperty({ ...ctx, oid: OID_CLASS_MANAGER }, propId, val);
        if (std !== undefined) return std;
        return err(NcMethodStatus.Readonly, 'NcClassManager properties are read-only');
      }
      case NC_OBJECT_METHOD.GetSequenceItem.index: {
        if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
        const idx = ctx.args.index as number | undefined;
        if (idx === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing index argument');
        const seq = resolveClassManagerSequence(catalogue, propId);
        if (seq === null) return err(NcMethodStatus.PropertyNotImplemented, `Not a sequence property`);
        if (idx < 0 || idx >= seq.length) return err(NcMethodStatus.IndexOutOfBounds, `Index ${idx} out of range (length ${seq.length})`);
        return ok(seq[idx]);
      }
      case NC_OBJECT_METHOD.GetSequenceLength.index: {
        if (propId === undefined) return err(NcMethodStatus.BadCommandFormat, 'Missing property id');
        const seq = resolveClassManagerSequence(catalogue, propId);
        if (seq === null) return err(NcMethodStatus.PropertyNotImplemented, `Not a sequence property`);
        return ok(seq.length);
      }
      default:
        return err(NcMethodStatus.MethodNotImplemented, 'NcClassManager method not implemented');
    }
  }

  if (methodId.level !== NC_CLASS_MANAGER_METHOD.GetControlClass.level) {
    return err(NcMethodStatus.MethodNotImplemented, 'Unknown class manager method level');
  }

  switch (methodId.index) {
    case NC_CLASS_MANAGER_METHOD.GetControlClass.index: {
      const classId = ctx.args.classId as readonly number[] | undefined;
      if (classId === undefined) {
        return err(NcMethodStatus.BadCommandFormat, 'Missing classId argument');
      }
      const includeInherited = ctx.args.includeInherited as boolean | undefined;
      let found: NcClassDescriptor | undefined;
      for (const desc of catalogue.classes.values()) {
        if (JSON.stringify(desc.classId) === JSON.stringify(classId)) {
          found = desc;
          break;
        }
      }
      if (found === undefined) {
        return err(NcMethodStatus.BadOid, `No class with classId ${JSON.stringify(classId)}`);
      }
      if (includeInherited) {
        found = flattenClassDescriptor(found, catalogue);
      }
      return ok(found);
    }
    case NC_CLASS_MANAGER_METHOD.GetDatatype.index: {
      const name = ctx.args.name as string | undefined;
      if (name === undefined) {
        return err(NcMethodStatus.BadCommandFormat, 'Missing name argument');
      }
      const includeInherited = ctx.args.includeInherited as boolean | undefined;
      const desc: NcDatatypeDescriptor | undefined = catalogue.datatypes.get(name);
      if (desc === undefined) {
        return err(NcMethodStatus.BadOid, `No datatype '${name}'`);
      }
      const wired = includeInherited ? flattenDatatypeDescriptor(wireDatatype(desc) as Record<string, unknown>, catalogue) : wireDatatype(desc);
      return ok(wired);
    }
    default:
      return err(NcMethodStatus.MethodNotImplemented, `ClassManager method index ${methodId.index} not implemented`);
  }
}

// ---------------------------------------------------------------------------
// Helpers for GetSequenceItem/GetSequenceLength on ClassManager
// ---------------------------------------------------------------------------

function resolveClassManagerSequence(
  catalogue: DispatchContext['catalogue'],
  propId: { level: number; index: number },
): unknown[] | null {
  if (propId.level === 3) {
    if (propId.index === NC_CM_PROP.ControlClasses.index) return [...catalogue.classes.values()];
    if (propId.index === NC_CM_PROP.Datatypes.index) return [...catalogue.datatypes.values()].map(wireDatatype);
  }
  return null;
}

// ---------------------------------------------------------------------------
// includeInherited: flatten ancestor properties/fields into a descriptor
// ---------------------------------------------------------------------------

function flattenClassDescriptor(
  desc: NcClassDescriptor,
  catalogue: DispatchContext['catalogue'],
): NcClassDescriptor {
  // Walk up the classId chain until we find a known ancestor (skip missing intermediate levels)
  let parentClassId = [...desc.classId].slice(0, -1);
  let parent: NcClassDescriptor | undefined;
  while (parentClassId.length > 0 && parent === undefined) {
    for (const d of catalogue.classes.values()) {
      if (JSON.stringify(d.classId) === JSON.stringify(parentClassId)) { parent = d; break; }
    }
    if (parent === undefined) parentClassId = parentClassId.slice(0, -1);
  }
  if (parent === undefined) return desc;
  const flatParent = flattenClassDescriptor(parent, catalogue);
  return {
    ...desc,
    properties: [...flatParent.properties, ...desc.properties],
    methods:    [...flatParent.methods,    ...desc.methods],
    events:     [...flatParent.events,     ...desc.events],
  };
}

function flattenDatatypeDescriptor(
  wired: Record<string, unknown>,
  catalogue: DispatchContext['catalogue'],
): Record<string, unknown> {
  // Only Structs (type=2) have fields to flatten; Typedefs and Primitives do not
  if (wired.type !== 2) return wired;
  const parentTypeName = wired.parentType as string | null | undefined;
  if (!parentTypeName) return wired;
  const parentDesc = catalogue.datatypes.get(parentTypeName);
  if (parentDesc === undefined) return wired;
  const parentWired = flattenDatatypeDescriptor(wireDatatype(parentDesc) as Record<string, unknown>, catalogue);
  // Only merge if parent is also a Struct
  if (parentWired.type !== 2) return wired;
  const myFields = (wired.fields as unknown[] | undefined) ?? [];
  const parentFields = (parentWired.fields as unknown[] | undefined) ?? [];
  return { ...wired, fields: [...parentFields, ...myFields] };
}

// ---------------------------------------------------------------------------
// NcReceiverMonitor (level 4) — BCP-008-01 methods
// ---------------------------------------------------------------------------

function dispatchNcReceiverMonitor(ctx: DispatchContext): DispatchResult {
  switch (ctx.methodId.index) {
    case NC_RECEIVER_MONITOR_METHOD.GetLostPacketCounters.index:
    case NC_RECEIVER_MONITOR_METHOD.GetLatePacketCounters.index:
      // This bridge has no packet-loss or late-arrival detection capability.
      // BCP-008-01 §Late and lost packets: when the device cannot detect, MUST return
      // an empty NcCounter array.
      return ok([]);

    case NC_RECEIVER_MONITOR_METHOD.ResetCountersAndMessages.index:
      return ncMonitorResetCounters(ctx);

    default:
      return err(
        NcMethodStatus.MethodNotImplemented,
        `NcReceiverMonitor method index ${ctx.methodId.index} not implemented`,
      );
  }
}

function dispatchNcSenderMonitor(ctx: DispatchContext): DispatchResult {
  switch (ctx.methodId.index) {
    case NC_SENDER_MONITOR_METHOD.GetTransmissionErrorCounters.index:
      // BCP-008-02 §Transmission error counters: devices without detection MUST return [].
      return ok([]);

    case NC_SENDER_MONITOR_METHOD.ResetCountersAndMessages.index:
      return ncMonitorResetCounters(ctx);

    default:
      return err(
        NcMethodStatus.MethodNotImplemented,
        `NcSenderMonitor method index ${ctx.methodId.index} not implemented`,
      );
  }
}

/**
 * Implements BCP-008-01/02 ResetCountersAndMessages.
 *
 * Publishes a SetPropertyOp on the bus for every property whose name ends with
 * 'TransitionCounter' (reset to 0) or 'Message' (reset to null).
 */
function ncMonitorResetCounters(ctx: DispatchContext): DispatchResult {
  const path = ctx.identityRegistry.pathForOid(ctx.oid);
  if (path === undefined) {
    return err(NcMethodStatus.BadOid, `Unknown oid ${ctx.oid}`);
  }
  const lookup = ctx.tree.findById(path);
  if (!lookup.ok) {
    return err(NcMethodStatus.BadOid, `Node not found for oid ${ctx.oid}`);
  }
  for (const [propName] of lookup.node.properties) {
    const isCounter = propName.endsWith('TransitionCounter');
    const isMessage = propName.endsWith('Message');
    if (!isCounter && !isMessage) continue;
    ctx.bus.publish(
      makeSetPropertyOp({
        origin: ctx.adapterId,
        correlationId: ctx.correlationId,
        nodeId: path,
        property: propName,
        value: isCounter ? 0 : null,
      }),
    );
  }
  return okVoid();
}

// ---------------------------------------------------------------------------
// NcObject.Get
// ---------------------------------------------------------------------------

/** Read monitor node property values and return derived overallStatus, if applicable. */
export function readDerivedOverallStatus(
  ctx: DispatchContext,
  oid: number,
  path: string,
  /** When computing from a bus notification, the tree may not yet reflect the change. */
  pendingChange?: { property: string; value: unknown },
): number | undefined {
  const lookup = ctx.tree.findById(path);
  if (!lookup.ok) return undefined;
  const classId = getClassId({ ...ctx, oid });
  const values: Record<string, unknown> = {};
  for (const [name] of lookup.node.properties) {
    const r = lookup.node.getProperty(name);
    if (r.ok) values[name] = r.value;
  }
  if (pendingChange !== undefined) {
    values[pendingChange.property] = pendingChange.value;
  }
  return computeOverallStatusForClassId(classId, values);
}

function ncGet(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  if (propId === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing property id argument');
  }
  // Level-1 standard NcObject properties take priority
  const std = resolveStandardProperty(ctx, propId);
  if (std !== undefined) return std;
  // Level-3 user-defined properties
  const propName = propMap.resolvePropertyName(ctx.oid, propId.level, propId.index);
  if (propName === undefined) {
    return err(NcMethodStatus.PropertyNotImplemented, `Unknown property {level:${propId.level},index:${propId.index}} on oid ${ctx.oid}`);
  }
  // overallStatus is derived from domain statuses (BCP-008-01/02), not stored independently.
  if (propName === 'overallStatus') {
    const path = ctx.identityRegistry.pathForOid(ctx.oid);
    if (path === undefined) {
      return err(NcMethodStatus.BadOid, `Unknown oid ${ctx.oid}`);
    }
    const derived = readDerivedOverallStatus(ctx, ctx.oid, path);
    if (derived === undefined) {
      return err(NcMethodStatus.PropertyNotImplemented, `overallStatus not available on oid ${ctx.oid}`);
    }
    return ok(derived);
  }
  const path = ctx.identityRegistry.pathForOid(ctx.oid);
  if (path === undefined) {
    return err(NcMethodStatus.BadOid, `Unknown oid ${ctx.oid}`);
  }
  const result = ctx.tree.findById(path);
  if (!result.ok) {
    return err(NcMethodStatus.BadOid, `Node not found for oid ${ctx.oid}`);
  }
  const getPropResult = result.node.getProperty(propName);
  return ok(getPropResult.value ?? null);
}

// ---------------------------------------------------------------------------
// NcObject.Set
// ---------------------------------------------------------------------------

function ncSet(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  const value = ctx.args.value as ModelValue;
  if (propId === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing property id argument');
  }
  // Level-1 standard NcObject properties — bus-publish for userLabel is handled
  // centrally inside setStandardProperty.
  const std = setStandardProperty(ctx, propId, value);
  if (std !== undefined) {
    return std;
  }
  // Level-3 user-defined properties
  const propName = propMap.resolvePropertyName(ctx.oid, propId.level, propId.index);
  if (propName === undefined) {
    return err(NcMethodStatus.PropertyNotImplemented, `Unknown property on oid ${ctx.oid}`);
  }
  if (propMap.isReadOnly(ctx.oid, propName)) {
    return err(NcMethodStatus.Readonly, `Property '${propName}' is read-only`);
  }
  const path = ctx.identityRegistry.pathForOid(ctx.oid);
  if (path === undefined) {
    return err(NcMethodStatus.BadOid, `Unknown oid ${ctx.oid}`);
  }
  ctx.bus.publish(makeSetPropertyOp({
    origin: ctx.adapterId,
    correlationId: ctx.correlationId,
    nodeId: path,
    property: propName,
    value,
  }));
  return okVoid();
}

// ---------------------------------------------------------------------------
// Sequence helpers
// ---------------------------------------------------------------------------

function getArray(ctx: DispatchContext, propMap: PropertyIdMap, propId: { level: number; index: number }): {
  arr: unknown[];
  propName: string;
  path: string;
} | NcMethodResultError {
  const propName = propMap.resolvePropertyName(ctx.oid, propId.level, propId.index);
  if (propName === undefined) {
    return err(NcMethodStatus.BadOid, `Unknown property on oid ${ctx.oid}`);
  }
  if (!propMap.isSequence(ctx.oid, propName)) {
    return err(NcMethodStatus.BadCommandFormat, `Property '${propName}' is not a sequence`);
  }
  const path = ctx.identityRegistry.pathForOid(ctx.oid);
  if (path === undefined) {
    return err(NcMethodStatus.BadOid, `Unknown oid ${ctx.oid}`);
  }
  const result = ctx.tree.findById(path);
  if (!result.ok) {
    return err(NcMethodStatus.BadOid, `Node not found for oid ${ctx.oid}`);
  }
  const getPropResult = result.node.getProperty(propName);
  const raw = getPropResult.value;
  if (!Array.isArray(raw)) {
    return err(NcMethodStatus.DeviceError, `Property '${propName}' is not an array`);
  }
  return { arr: raw, propName, path };
}

function ncGetSequenceItem(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  const itemIndex = ctx.args.index as number | undefined;
  if (propId === undefined || itemIndex === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing id or index argument');
  }
  // Check standard sequence properties first (NcObject/NcBlock level)
  const stdSeq = resolveStandardSequence(ctx, propId);
  if (stdSeq !== null) {
    if (itemIndex < 0 || itemIndex >= stdSeq.length) {
      return err(NcMethodStatus.IndexOutOfBounds, `Index ${itemIndex} out of range (length ${stdSeq.length})`);
    }
    return ok(stdSeq[itemIndex]);
  }
  const res = getArray(ctx, propMap, propId);
  if ('errorMessage' in res) return res;
  const { arr } = res;
  if (itemIndex < 0 || itemIndex >= arr.length) {
    return err(NcMethodStatus.IndexOutOfBounds, `Index ${itemIndex} out of range (length ${arr.length})`);
  }
  return ok(arr[itemIndex]);
}

function ncGetSequenceLength_impl(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  if (propId === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing id argument');
  }
  const stdSeq = resolveStandardSequence(ctx, propId);
  if (stdSeq !== null) return ok(stdSeq.length);
  const res = getArray(ctx, propMap, propId);
  if ('errorMessage' in res) return res;
  return ok(res.arr.length);
}

function ncSetSequenceItem(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  const itemIndex = ctx.args.index as number | undefined;
  const value = ctx.args.value as ModelValue;
  if (propId === undefined || itemIndex === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing id or index argument');
  }
  if (propMap.isReadOnly(ctx.oid, propMap.resolvePropertyName(ctx.oid, propId.level, propId.index) ?? '')) {
    return err(NcMethodStatus.Readonly, 'Property is read-only');
  }
  const res = getArray(ctx, propMap, propId);
  if ('errorMessage' in res) return res;
  const { arr, propName, path } = res;
  if (itemIndex < 0 || itemIndex >= arr.length) {
    return err(NcMethodStatus.IndexOutOfBounds, `Index ${itemIndex} out of range (length ${arr.length})`);
  }
  const updated = [...arr];
  updated[itemIndex] = value;
  ctx.bus.publish(makeSetPropertyOp({
    origin: ctx.adapterId,
    correlationId: ctx.correlationId,
    nodeId: path,
    property: propName,
    value: updated as ModelValue,
  }));
  return okVoid();
}

function ncAddSequenceItem(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  const value = ctx.args.value as ModelValue;
  if (propId === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing id argument');
  }
  if (propMap.isReadOnly(ctx.oid, propMap.resolvePropertyName(ctx.oid, propId.level, propId.index) ?? '')) {
    return err(NcMethodStatus.Readonly, 'Property is read-only');
  }
  const res = getArray(ctx, propMap, propId);
  if ('errorMessage' in res) return res;
  const { arr, propName, path } = res;
  const updated = [...arr, value];
  ctx.bus.publish(makeSetPropertyOp({
    origin: ctx.adapterId,
    correlationId: ctx.correlationId,
    nodeId: path,
    property: propName,
    value: updated as ModelValue,
  }));
  return { status: NcMethodStatus.Ok, id: arr.length };
}

function ncRemoveSequenceItem(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  const propId = ctx.args.id as { level: number; index: number } | undefined;
  const itemIndex = ctx.args.index as number | undefined;
  if (propId === undefined || itemIndex === undefined) {
    return err(NcMethodStatus.BadCommandFormat, 'Missing id or index argument');
  }
  if (propMap.isReadOnly(ctx.oid, propMap.resolvePropertyName(ctx.oid, propId.level, propId.index) ?? '')) {
    return err(NcMethodStatus.Readonly, 'Property is read-only');
  }
  const res = getArray(ctx, propMap, propId);
  if ('errorMessage' in res) return res;
  const { arr, propName, path } = res;
  if (itemIndex < 0 || itemIndex >= arr.length) {
    return err(NcMethodStatus.IndexOutOfBounds, `Index ${itemIndex} out of range (length ${arr.length})`);
  }
  const updated = arr.filter((_, i) => i !== itemIndex);
  ctx.bus.publish(makeSetPropertyOp({
    origin: ctx.adapterId,
    correlationId: ctx.correlationId,
    nodeId: path,
    property: propName,
    value: updated as ModelValue,
  }));
  return okVoid();
}

function ncGetSequenceLength(ctx: DispatchContext, propMap: PropertyIdMap): DispatchResult {
  return ncGetSequenceLength_impl(ctx, propMap);
}
