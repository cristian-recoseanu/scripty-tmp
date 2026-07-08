/**
 * E21.T2/T3 — IS-12 Ingress Adapter (NCP client role).
 *
 * Connects outbound to a remote IS-12 device, observes PropertyChanged
 * notifications, normalises mapped properties into the UCE, and issues Set
 * commands for write-back when the UCE changes from other adapters.
 */

import { resolve } from 'node:path';

import { loadEgressMapping } from '../../mapping/loadMapping.js';

import { IS12_INGRESS_CONFIG_JSON_SCHEMA, Is12IngressConfigSchema } from './ingressConfig.js';
import { Is12IngressClient } from './Is12IngressClient.js';
import { Is12IngressMapper } from './Is12IngressMapper.js';
import { NC_OBJECT_METHOD } from './ms05/NcObjectMethods.js';
import { IS12MessageType, NcMethodStatus } from './ms05/types.js';

import type { PropertyChangedOp } from '../../engine/bus/operations.js';
import type { ModelValue } from '../../engine/model/ObjectNode.js';
import type { Adapter, AdapterContext, AdapterFactory, HealthStatus, JSONSchema } from '../Adapter.js';
import type { Is12IngressConfig } from './ingressConfig.js';
import type { IS12NotificationMessage } from './ms05/types.js';

let _seq = 0;
function nextCorrelationId(): string {
  return `is12-ingress-${Date.now()}-${(_seq++).toString()}`;
}

export class Is12IngressAdapter implements Adapter {
  readonly id: string;
  readonly kind = 'ingress' as const;
  readonly protocol = 'nmos-is12' as const;

