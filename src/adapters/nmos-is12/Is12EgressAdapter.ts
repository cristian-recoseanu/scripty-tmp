/**
 * E11 — IS-12 Egress Adapter.
 * E17 — IS-04 Node API + Registration integration.
 *
 * Implements the Adapter interface for NMOS IS-12 / MS-05.
 *
 * Responsibilities:
 *   T5  — WebSocket server & control session lifecycle
 *   T6  — Command/CommandResponse message handling
 *   T7  — Subscription/SubscriptionResponse
 *   T8  — Notifications (bus → subscribed sessions)
 *   T9  — Error handling & status codes
 *   T10 — Data type marshalling (JSON native — IS-12 wire format)
 *   T11 — IS-04 registration (behind is04.registration.enabled flag)
 *   T12 — Adapter config schema
 *   E17 — IS-04 Node API HTTP server + Registration API client
 */

import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { WebSocketServer } from 'ws';


import { assertNoEgressGaps } from '../../config/validateMappings.js';
import { EgressMapper } from '../../mapping/EgressMapper.js';
import { loadEgressMapping } from '../../mapping/loadMapping.js';


import { Is12AdapterConfigSchema, IS12_CONFIG_JSON_SCHEMA } from './config.js';
import { NodeApiServer } from './is04/NodeApiServer.js';
import { RegistrationClient } from './is04/RegistrationClient.js';
import { buildIs04Node, buildIs04Device, buildIs04Sender, buildIs04Receiver, buildNcpControl } from './is04/resources.js';
import { buildCatalogue } from './ms05/catalogue.js';
import { IdentityRegistry, OID_ROOT, OID_DEVICE_MANAGER, OID_CLASS_MANAGER } from './ms05/IdentityRegistry.js';
import {
  dispatch,
  readDerivedOverallStatus,
  type PropertyIdMap,
  type DispatchContext,
} from './ms05/NcObjectMethods.js';
import { isDomainStatusProperty } from './ms05/overallStatus.js';
import {
  IS12MessageType,
  NcMethodStatus,
  NcPropertyChangeType,
  type IS12Message,
  type IS12CommandMessage,
  type IS12CommandResponseMessage,
  type IS12SubscriptionMessage,
  type IS12SubscriptionResponseMessage,
  type IS12ErrorMessage,
  type IS12NotificationMessage,
  type NcCommandResponseMessage,
  type NcNotificationMessage,
  type NcPropertyChangedEventData,
} from './ms05/types.js';

import type { Is12AdapterConfig, Is04Config } from './config.js';
import type { Adapter, AdapterContext, AdapterFactory, HealthStatus, JSONSchema } from '../Adapter.js';
import type { Is04Node, Is04Device, Is04Sender, Is04Receiver } from './is04/types.js';
import type { Catalogue } from './ms05/catalogue.js';
import type { PropertyChangedOp } from '../../engine/bus/operations.js';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Per-session state
// ---------------------------------------------------------------------------

interface Session {
  readonly id: string;
  readonly ws: WebSocket;
  /** Set of subscribed oids. */
  readonly subscriptions: Set<number>;
  /** Per-session userLabel store: oid -> label. */
  readonly userLabels: Map<number, string>;
}

// ---------------------------------------------------------------------------
// Is12EgressAdapter
// ---------------------------------------------------------------------------

export class Is12EgressAdapter implements Adapter {
  readonly id: string;
  readonly kind = 'egress' as const;
  readonly protocol = 'nmos-is12' as const;

  private _ctx: AdapterContext | undefined;
  private _config: Is12AdapterConfig | undefined;
  private _httpServer: http.Server | undefined;
  private _wss: WebSocketServer | undefined;
  private _sessions = new Map<string, Session>();
  private _catalogue: Catalogue | undefined;
  private _identityRegistry: IdentityRegistry | undefined;
  private _propMap: PropertyIdMap | undefined;
  private _busUnsubscribe: (() => void) | undefined;
  private _health: HealthStatus = { state: 'initialising' };
  private _egressMapper: EgressMapper | undefined;
  /**
   * Entity-def → classId for user entities remapped to standard classIds.
   * Populated by _applyClassIdOverrides. Passed to DispatchContext so getClassId()
   * resolves the correct classId without adding duplicate entries to the catalogue.
   */
  private readonly _classIdOverrides = new Map<string, readonly number[]>();
  /** Last derived overallStatus emitted per monitor oid (avoids duplicate notifications). */
  private readonly _lastOverallStatus = new Map<number, number>();
  private _nodeApiServer: NodeApiServer | undefined;
  private _registrationClient: RegistrationClient | undefined;
  private _is04Node: Is04Node | undefined;
  private _is04Device: Is04Device | undefined;
  private _is04Senders: Is04Sender[] = [];
  private _is04Receivers: Is04Receiver[] = [];

