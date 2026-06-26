/**
 * E10 — MQTT Ingress Adapter.
 *
 * T1: Connection management — connect/auth/TLS/reconnect-backoff/LWT/health.
 * T2: Subscription & topic-filter handling — QoS, wildcard capture.
 * T3: Forward message handling — IngressMapper → PropertyChangedOp → bus.
 * T4: Static-target resolution & unmatched handling — drop/warn/error policy.
 * T5: Reverse publisher — bus PropertyChangedOp (not from this adapter) → MQTT publish.
 * T6: Throttle/debounce — optional, latest-value-wins coalescing.
 * T7: configSchema() — validated at load time.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { connectAsync } from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';

import type { PropertyChangedOp } from '../../engine/bus/operations.js';
import type { ModelValue } from '../../engine/model/ObjectNode.js';
import { IngressMapper } from '../../mapping/IngressMapper.js';
import { IngressMappingSchema } from '../../mapping/types.js';
import type { Adapter, AdapterContext, AdapterFactory, HealthStatus, JSONSchema } from '../Adapter.js';

import type { MqttAdapterConfig } from './config.js';
import { MQTT_CONFIG_JSON_SCHEMA, MqttAdapterConfigSchema } from './config.js';

// ---------------------------------------------------------------------------
// Correlation id helper
// ---------------------------------------------------------------------------

let _seq = 0;
function nextCorrelationId(): string {
  return `mqtt-${Date.now()}-${(_seq++).toString()}`;
}

// ---------------------------------------------------------------------------
// E10.T6 — Debounce registry
// ---------------------------------------------------------------------------

interface DebounceEntry {
  value: Buffer;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// E10 — MqttIngressAdapter
// ---------------------------------------------------------------------------

export class MqttIngressAdapter implements Adapter {
  readonly id: string;
  readonly kind = 'ingress' as const;
  readonly protocol = 'mqtt' as const;

  private _config: MqttAdapterConfig | null = null;
  private _ctx: AdapterContext | null = null;
  private _client: MqttClient | null = null;
  private _mapper: IngressMapper | null = null;
  private _health: HealthStatus = { state: 'initialising' };
  private _busSub: { unsubscribe(): void } | null = null;
  /** Reconnect delay (ms) — grows up to reconnectMaxMs. */
  private _reconnectDelay: number = 1000;
  /** Debounce timers keyed by topic. */
  private readonly _debounce = new Map<string, DebounceEntry>();
  /** Count of messages dropped due to unresolved targets (E10.T4). */
  private _unmatchedCount = 0;
  /**
   * E13.T3 — Echo suppression: tracks recently written values keyed by
   * "nodeId:property" so that broker redeliveries are not re-emitted as ops.
   * Entry expires after echoSuppressWindowMs (default 2000ms).
   */
  private readonly _echoWritten = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(id: string) {
    this.id = id;
  }

  // -------------------------------------------------------------------------
  // E10.T7 — configSchema()
  // -------------------------------------------------------------------------

  configSchema(): JSONSchema {
    return MQTT_CONFIG_JSON_SCHEMA;
  }

  // -------------------------------------------------------------------------
  // E10.T1 — init(): parse & validate config, load mapping
  // -------------------------------------------------------------------------

  init(ctx: AdapterContext): Promise<void> {
    this._ctx = ctx;

    // Parse & validate config via zod
    const parsed = MqttAdapterConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      return Promise.reject(
        new Error(`MqttIngressAdapter '${this.id}': invalid config — ${parsed.error.message}`),
      );
    }
    this._config = parsed.data;
    this._reconnectDelay = this._config.reconnectPeriodMs;

    // Load ingress mapping JSON
    try {
      const mappingPath = this._resolveMappingPath(this._config.mapping);
      const rawMapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as unknown;
      const mapping = IngressMappingSchema.parse(rawMapping);
      this._mapper = new IngressMapper(mapping, ctx.tree, {
        warn: (m) => ctx.logger.warn(m),
        error: (m) => ctx.logger.error(m),
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // E10.T1 — start(): connect to broker, subscribe, wire bus
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this._config === null || this._ctx === null || this._mapper === null) {
      throw new Error(`MqttIngressAdapter '${this.id}': start() called before init()`);
    }
    const cfg = this._config;
    const ctx = this._ctx;

    // Build MQTT.js connection options
    const opts: IClientOptions = {
      reconnectPeriod: cfg.reconnectPeriodMs,
      clean: true,
    };
    if (cfg.clientId !== undefined) opts.clientId = cfg.clientId;
    if (cfg.username !== undefined) opts.username = cfg.username;
    if (cfg.password !== undefined) opts.password = cfg.password;

    // E10.T1 — LWT
    if (cfg.lwt !== undefined) {
      opts.will = {
        topic: cfg.lwt.topic,
        payload: Buffer.from(cfg.lwt.payload),
        qos: cfg.lwt.qos,
        retain: cfg.lwt.retain,
      };
    }

    // E10.T1 — TLS (mqtts:// or ssl://)
    if (cfg.tls !== undefined) {
      opts.rejectUnauthorized = cfg.tls.rejectUnauthorized;
      if (cfg.tls.ca !== undefined) opts.ca = readFileSync(cfg.tls.ca);
      if (cfg.tls.cert !== undefined) opts.cert = readFileSync(cfg.tls.cert);
      if (cfg.tls.key !== undefined) opts.key = readFileSync(cfg.tls.key);
    }

    this._client = await connectAsync(cfg.url, opts);
    this._health = { state: 'healthy' };

    // E10.T1 — reconnect/backoff event tracking
    this._client.on('reconnect', () => {
      this._health = { state: 'degraded', detail: 'reconnecting' };
      ctx.logger.warn(`MqttIngressAdapter '${this.id}': reconnecting (delay ${this._reconnectDelay}ms)`);
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, cfg.reconnectMaxMs);
    });
    this._client.on('connect', () => {
      this._health = { state: 'healthy' };
      this._reconnectDelay = cfg.reconnectPeriodMs; // reset on success
    });
    this._client.on('error', (err: Error) => {
      this._health = { state: 'error', detail: err.message };
      ctx.logger.error(`MqttIngressAdapter '${this.id}': ${err.message}`);
    });
    this._client.on('offline', () => {
      this._health = { state: 'degraded', detail: 'offline' };
    });

    // E10.T2 — Subscribe to configured topic filters
    for (const sub of cfg.subscriptions) {
      await this._client.subscribeAsync(sub.topicFilter, { qos: sub.qos });
    }

    // E10.T3 / T4 — Handle incoming messages
    this._client.on('message', (topic: string, payload: Buffer) => {
      this._handleMessage(topic, payload);
    });

    // E10.T5 — Subscribe to bus for reverse publishing (write-back)
    // Receive PropertyChanged ops NOT originating from this adapter
    this._busSub = ctx.bus.subscribe(
      { op: 'propertyChanged' },
      (op) => {
        const pcOp = op as PropertyChangedOp;
        if (pcOp.origin !== this.id) {
          this._handleWriteBack(pcOp);
        }
      },
    );
  }

  // -------------------------------------------------------------------------
  // E10.T1 — stop(): unsubscribe from bus, disconnect client
  // -------------------------------------------------------------------------

  async stop(): Promise<void> {
    // Cancel any pending debounce timers
    for (const entry of this._debounce.values()) {
      clearTimeout(entry.timer);
    }
    this._debounce.clear();

    // Cancel any pending echo suppression timers (E13.T3)
    for (const entry of this._echoWritten.values()) {
      clearTimeout(entry.timer);
    }
    this._echoWritten.clear();

    this._busSub?.unsubscribe();
    this._busSub = null;

    if (this._client !== null) {
      await this._client.endAsync();
      this._client = null;
    }
    this._health = { state: 'stopped' };
  }

  // -------------------------------------------------------------------------
  // E10.T1 — health()
  // -------------------------------------------------------------------------

  health(): HealthStatus {
    return this._health;
  }

  // -------------------------------------------------------------------------
  // Accessors for testing
  // -------------------------------------------------------------------------

  /** Number of messages dropped due to unresolved targets (E10.T4). */
  get unmatchedCount(): number {
    return this._unmatchedCount;
  }

  // -------------------------------------------------------------------------
  // E10.T3 / T4 — Private: handle incoming MQTT message
  // -------------------------------------------------------------------------

  private _handleMessage(topic: string, payload: Buffer): void {
    if (this._config?.debounce !== undefined) {
      // E10.T6 — debounce: coalesce burst, latest value wins
      const windowMs = this._config.debounce.windowMs;
      const existing = this._debounce.get(topic);
      if (existing !== undefined) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        this._debounce.delete(topic);
        this._dispatchMessage(topic, payload);
      }, windowMs);
      this._debounce.set(topic, { value: payload, timer });
    } else {
      this._dispatchMessage(topic, payload);
    }
  }

  private _dispatchMessage(topic: string, payload: Buffer): void {
    if (this._mapper === null || this._ctx === null) return;

    const outcome = this._mapper.map(topic, payload);

    if (!outcome.ok) {
      if (!outcome.dropped) {
        // onUnresolved=error: non-dropped failure — still count as unmatched
        this._unmatchedCount++;
      } else {
        this._unmatchedCount++;
      }
      return;
    }

    // E13.T3 — Echo suppression: skip if this value was just written by write-back
    if (this._isEcho(outcome.nodeId, outcome.property, outcome.value)) {
      this._echoWritten.delete(`${outcome.nodeId}:${outcome.property}`);
      return;
    }

    // E10.T3 — Publish PropertyChangedOp to the engine bus
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
  }

  // -------------------------------------------------------------------------
  // E13.T2 — Private: reverse publish (write-back to broker)
  // -------------------------------------------------------------------------

  private _handleWriteBack(op: PropertyChangedOp): void {
    if (this._client === null || this._mapper === null) return;

    // Find the rule that maps to this nodeId + property
    const found = this._mapper.findRuleForTarget(op.nodeId, op.property);
    if (found === undefined) return;

    const result = this._mapper.reverse(found.ruleIndex, found.captures, op.value);
    if (!result.ok) return;

    // E13.T3 — Register echo suppression for 'single' strategy
    // For 'command' strategy the write-back goes to a different topic than
    // ingress reads, so the broker cannot echo it back to us.
    this._registerEcho(op.nodeId, op.property, op.value);

    const qos = 0;
    this._client.publishAsync(result.topic, result.payload, { qos }).catch((err: unknown) => {
      this._ctx?.logger.error(
        `MqttIngressAdapter '${this.id}': write-back publish failed — ${String(err)}`,
      );
    });
  }

  // -------------------------------------------------------------------------
  // E13.T3 — Echo suppression helpers
  // -------------------------------------------------------------------------

  private _registerEcho(nodeId: string, property: string, value: ModelValue): void {
    const key = `${nodeId}:${property}`;
    const existing = this._echoWritten.get(key);
    if (existing !== undefined) clearTimeout(existing.timer);
    const windowMs = 2000;
    const timer = setTimeout(() => {
      this._echoWritten.delete(key);
    }, windowMs);
    this._echoWritten.set(key, { value: JSON.stringify(value), timer });
  }

  private _isEcho(nodeId: string, property: string, value: ModelValue): boolean {
    const key = `${nodeId}:${property}`;
    const entry = this._echoWritten.get(key);
    if (entry === undefined) return false;
    return entry.value === JSON.stringify(value);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _resolveMappingPath(mapping: string): string {
    // If absolute, use as-is; otherwise resolve relative to cwd
    if (mapping.startsWith('/')) return mapping;
    return resolve(process.cwd(), mapping);
  }
}

// ---------------------------------------------------------------------------
// E10 — AdapterFactory for MqttIngressAdapter
// ---------------------------------------------------------------------------

export const MqttAdapterFactory: AdapterFactory = {
  protocol: 'mqtt',
  create(id: string): Adapter {
    return new MqttIngressAdapter(id);
  },
};
