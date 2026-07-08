/**
 * E21.T7 — MQTT Egress adapter config schema.
 */

import { z } from 'zod';

import {
  MqttDebounceSchema,
  MqttLwtSchema,
  MqttSubscriptionSchema,
  MqttTlsSchema,
} from './config.js';

import type { JSONSchema } from '../Adapter.js';

export const MqttPublishDefaultsSchema = z.object({
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  retain: z.boolean().default(false),
}).strict();

export const MqttEgressAdapterConfigSchema = z.object({
  url: z.string().regex(
    /^(mqtt|mqtts|ws|wss):\/\/.+/,
    'Must be a valid MQTT broker URL (mqtt://, mqtts://, ws://, or wss://)',
  ),
  clientId: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  tls: MqttTlsSchema.optional(),
  lwt: MqttLwtSchema.optional(),
  reconnectPeriodMs: z.number().int().positive().default(1000),
  reconnectMaxMs: z.number().int().positive().default(30_000),
  /** Inbound set-topics (optional — enables MQTT→UCE writes). */
  subscriptions: z.array(MqttSubscriptionSchema).default([]),
  /** Default QoS/retain for outbound state publishes. */
  publish: MqttPublishDefaultsSchema.default({ qos: 0, retain: false }),
  debounce: MqttDebounceSchema.optional(),
  mapping: z.string().min(1),
}).strict();

export type MqttEgressAdapterConfig = z.infer<typeof MqttEgressAdapterConfigSchema>;

export const MQTT_EGRESS_CONFIG_JSON_SCHEMA: JSONSchema = {
  type: 'object',
  required: ['url', 'mapping'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', format: 'uri' },
    clientId: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
    tls: { type: 'object' },
    lwt: { type: 'object' },
    reconnectPeriodMs: { type: 'integer', minimum: 1 },
    reconnectMaxMs: { type: 'integer', minimum: 1 },
    subscriptions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['topicFilter'],
        properties: {
          topicFilter: { type: 'string' },
          qos: { type: 'integer', enum: [0, 1, 2] },
        },
      },
    },
    publish: {
      type: 'object',
      properties: {
        qos: { type: 'integer', enum: [0, 1, 2] },
        retain: { type: 'boolean' },
      },
    },
    debounce: { type: 'object' },
    mapping: { type: 'string', minLength: 1 },
  },
};