  constructor(id: string) {
    this.id = id;
  }

  configSchema(): JSONSchema {
    return IS12_CONFIG_JSON_SCHEMA;
  }

  // -------------------------------------------------------------------------
  // init — T12 config validation, T1/T2 catalogue & identity registry
  // -------------------------------------------------------------------------

  init(ctx: AdapterContext): Promise<void> {
    this._ctx = ctx;
    const parsed = Is12AdapterConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      return Promise.reject(
        new Error(`Is12EgressAdapter '${this.id}': invalid config — ${parsed.error.message}`),
      );
    }
    this._config = parsed.data;

    // Build catalogue from engine registries; classId overrides applied below
    // after loading the egress mapping (E18.T2 — nested NcBlock support).
    this._catalogue = buildCatalogue(ctx.types, ctx.entities);
    this._identityRegistry = new IdentityRegistry();

    // Register root and all tree nodes
    const root = ctx.tree.root;
    if (root !== undefined) {
      this._identityRegistry.registerNode(root.identity.path, true);
      this._registerSubtree(root.identity.path);
    }

    // Load egress mapping for runtime property projection (E18.T1)
    const mappingPath = (ctx.config as Record<string, unknown>).mapping;
    if (typeof mappingPath === 'string') {
      try {
        this._egressMapper = new EgressMapper(loadEgressMapping(mappingPath), ctx.entities);
        assertNoEgressGaps(this._egressMapper, this.id);
      } catch (e) {
        ctx.logger.warn(`Is12EgressAdapter '${this.id}': failed to load egress mapping from '${mappingPath}' — ${String(e)}`);
      }
    }

    // Override catalogue classIds from the egress mapping (E18.T2).
    // This ensures that entities declared as e.g. classId [1,1] (NcBlock)
    // in the mapping are treated as blocks by isBlockOid() — enabling nested
    // NcBlock hierarchies without any engine changes.
    this._catalogue = this._applyClassIdOverrides(this._catalogue, this._egressMapper);

    // Build the PropertyIdMap from the entity definitions + egress mapping
    this._propMap = this._buildPropertyIdMap();

