/**
 * E10.T7 — MQTT Ingress adapter config schema + zod types.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Subscription entry
// ---------------------------------------------------------------------------

export const MqttSubscriptionSchema = z.object({
  /** MQTT topic filter (may contain + and # wildcards). */
  topicFilter: z.string().min(1),
  /** QoS level 0, 1, or 2. Default 0. */
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
}).strict();

export type MqttSubscriptionConfig = z.infer<typeof MqttSubscriptionSchema>;

// ---------------------------------------------------------------------------
// TLS config
// ---------------------------------------------------------------------------

export const MqttTlsSchema = z.object({
  /** CA cert path (PEM). */
  ca: z.string().optional(),
  /** Client cert path (PEM). */
  cert: z.string().optional(),
  /** Client key path (PEM). */
  key: z.string().optional(),
  /** Reject unauthorized certs (default true). */
  rejectUnauthorized: z.boolean().default(true),
}).strict();

export type MqttTlsConfig = z.infer<typeof MqttTlsSchema>;

// ---------------------------------------------------------------------------
// LWT (Last Will and Testament)
// ---------------------------------------------------------------------------

export const MqttLwtSchema = z.object({
  topic: z.string().min(1),
  payload: z.string(),
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  retain: z.boolean().default(false),
}).strict();

export type MqttLwtConfig = z.infer<typeof MqttLwtSchema>;

// ---------------------------------------------------------------------------
// Debounce config (E10.T6)
// ---------------------------------------------------------------------------

export const MqttDebounceSchema = z.object({
  /** Debounce window in milliseconds. When set, bursts are coalesced (latest wins). */
  windowMs: z.number().int().positive(),
}).strict();

export type MqttDebounceConfig = z.infer<typeof MqttDebounceSchema>;

// ---------------------------------------------------------------------------
// E10.T7 — Full MQTT config schema
// ---------------------------------------------------------------------------

export const MqttAdapterConfigSchema = z.object({
  /** MQTT broker URL e.g. "mqtt://broker.local:1883" or "mqtts://...". */
  url: z.string().regex(
    /^(mqtt|mqtts|ws|wss):\/\/.+/,
    'Must be a valid MQTT broker URL (mqtt://, mqtts://, ws://, or wss://)',
  ),
  /** MQTT client id (auto-generated if omitted). */
  clientId: z.string().optional(),
  /** Auth username. */
  username: z.string().optional(),
  /** Auth password. */
  password: z.string().optional(),
  /** TLS options (required for mqtts://). */
  tls: MqttTlsSchema.optional(),
  /** Last Will and Testament. */
  lwt: MqttLwtSchema.optional(),
  /**
   * Reconnect backoff: initial delay in ms (default 1000), max delay in ms (default 30000).
   * MQTT.js reconnectPeriod controls the base; we cap via reconnect events.
   */
  reconnectPeriodMs: z.number().int().positive().default(1000),
  reconnectMaxMs: z.number().int().positive().default(30000),
  /** Topic subscriptions (at least one required). */
  subscriptions: z.array(MqttSubscriptionSchema).min(1),
  /** Optional debounce/throttle config. When absent, messages pass through immediately. */
  debounce: MqttDebounceSchema.optional(),
  /** Path (relative to bridge.yaml) to the ingress mapping JSON file. */
  mapping: z.string().min(1),
}).strict();

export type MqttAdapterConfig = z.infer<typeof MqttAdapterConfigSchema>;

// ---------------------------------------------------------------------------
// JSON Schema for configSchema() — mirrors the zod shape for AJV validation
// ---------------------------------------------------------------------------

export const MQTT_CONFIG_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['url', 'subscriptions', 'mapping'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', format: 'uri' },
    clientId: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    tls: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ca: { type: 'string' },
        cert: { type: 'string' },
        key: { type: 'string' },
        rejectUnauthorized: { type: 'boolean' },
      },
    },
    lwt: {
      type: 'object',
      required: ['topic', 'payload'],
      additionalProperties: false,
      properties: {
        topic: { type: 'string', minLength: 1 },
        payload: { type: 'string' },
        qos: { type: 'integer', enum: [0, 1, 2] },
        retain: { type: 'boolean' },
      },
    },
    reconnectPeriodMs: { type: 'integer', minimum: 1 },
    reconnectMaxMs: { type: 'integer', minimum: 1 },
    subscriptions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['topicFilter'],
        additionalProperties: false,
        properties: {
          topicFilter: { type: 'string', minLength: 1 },
          qos: { type: 'integer', enum: [0, 1, 2] },
        },
      },
    },
    debounce: {
      type: 'object',
      required: ['windowMs'],
      additionalProperties: false,
      properties: {
        windowMs: { type: 'integer', minimum: 1 },
      },
    },
    mapping: { type: 'string', minLength: 1 },
  },
};
