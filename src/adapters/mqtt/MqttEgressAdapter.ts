/**
 * E21.T5/T6 — MQTT Egress Adapter.
 *
 * Projects UCE property changes onto MQTT topics (outbound publish) and
 * accepts inbound writes on configured set-topics.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { connectAsync } from 'mqtt';

import { IngressMapper } from '../../mapping/IngressMapper.js';
import { loadIngressMapping } from '../../mapping/loadMapping.js';

import { MQTT_EGRESS_CONFIG_JSON_SCHEMA, MqttEgressAdapterConfigSchema } from './egressConfig.js';

import type { PropertyChangedOp } from '../../engine/bus/operations.js';
import type { ModelValue } from '../../engine/model/ObjectNode.js';
import type { Adapter, AdapterContext, AdapterFactory, HealthStatus, JSONSchema } from '../Adapter.js';
import type { MqttEgressAdapterConfig } from './egressConfig.js';
import type { IClientOptions, MqttClient } from 'mqtt';

let _seq = 0;
function nextCorrelationId(): string {
  return `mqtt-egress-${Date.now()}-${(_seq++).toString()}`;
}

interface DebounceEntry {
  value: Buffer;
  timer: ReturnType<typeof setTimeout>;
}

export class MqttEgressAdapter implements Adapter {
  readonly id: string;
  readonly kind = 'egress' as const;
  readonly protocol = 'mqtt' as const;

  private _config: MqttEgressAdapterConfig | null = null;
  private _ctx: AdapterContext | null = null;
  private _client: MqttClient | null = null;
  private _mapper: IngressMapper | null = null;
  private _health: HealthStatus = { state: 'initialising' };
  private _busSub: { unsubscribe(): void } | null = null;
  private _reconnectDelay = 1000;
  private readonly _debounce = new Map<string, DebounceEntry>();
  private readonly _echoWritten = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(id: string) {
    this.id = id;
  }

  configSchema(): JSONSchema {
    return MQTT_EGRESS_CONFIG_JSON_SCHEMA;
  }

  init(ctx: AdapterContext): Promise<void> {
    this._ctx = ctx;
    const parsed = MqttEgressAdapterConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      return Promise.reject(
        new Error(`MqttEgressAdapter '${this.id}': invalid config — ${parsed.error.message}`),
      );
    }
    this._config = parsed.data;
    this._reconnectDelay = parsed.data.reconnectPeriodMs;

    try {
      const mappingPath = this._resolveMappingPath(parsed.data.mapping);
      const mapping = loadIngressMapping(mappingPath);
      this._mapper = new IngressMapper(mapping, ctx.tree, {
        warn: (m) => ctx.logger.warn(m),
        error: (m) => ctx.logger.error(m),
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return Promise.resolve();
  }

  async start(): Promise<void> {
    if (this._config === null || this._ctx === null || this._mapper === null) {
      throw new Error(`MqttEgressAdapter '${this.id}': start() called before init()`);
    }
    const cfg = this._config;
    const ctx = this._ctx;

    const opts: IClientOptions = {
      reconnectPeriod: cfg.reconnectPeriodMs,
      clean: true,
    };
    if (cfg.clientId !== undefined) opts.clientId = cfg.clientId;
    if (cfg.username !== undefined) opts.username = cfg.username;
    if (cfg.password !== undefined) opts.password = cfg.password;
    if (cfg.lwt !== undefined) {
      opts.will = {
        topic: cfg.lwt.topic,
        payload: Buffer.from(cfg.lwt.payload),
        qos: cfg.lwt.qos,
        retain: cfg.lwt.retain,
      };
    }
    if (cfg.tls !== undefined) {
      opts.rejectUnauthorized = cfg.tls.rejectUnauthorized;
      if (cfg.tls.ca !== undefined) opts.ca = readFileSync(cfg.tls.ca);
      if (cfg.tls.cert !== undefined) opts.cert = readFileSync(cfg.tls.cert);
      if (cfg.tls.key !== undefined) opts.key = readFileSync(cfg.tls.key);
    }

    this._client = await connectAsync(cfg.url, opts);
    this._health = { state: 'healthy' };

    this._client.on('reconnect', () => {
      this._health = { state: 'degraded', detail: 'reconnecting' };
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, cfg.reconnectMaxMs);
    });
    this._client.on('connect', () => {
      this._health = { state: 'healthy' };
      this._reconnectDelay = cfg.reconnectPeriodMs;
      this._publishSnapshot();
    });
    this._client.on('error', (err: Error) => {
      this._health = { state: 'error', detail: err.message };
      ctx.logger.error(`MqttEgressAdapter '${this.id}': ${err.message}`);
    });
    this._client.on('offline', () => {
      this._health = { state: 'degraded', detail: 'offline' };
    });

    for (const sub of cfg.subscriptions) {
      await this._client.subscribeAsync(sub.topicFilter, { qos: sub.qos });
    }

    this._client.on('message', (topic: string, payload: Buffer) => {
      this._handleInboundMessage(topic, payload);
    });

    this._busSub = ctx.bus.subscribe(
      { op: 'propertyChanged' },
      (op) => {
        const pcOp = op as PropertyChangedOp;
        if (pcOp.origin !== this.id) {
          this._handleOutboundPublish(pcOp);
        }
      },
    );

    this._publishSnapshot();
  }

  async stop(): Promise<void> {
    for (const entry of this._debounce.values()) clearTimeout(entry.timer);
    this._debounce.clear();
    for (const entry of this._echoWritten.values()) clearTimeout(entry.timer);
    this._echoWritten.clear();
    this._busSub?.unsubscribe();
    this._busSub = null;
    if (this._client !== null) {
      await this._client.endAsync();
      this._client = null;
    }
    this._health = { state: 'stopped' };
  }

  health(): HealthStatus {
    return this._health;
  }

  private _publishSnapshot(): void {
    if (this._mapper === null || this._ctx === null || this._client === null) return;
    const tree = this._ctx.tree;
    for (let i = 0; i < this._mapper.ruleCount; i++) {
      const target = this._mapper.getRuleTarget(i);
      if (target === undefined || this._mapper.getRuleReverse(i) === undefined) continue;
      const lookup = tree.findById(target.location);
      if (!lookup.ok) continue;
      const prop = lookup.node.getProperty(target.property);
      if (!prop.ok || prop.value === null || prop.value === undefined) continue;
      this._publishForRule(i, {}, prop.value, target.location, target.property);
    }
  }

  private _handleOutboundPublish(op: PropertyChangedOp): void {
    if (this._client === null || this._mapper === null) return;
    const found = this._mapper.findRuleForTarget(op.nodeId, op.property);
    if (found === undefined) return;
    this._publishForRule(found.ruleIndex, found.captures, op.value, op.nodeId, op.property);
  }

  private _publishForRule(
    ruleIndex: number,
    captures: Record<string, string>,
    value: ModelValue,
    nodeId: string,
    property: string,
  ): void {
    if (this._client === null || this._mapper === null || this._config === null) return;
    const result = this._mapper.reverse(ruleIndex, captures, value);
    if (!result.ok) return;

    // Single-topic egress: register echo before publish so our own retained/state
    // message is not treated as an inbound write (mirrors MqttIngressAdapter write-back).
    const matchTopic = this._mapper.getRuleMatchTopicFilter(ruleIndex);
    if (matchTopic === result.topic) {
      this._registerEcho(nodeId, property, value);
    }

    const { qos, retain } = this._config.publish;
    this._client.publishAsync(result.topic, result.payload, { qos, retain }).catch((err: unknown) => {
      this._ctx?.logger.error(
        `MqttEgressAdapter '${this.id}': publish failed — ${String(err)}`,
      );
    });
  }

  private _handleInboundMessage(topic: string, payload: Buffer): void {
    if (this._config?.debounce !== undefined) {
      const windowMs = this._config.debounce.windowMs;
      const existing = this._debounce.get(topic);
      if (existing !== undefined) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        this._debounce.delete(topic);
        this._dispatchInbound(topic, payload);
      }, windowMs);
      this._debounce.set(topic, { value: payload, timer });
    } else {
      this._dispatchInbound(topic, payload);
    }
  }

  private _dispatchInbound(topic: string, payload: Buffer): void {
    if (this._mapper === null || this._ctx === null) return;
    const outcome = this._mapper.map(topic, payload);
    if (!outcome.ok) return;

    if (this._isEcho(outcome.nodeId, outcome.property, outcome.value)) {
      this._echoWritten.delete(`${outcome.nodeId}:${outcome.property}`);
      return;
    }

    this._registerEcho(outcome.nodeId, outcome.property, outcome.value);

    this._ctx.bus.publish({
      op: 'propertyChanged',
      correlationId: nextCorrelationId(),
      origin: this.id,
      ts: new Date().toISOString(),
      nodeId: outcome.nodeId,
      property: outcome.property,
      changeType: 'valueChanged',
      value: outcome.value,
    });

    // Split-topic pattern: after an inbound set-topic write, publish the state topic
    // (reverse descriptor) so retained state reflects the new value.
    const found = this._mapper.findRuleForTarget(outcome.nodeId, outcome.property);
    if (found !== undefined && this._mapper.getRuleReverse(found.ruleIndex) !== undefined) {
      this._publishForRule(found.ruleIndex, found.captures, outcome.value, outcome.nodeId, outcome.property);
    }
  }

  private _registerEcho(nodeId: string, property: string, value: ModelValue): void {
    const key = `${nodeId}:${property}`;
    const existing = this._echoWritten.get(key);
    if (existing !== undefined) clearTimeout(existing.timer);
    const timer = setTimeout(() => this._echoWritten.delete(key), 2000);
    this._echoWritten.set(key, { value: JSON.stringify(value), timer });
  }

  private _isEcho(nodeId: string, property: string, value: ModelValue): boolean {
    const entry = this._echoWritten.get(`${nodeId}:${property}`);
    if (entry === undefined) return false;
    return entry.value === JSON.stringify(value);
  }

  private _resolveMappingPath(mapping: string): string {
    if (mapping.startsWith('/')) return mapping;
    return resolve(process.cwd(), mapping);
  }
}

export const MqttEgressAdapterFactory: AdapterFactory = {
  protocol: 'mqtt',
  kind: 'egress',
  create(id: string): Adapter {
    return new MqttEgressAdapter(id);
  },
};