    return Promise.resolve();
  }

  private _registerSubtree(path: string): void {
    const lookup = this._ctx?.tree.findById(path);
    if (!lookup?.ok) return;
    for (const child of lookup.node.children.values()) {
      const childPath = child.identity.path;
      this._identityRegistry?.registerNode(childPath);
      this._registerSubtree(childPath);
    }
  }

  /**
   * E18.T2 — Patch catalogue classIds with those declared in the egress mapping.
   *
   * Two cases per overridden entity:
   *
   * 1. The target classId already exists in the catalogue (standard/featureSet class,
   *    e.g. ReceiverMonitorsBlock → [1,1] = NcBlock, ReceiverMonitor → [1,2,2,1] =
   *    NcReceiverMonitor): remove the user entity from the catalogue so ClassManager's
   *    ControlClasses listing has no duplicates. Store the mapping in _classIdOverrides
   *    so getClassId() still returns the correct value for device-model traversal and
   *    isBlockOid() checks.
   *
   * 2. The target classId is genuinely new (no existing entry): update the user entity's
   *    descriptor in the catalogue and also record in _classIdOverrides.
   */
  private _applyClassIdOverrides(catalogue: Catalogue, egressMapper: EgressMapper | undefined): Catalogue {
    if (egressMapper === undefined) return catalogue;
    const classes = new Map(catalogue.classes);
    for (const entityDef of egressMapper.entityDefs()) {
      const cls = egressMapper.getClass(entityDef);
      if (cls === undefined) continue;
      const classId = cls.classId;
      if (!Array.isArray(classId)) continue;
      const overriddenClassId = classId as readonly number[];
      const overriddenKey = JSON.stringify(overriddenClassId);
      const existing = classes.get(entityDef);
      if (existing === undefined) continue;

      // Check whether another catalogue entry already owns this classId.
      let alreadyClaimed = false;
      for (const [key, desc] of classes) {
        if (key !== entityDef && JSON.stringify(desc.classId) === overriddenKey) {
          alreadyClaimed = true;
          break;
        }
      }

      this._classIdOverrides.set(entityDef, overriddenClassId);

      if (alreadyClaimed) {
        // Standard/featureSet class with this classId already exists.
        // Remove the user entity to avoid duplicate ControlClasses entries.
        classes.delete(entityDef);
      } else {
        // New classId — update the user entity's descriptor.
        classes.set(entityDef, { ...existing, classId: overriddenClassId });
      }
    }
    return { datatypes: catalogue.datatypes, classes };
  }

  private _buildIs04Resources(
    is04: Is04Config,
    config: Is12AdapterConfig,
    ncpControl: ReturnType<typeof buildNcpControl>,
    httpPort: number,
    advertiseHost: string,
  ): { node: Is04Node; device: Is04Device; senders: Is04Sender[]; receivers: Is04Receiver[] } {
    const label = is04.label ?? config.instanceName;
    const node = buildIs04Node({
      nodeId: is04.nodeId,
      httpPort,
      httpHost: advertiseHost,
      label,
      description: is04.description,
    });
    const deviceId = is04.deviceId ?? randomUUID();
    const senders: Is04Sender[] = [];
    const receivers: Is04Receiver[] = [];
    if (is04.senderId !== undefined) {
      senders.push(
        buildIs04Sender({
          senderId: is04.senderId,
          flowId: is04.flowId,
          deviceId,
          label: label !== undefined ? `${label} sender` : undefined,
        }),
      );
    }
    if (is04.receiverId !== undefined) {
      receivers.push(
        buildIs04Receiver({
          receiverId: is04.receiverId,
          deviceId,
          label: label !== undefined ? `${label} receiver` : undefined,
        }),
      );
    }
    const device = buildIs04Device({
      deviceId,
      nodeId: node.id,
      label,
      description: is04.description,
      controls: [ncpControl],
      senderIds: senders.map((s) => s.id),
      receiverIds: receivers.map((r) => r.id),
    });
    return { node, device, senders, receivers };
  }

  private _buildPropertyIdMap(): PropertyIdMap {
    const catalogue = this._catalogue!;
    const identityRegistry = this._identityRegistry!;
    const tree = this._ctx!.tree;
    const egressMapper = this._egressMapper;

    function getEntityName(oid: number): string | undefined {
      const path = identityRegistry.pathForOid(oid);
      if (path === undefined) return undefined;
      const lookup = tree.findById(path);
      if (!lookup.ok) return undefined;
      return lookup.node.identity.entity_def;
    }

    return {
      resolvePropertyName(oid: number, level: number, index: number): string | undefined {
        const entityName = getEntityName(oid);
        if (entityName === undefined) return undefined;

        // 1. Consult egress mapping: find the property whose targetId matches {level,index}
        if (egressMapper !== undefined) {
          const cls = egressMapper.getClass(entityName);
          if (cls !== undefined) {
            for (const [propName, entry] of cls.properties) {
              const tid = entry.targetId as { level: number; index: number } | undefined;
              if (tid?.level === level && tid.index === index) {
                return propName;
              }
            }
          }
        }

        // 2. Fall back to catalogue level-3 (auto-assigned for user-defined classes)
        if (level !== 3) return undefined;
        const classDesc = catalogue.classes.get(entityName);
        if (classDesc === undefined) return undefined;
        const prop = classDesc.properties.find((p) => p.id.level === level && p.id.index === index);
        return prop?.name;
      },

      resolvePropertyId(oid: number, name: string): { level: number; index: number } | undefined {
        const entityName = getEntityName(oid);
        if (entityName === undefined) return undefined;

        // 1. Consult egress mapping for explicit targetId
        if (egressMapper !== undefined) {
          const cls = egressMapper.getClass(entityName);
          if (cls !== undefined) {
            const entry = cls.properties.get(name);
            if (entry !== undefined) {
              const tid = entry.targetId as { level: number; index: number } | undefined;
              if (tid !== undefined) return tid;
            }
          }
        }

        // 2. Fall back to catalogue (level-3 auto-assigned)
        const classDesc = catalogue.classes.get(entityName);
        if (classDesc === undefined) return undefined;
        const prop = classDesc.properties.find((p) => p.name === name);
        return prop?.id;
      },

      isReadOnly(oid: number, propertyName: string): boolean {
        const entityName = getEntityName(oid);
        if (entityName === undefined) return true;

        // Egress mapping readOnly flag takes precedence
        if (egressMapper !== undefined) {
          const cls = egressMapper.getClass(entityName);
          if (cls !== undefined) {
            const entry = cls.properties.get(propertyName);
            if (entry?.readOnly !== undefined) return entry.readOnly;
          }
        }

        const classDesc = catalogue.classes.get(entityName);
        if (classDesc === undefined) return true;
        const prop = classDesc.properties.find((p) => p.name === propertyName);
        return prop?.isReadOnly ?? true;
      },

      isSequence(oid: number, propertyName: string): boolean {
        const entityName = getEntityName(oid);
        if (entityName === undefined) return false;
        const classDesc = catalogue.classes.get(entityName);
        if (classDesc === undefined) return false;
        const prop = classDesc.properties.find((p) => p.name === propertyName);
        return prop?.isSequence ?? false;
      },

      touchpoints(oid: number): unknown[] | null {
        if (egressMapper === undefined) return null;
        const path = identityRegistry.pathForOid(oid);
        if (path === undefined) return null;
        return egressMapper.getTouchpoints(path);
      },
    };
  }

  // -------------------------------------------------------------------------
  // start — T5 WebSocket server, T8 bus subscription
  // -------------------------------------------------------------------------

  start(): Promise<void> {
    if (this._config === undefined || this._ctx === undefined) {
      return Promise.reject(new Error(`Is12EgressAdapter '${this.id}': start() called before init()`));
    }

    const config = this._config;
    const ctx = this._ctx;
    const useSharedServer = config.is04.nodeApi.enabled;

    if (useSharedServer) {
      // Shared-port mode: one http.Server handles both IS-04 REST and WS upgrade.
      // Build IS-04 resources first so we can pass NodeApiServer.handleRequest as
      // the http.createServer() callback — this ensures IS-04 owns the 'request'
      // event and ws only intercepts HTTP Upgrade (WS) requests.
      const is04 = config.is04;
      const httpPort = is04.nodeApi.httpPort!;
      const advertiseHost = is04.nodeApi.advertiseHost ?? config.host;
      const advertisePort = config.outsidePort ?? httpPort;
      const wsPath = config.wsPath;

      const ncpControl = buildNcpControl(advertiseHost, advertisePort, wsPath);
      const is04Resources = this._buildIs04Resources(is04, config, ncpControl, httpPort, advertiseHost);
      this._is04Node = is04Resources.node;
      this._is04Device = is04Resources.device;
      this._is04Senders = is04Resources.senders;
      this._is04Receivers = is04Resources.receivers;
      const nodeApiServer = new NodeApiServer(
        this._is04Node,
        this._is04Device,
        httpPort,
        is04.nodeApi.host,
        undefined,
        { senders: this._is04Senders, receivers: this._is04Receivers },
      );
      this._nodeApiServer = nodeApiServer;

      return new Promise<void>((resolve, reject) => {
        const httpServer = http.createServer(
          (req: http.IncomingMessage, res: http.ServerResponse) =>
            nodeApiServer.handleRequest(req, res),
        );
        const wsPathOption = wsPath === '/' ? undefined : wsPath;
        const wss = new WebSocketServer({ server: httpServer, path: wsPathOption });

        wss.on('error', (err: Error) => {
          this._health = { state: 'error', detail: err.message };
          reject(err);
        });

        wss.on('connection', (ws: WebSocket) => {
          this._handleConnection(ws);
        });

        httpServer.once('error', (err: Error) => {
          this._health = { state: 'error', detail: err.message };
          reject(err);
        });

        httpServer.listen(httpPort, config.host, () => {
          this._httpServer = httpServer;
          this._wss = wss;
          this._setupBusSubscription(ctx);
          resolve();
        });
      }).then(async () => {
        ctx.logger.info(
          `IS-04 Node API + IS-12 WS on http/ws://${is04.nodeApi.host}:${httpPort} (wsPath: ${wsPath})`,
        );
        if (is04.registration.enabled) {
          const reg = is04.registration;
          this._registrationClient = new RegistrationClient({
            registryHost: reg.host!,
            registryPort: reg.port,
            heartbeatIntervalSec: reg.heartbeatIntervalSec,
            node: this._is04Node!,
            device: this._is04Device!,
            logger: ctx.logger,
          });
          await this._registrationClient.start();
        }
        this._health = { state: 'healthy' };
      });
    }

    // Standalone mode: dedicated WebSocket-only server.
    return new Promise<void>((resolve, reject) => {
      const wsPath = config.wsPath === '/' ? undefined : config.wsPath;
      const wss = new WebSocketServer({
        port: config.wsPort,
        host: config.host,
        path: wsPath,
      });

      wss.on('error', (err: Error) => {
        this._health = { state: 'error', detail: err.message };
        reject(err);
      });

      wss.on('listening', () => {
        this._wss = wss;
        this._setupBusSubscription(ctx);
        resolve();
      });

      wss.on('connection', (ws: WebSocket) => {
        this._handleConnection(ws);
      });
    }).then(() => this._startIs04(config));
  }

  private _startIs04(config: Is12AdapterConfig): Promise<void> {
    // Only called from standalone mode (is04.nodeApi.enabled = false).
    // Shared-port mode (enabled = true) handles everything inline in start().
    if (!config.is04.nodeApi.enabled) {
      this._health = { state: 'healthy' };
    }
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // T5 — Session lifecycle
  // -------------------------------------------------------------------------

  private _handleConnection(ws: WebSocket): void {
    const sessionId = randomUUID();
    const userLabels = new Map<number, string>();

    // Seed userLabels from the current tree state so Get userLabel reflects
    // values set before this session connected (e.g. via MQTT ingress).
    const identityRegistry = this._identityRegistry;
    const tree = this._ctx?.tree;
    const propMap = this._propMap;
    if (identityRegistry !== undefined && tree !== undefined && propMap !== undefined) {
      for (const oid of identityRegistry.allOids()) {
        const path = identityRegistry.pathForOid(oid);
        if (path === undefined) continue;
        const lookup = tree.findById(path);
        if (!lookup.ok) continue;
        for (const [propName] of lookup.node.properties) {
          if (propName !== 'userLabel') continue;
          const result = lookup.node.getProperty(propName);
          if (result.ok && typeof result.value === 'string') {
            userLabels.set(oid, result.value);
          }
        }
      }
    }

    const session: Session = { id: sessionId, ws, subscriptions: new Set(), userLabels };
    this._sessions.set(sessionId, session);

    ws.on('message', (raw: Buffer | string) => {
      this._handleMessage(session, raw.toString());
    });

    ws.on('close', () => {
      this._sessions.delete(sessionId);
    });

    ws.on('error', () => {
      this._sessions.delete(sessionId);
    });
  }

  // -------------------------------------------------------------------------
  // T6 / T7 / T9 — Message handling
  // -------------------------------------------------------------------------

  private _handleMessage(session: Session, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw) as unknown;
    } catch {
      this._sendError(session, NcMethodStatus.BadCommandFormat, 'Invalid JSON');
      return;
    }

    if (typeof msg !== 'object' || msg === null || !('messageType' in msg)) {
      this._sendError(session, NcMethodStatus.BadCommandFormat, 'Missing messageType');
      return;
    }

    const narrowed = msg as Record<string, unknown>;
    const messageType = narrowed.messageType;

    switch (messageType) {
      case IS12MessageType.Command:
        this._handleCommand(session, msg as IS12CommandMessage);
        break;
      case IS12MessageType.Subscription:
        this._handleSubscription(session, msg as IS12SubscriptionMessage);
        break;
      default:
        this._sendError(session, NcMethodStatus.BadCommandFormat, `Unknown messageType ${String(messageType)}`);
        return;
    }
  }

  private _handleCommand(session: Session, msg: IS12CommandMessage): void {
    if (!Array.isArray(msg.commands)) {
      this._sendError(session, NcMethodStatus.BadCommandFormat, 'Missing commands array');
      return;
    }

    const responses: NcCommandResponseMessage[] = [];

    for (const cmd of msg.commands) {
      // IS-12: handle MUST be an integer in the range 1..65535
      if (
        typeof cmd.handle !== 'number' ||
        !Number.isInteger(cmd.handle) ||
        cmd.handle < 1 ||
        cmd.handle > 65535
      ) {
        this._sendError(session, NcMethodStatus.BadCommandFormat, `Command handle must be an integer in 1..65535, got ${String(cmd.handle)}`);
        return;
      }

      const ctx: DispatchContext = {
        oid: cmd.oid,
        methodId: cmd.methodId,
        args: cmd.arguments ?? {},
        tree: this._ctx!.tree,
        bus: this._ctx!.bus,
        catalogue: this._catalogue!,
        identityRegistry: this._identityRegistry!,
        adapterId: this.id,
        correlationId: randomUUID(),
        userLabels: session.userLabels,
        propMap: this._propMap!,
        classIdOverrides: this._classIdOverrides,
      };

      // Validate oid exists (not for built-in managers which always exist)
      if (
        cmd.oid !== OID_ROOT &&
        cmd.oid !== OID_DEVICE_MANAGER &&
        cmd.oid !== OID_CLASS_MANAGER &&
        !this._identityRegistry?.hasOid(cmd.oid)
      ) {
        responses.push({
          handle: cmd.handle,
          result: { status: NcMethodStatus.BadOid, errorMessage: `Unknown oid ${cmd.oid}` },
        });
        continue;
      }

      const result = dispatch(ctx, this._propMap!);
      responses.push({ handle: cmd.handle, result });
    }

    const response: IS12CommandResponseMessage = {
      messageType: IS12MessageType.CommandResponse,
      responses,
    };
    this._send(session, response);
  }

  private _handleSubscription(session: Session, msg: IS12SubscriptionMessage): void {
    const requested = Array.isArray(msg.subscriptions) ? msg.subscriptions : [];
    // Filter: only accept oids we know about
    const valid = requested.filter(
      (oid) =>
        oid === OID_ROOT ||
        oid === OID_DEVICE_MANAGER ||
        oid === OID_CLASS_MANAGER ||
        this._identityRegistry?.hasOid(oid) === true,
    );
    session.subscriptions.clear();
    for (const oid of valid) session.subscriptions.add(oid);

    const response: IS12SubscriptionResponseMessage = {
      messageType: IS12MessageType.SubscriptionResponse,
      subscriptions: valid,
    };
    this._send(session, response);
  }

  // -------------------------------------------------------------------------
  // T8 — Notifications: bus → subscribed sessions
  // -------------------------------------------------------------------------

  private _setupBusSubscription(ctx: AdapterContext): void {
    const sub = ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => {
      this._onPropertyChanged(op as PropertyChangedOp);
    });
    this._busUnsubscribe = () => { sub.unsubscribe(); };
  }

  private _onPropertyChanged(op: PropertyChangedOp): void {
    // Don't echo our own ops
    if (op.origin === this.id) return;

    // userLabel ops are published with nodeId = String(oid) and property = 'userLabel'
    // by setStandardProperty.  Resolve oid directly from the numeric nodeId string.
    if (op.property === 'userLabel' && typeof op.value === 'string') {
      const oid = parseInt(op.nodeId, 10);
      if (!isNaN(oid) && this._identityRegistry?.hasOid(oid) === true) {
        for (const session of this._sessions.values()) {
          session.userLabels.set(oid, op.value);
        }
        this._emitNotification(oid, { level: 1, index: 6 }, op.value);
        return;
      }
    }

    const oid = this._getOidForNode(op.nodeId);
    if (oid === undefined) return;

    const propId = this._propMap?.resolvePropertyId(oid, op.property);
    if (propId === undefined) return;

    // Sync tree-originated userLabel into the per-session cache.
    if (op.property === 'userLabel' && typeof op.value === 'string') {
      for (const session of this._sessions.values()) {
        session.userLabels.set(oid, op.value);
      }
    }

    this._emitNotification(oid, propId, op.value);

    // Re-emit derived overallStatus when a domain status changes (BCP-008-01/02).
    this._maybeEmitDerivedOverallStatus(oid, op.nodeId, op.property, op.value);
  }

  private _maybeEmitDerivedOverallStatus(
    oid: number,
    nodePath: string,
    propertyName: string,
    propertyValue: unknown,
  ): void {
    if (this._ctx === undefined || this._propMap === undefined) return;
    const ctx: DispatchContext = {
      oid,
      methodId: { level: 1, index: 1 },
      args: {},
      tree: this._ctx.tree,
      bus: this._ctx.bus,
      catalogue: this._catalogue!,
      identityRegistry: this._identityRegistry!,
      adapterId: this.id,
      correlationId: '',
      userLabels: new Map(),
      propMap: this._propMap,
      classIdOverrides: this._classIdOverrides,
    };
    const entityPath = this._identityRegistry?.pathForOid(oid);
    if (entityPath === undefined) return;
    const lookup = this._ctx.tree.findById(entityPath);
    if (!lookup.ok) return;
    const entityName = lookup.node.identity.entity_def;
    const classId =
      this._classIdOverrides.get(entityName) ??
      this._catalogue?.classes.get(entityName)?.classId;
    if (classId === undefined || !isDomainStatusProperty(classId, propertyName)) return;

    const overall = readDerivedOverallStatus(ctx, oid, nodePath, {
      property: propertyName,
      value: propertyValue,
    });
    if (overall === undefined) return;
    const prev = this._lastOverallStatus.get(oid);
    if (prev === overall) return;
    this._lastOverallStatus.set(oid, overall);
    this._emitNotification(oid, { level: 3, index: 1 }, overall);
  }

  private _emitNotification(
    oid: number,
    propertyId: { level: number; index: number },
    value: unknown,
  ): void {
    const eventData: NcPropertyChangedEventData = {
      propertyId,
      changeType: NcPropertyChangeType.ValueChanged,
      value,
      sequenceItemIndex: null,
    };

    const notification: NcNotificationMessage = {
      oid,
      eventId: { level: 1, index: 1 }, // NcObject.PropertyChanged event
      eventData,
    };

    const msg: IS12NotificationMessage = {
      messageType: IS12MessageType.Notification,
      notifications: [notification],
    };

    for (const session of this._sessions.values()) {
      if (session.subscriptions.has(oid)) {
        this._send(session, msg);
      }
    }
  }

  private _getOidForNode(nodeId: string): number | undefined {
    try {
      return this._identityRegistry?.oidForPath(nodeId);
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // T9 — Error responses
  // -------------------------------------------------------------------------

  private _sendError(session: Session, status: NcMethodStatus, message: string): void {
    const msg: IS12ErrorMessage = {
      messageType: IS12MessageType.Error,
      status,
      errorMessage: message,
    };
    this._send(session, msg);
  }

  private _send(session: Session, msg: IS12Message): void {
    if (session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify(msg));
    }
  }

  // -------------------------------------------------------------------------
  // stop
  // -------------------------------------------------------------------------

  stop(): Promise<void> {
    this._health = { state: 'stopped' };
    this._busUnsubscribe?.();
    this._busUnsubscribe = undefined;

    // Close all sessions
    for (const session of this._sessions.values()) {
      session.ws.terminate();
    }
    this._sessions.clear();

    const wssStop = new Promise<void>((resolve, reject) => {
      if (this._wss === undefined) {
        resolve();
        return;
      }
      this._wss.close((err) => {
        this._wss = undefined;
        if (err !== undefined) reject(err);
        else resolve();
      });
    });

    const httpStop = new Promise<void>((resolve, reject) => {
      if (this._httpServer === undefined) {
        resolve();
        return;
      }
      this._httpServer.close((err) => {
        this._httpServer = undefined;
        if (err !== undefined) reject(err);
        else resolve();
      });
    });

    return wssStop
      .then(() => httpStop)
      .then(() => this._registrationClient?.stop())
      .then(() => { this._registrationClient = undefined; })
      .then(() => this._nodeApiServer?.stop())
      .then(() => { this._nodeApiServer = undefined; });
  }

  // -------------------------------------------------------------------------
  // health
  // -------------------------------------------------------------------------

  health(): HealthStatus {
    return this._health;
  }

  // -------------------------------------------------------------------------
  // Accessors (for testing)
  // -------------------------------------------------------------------------

  get sessionCount(): number {
    return this._sessions.size;
  }

  /** Actual bound WebSocket port (useful when wsPort: 0 is configured).
   *  In shared-port mode (IS-04 nodeApi enabled) this equals httpPort. */
  get wsPort(): number {
    const wssAddr = this._wss?.address();
    if (wssAddr !== null && typeof wssAddr === 'object') return wssAddr.port;
    const httpAddr = this._httpServer?.address();
    if (httpAddr !== null && typeof httpAddr === 'object') return httpAddr.port;
    return this._config?.wsPort ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const Is12AdapterFactory: AdapterFactory = {
  protocol: 'nmos-is12',
  kind: 'egress',
  create(id: string): Adapter {
    return new Is12EgressAdapter(id);
  },
};