  private _ctx: AdapterContext | null = null;
  private _config: Is12IngressConfig | null = null;
  private _mapper: Is12IngressMapper | null = null;
  private _client: Is12IngressClient | null = null;
  private _health: HealthStatus = { state: 'initialising' };
  private _busSub: { unsubscribe(): void } | null = null;
  private _reconnectDelay = 1000;
  private _stopped = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string) {
    this.id = id;
  }

  configSchema(): JSONSchema {
    return IS12_INGRESS_CONFIG_JSON_SCHEMA;
  }

  init(ctx: AdapterContext): Promise<void> {
    this._ctx = ctx;
    const parsed = Is12IngressConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      return Promise.reject(
        new Error(`Is12IngressAdapter '${this.id}': invalid config — ${parsed.error.message}`),
      );
    }
    this._config = parsed.data;
    this._reconnectDelay = parsed.data.reconnectPeriodMs;

    try {
      const mappingPath = this._resolveMappingPath(parsed.data.mapping);
      const mapping = loadEgressMapping(mappingPath);
      this._mapper = new Is12IngressMapper(
        mapping,
        ctx.tree,
        ctx.entities,
        parsed.data.rootOid,
      );
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return Promise.resolve();
  }

  async start(): Promise<void> {
    if (this._config === null || this._ctx === null || this._mapper === null) {
      throw new Error(`Is12IngressAdapter '${this.id}': start() called before init()`);
    }
    this._stopped = false;

    this._busSub = this._ctx.bus.subscribe(
      { op: 'propertyChanged' },
      (op) => {
        const pcOp = op as PropertyChangedOp;
        if (pcOp.origin !== this.id) {
          void this._handleWriteBack(pcOp);
        }
      },
    );

    await this._connect();
  }

  async stop(): Promise<void> {
    this._stopped = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._busSub?.unsubscribe();
    this._busSub = null;
    if (this._client !== null) {
      await this._client.close();
      this._client = null;
    }
    this._health = { state: 'stopped' };
  }

  health(): HealthStatus {
    return this._health;
  }

  private async _connect(): Promise<void> {
    if (this._stopped || this._config === null || this._ctx === null || this._mapper === null) {
      return;
    }
    const cfg = this._config;
    const ctx = this._ctx;
    const mapper = this._mapper;

    this._health = { state: 'degraded', detail: 'connecting' };

    try {
      const client = await Is12IngressClient.connect(cfg.wsUrl, {
        onNotification: (msg) => this._handleNotification(msg),
        onDisconnect: () => {
          this._client = null;
          if (!this._stopped) {
            this._health = { state: 'degraded', detail: 'disconnected' };
            this._scheduleReconnect();
          }
        },
        onError: (err) => {
          ctx.logger.error(`Is12IngressAdapter '${this.id}': ${err.message}`);
        },
      });
      this._client = client;

      const oids = mapper.subscriptionOids();
      if (oids.length > 0) {
        await client.subscribe(oids);
      }

      await this._syncInitialState(client, mapper);

      this._health = { state: 'healthy' };
      this._reconnectDelay = cfg.reconnectPeriodMs;
      ctx.logger.info(`Is12IngressAdapter '${this.id}': connected to ${cfg.wsUrl}`);
    } catch (err) {
      this._health = { state: 'degraded', detail: String(err) };
      ctx.logger.error(`Is12IngressAdapter '${this.id}': connect failed — ${String(err)}`);
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    if (this._stopped || this._config === null || this._ctx === null) return;
    if (this._reconnectTimer !== null) return;

    const delay = this._reconnectDelay;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      void this._connect();
    }, delay);

    this._reconnectDelay = Math.min(
      this._reconnectDelay * 2,
      this._config.reconnectMaxMs,
    );
    this._ctx.logger.warn(
      `Is12IngressAdapter '${this.id}': reconnecting in ${delay}ms`,
    );
  }

  private async _syncInitialState(
    client: Is12IngressClient,
    mapper: Is12IngressMapper,
  ): Promise<void> {
    for (const entry of mapper.mappedProperties()) {
      try {
        const resp = await client.command({
          oid: entry.oid,
          methodId: NC_OBJECT_METHOD.Get,
          arguments: { id: entry.propertyId },
        });
        const result = resp.responses[0]?.result;
        if (result?.status !== NcMethodStatus.Ok) continue;
        const value = (result as { value?: unknown }).value;
        if (value === undefined) continue;
        this._publishToBus(entry.nodeId, entry.property, value);
      } catch (err) {
        this._ctx?.logger.warn(
          `Is12IngressAdapter '${this.id}': initial Get failed for ${entry.nodeId}.${entry.property} — ${String(err)}`,
        );
      }
    }
  }

  private _handleNotification(msg: IS12NotificationMessage): void {
    if (this._mapper === null || this._ctx === null) return;
    if (msg.messageType !== IS12MessageType.Notification) return;

    for (const notif of msg.notifications) {
      const eventData = notif.eventData as {
        propertyId?: { level: number; index: number };
        value?: unknown;
      };
      const propertyId = eventData.propertyId;
      if (propertyId === undefined) continue;

      const resolved = this._mapper.resolveFromWire(notif.oid, propertyId);
      if (resolved === undefined) continue;

      this._publishToBus(resolved.nodeId, resolved.property, eventData.value);
    }
  }

  private _publishToBus(nodeId: string, property: string, value: unknown): void {
    if (this._ctx === null) return;
    this._ctx.bus.publish({
      op: 'propertyChanged',
      correlationId: nextCorrelationId(),
      origin: this.id,
      ts: new Date().toISOString(),
      nodeId,
      property,
      changeType: 'valueChanged',
      value: value as ModelValue,
    });
  }

  private async _handleWriteBack(op: PropertyChangedOp): Promise<void> {
    if (this._client === null || this._mapper === null || !this._client.connected) return;

    const entry = this._mapper.resolveToWire(op.nodeId, op.property);
    if (entry === undefined || entry.readOnly) return;

    try {
      const resp = await this._client.command({
        oid: entry.oid,
        methodId: NC_OBJECT_METHOD.Set,
        arguments: { id: entry.propertyId, value: op.value },
      });
      const result = resp.responses[0]?.result;
      if (result?.status !== NcMethodStatus.Ok) {
        this._ctx?.logger.warn(
          `Is12IngressAdapter '${this.id}': Set ${op.nodeId}.${op.property} returned status ${String(result?.status)}`,
        );
      }
    } catch (err) {
      this._ctx?.logger.error(
        `Is12IngressAdapter '${this.id}': write-back Set failed — ${String(err)}`,
      );
    }
  }

  private _resolveMappingPath(mapping: string): string {
    if (mapping.startsWith('/')) return mapping;
    return resolve(process.cwd(), mapping);
  }
}

export const Is12IngressAdapterFactory: AdapterFactory = {
  protocol: 'nmos-is12',
  kind: 'ingress',
  create(id: string): Adapter {
    return new Is12IngressAdapter(id);
  },
};
