/**
 * E21.T4 — IS-12 Ingress adapter config schema.
 */

import { z } from 'zod';

import type { JSONSchema } from '../Adapter.js';

export const Is12IngressConfigSchema = z.object({
  /** WebSocket URL of the remote IS-12 device (NCP server). */
  wsUrl: z.string().url(),
  /** OID of the remote device root block for role-path resolution. Default: 1. */
  rootOid: z.number().int().positive().default(1),
  /** Resolved path to the ingress mapping YAML (class-projection shape). */
  mapping: z.string().min(1),
  /** Initial reconnect delay in ms. Default: 1000. */
  reconnectPeriodMs: z.number().int().positive().default(1000),
  /** Maximum reconnect delay in ms. Default: 30000. */
  reconnectMaxMs: z.number().int().positive().default(30_000),
}).strict();

export type Is12IngressConfig = z.infer<typeof Is12IngressConfigSchema>;

export const IS12_INGRESS_CONFIG_JSON_SCHEMA: JSONSchema = {
  type: 'object',
  required: ['wsUrl', 'mapping'],
  additionalProperties: false,
  properties: {
    wsUrl: { type: 'string', format: 'uri', description: 'Remote IS-12 device WebSocket URL' },
    rootOid: { type: 'integer', minimum: 1, default: 1, description: 'Remote device root OID for role-path resolution' },
    mapping: { type: 'string', minLength: 1, description: 'Path to ingress mapping YAML' },
    reconnectPeriodMs: { type: 'integer', minimum: 1, default: 1000 },
    reconnectMaxMs: { type: 'integer', minimum: 1, default: 30000 },
  },
};
