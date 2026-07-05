/**
 * E11.T12 — IS-12 Egress Adapter config schema.
 * E17.T1  — IS-04 Node API + Registration toggles added.
 *
 * Validates the adapter config at init() time. JSON Schema is also exposed
 * via configSchema() for external tooling.
 */

import { z } from 'zod';

import type { JSONSchema } from '../Adapter.js';

// ---------------------------------------------------------------------------
// IS-04 sub-schemas (E17.T1)
// ---------------------------------------------------------------------------

export const Is04NodeApiConfigSchema = z.object({
  /** Spin up a read-only IS-04 Node API HTTP server. Default: false. */
  enabled: z.boolean().default(false),
  /** TCP port for the IS-04 Node API HTTP server. Required when enabled. */
  httpPort: z.number().int().min(1).max(65535).optional(),
  /** Bind address for the IS-04 HTTP server. Default: '0.0.0.0'. */
  host: z.string().default('0.0.0.0'),
  /**
   * Advertised hostname/IP used in IS-04 node API href and NCP control href.
   * Set this to your machine's reachable address (e.g. 'localhost', '192.168.1.10').
   * When absent, falls back to host — which for '0.0.0.0' resolves to os.hostname().
   */
  advertiseHost: z.string().optional(),
}).strict();
export type Is04NodeApiConfig = z.infer<typeof Is04NodeApiConfigSchema>;

export const Is04RegistrationConfigSchema = z.object({
  /** Register this node/device in an NMOS Registration API. Default: false. */
  enabled: z.boolean().default(false),
  /** Hostname or IP of the NMOS Registration API. Required when enabled. */
  host: z.string().optional(),
  /** Port of the NMOS Registration API. Default: 80. */
  port: z.number().int().min(1).max(65535).default(80),
  /** Heartbeat interval in seconds. Default: 5. */
  heartbeatIntervalSec: z.number().int().min(1).default(5),
}).strict();
export type Is04RegistrationConfig = z.infer<typeof Is04RegistrationConfigSchema>;

export const Is04ConfigSchema = z.object({
  nodeApi: Is04NodeApiConfigSchema.default({ enabled: false, host: '0.0.0.0' }),
  registration: Is04RegistrationConfigSchema.default({
    enabled: false,
    port: 80,
    heartbeatIntervalSec: 5,
  }),
  /**
   * Stable UUID for this IS-04 node. Auto-generated and logged on first start
   * if omitted.
   */
  nodeId: z.string().uuid().optional(),
  /**
   * Stable UUID for the single IS-04 device this node advertises.
   * Auto-generated and logged on first start if omitted.
   */
  deviceId: z.string().uuid().optional(),
  /**
   * Optional: advertise stub sender/receiver resources on this bridge's Node API.
   * Omit when touchpoints reference sender/receiver resources on an external IS-04 node.
   */
  receiverId: z.string().uuid().optional(),
  /**
   * Optional: advertise stub sender/receiver resources on this bridge's Node API.
   * Omit when touchpoints reference sender/receiver resources on an external IS-04 node.
   */
  senderId: z.string().uuid().optional(),
  /**
   * Stable UUID for the IS-04 flow referenced by the sender resource (optional).
   */
  flowId: z.string().uuid().optional(),
  /** Human-readable label advertised in the IS-04 node resource. */
  label: z.string().optional(),
  /** Human-readable description advertised in the IS-04 node resource. */
  description: z.string().optional(),
}).strict();
export type Is04Config = z.infer<typeof Is04ConfigSchema>;

// ---------------------------------------------------------------------------
// Zod schema (main)
// ---------------------------------------------------------------------------

export const Is12AdapterConfigSchema = z.object({
  /** WebSocket server port. 0 = OS-assigned (useful for testing). */
  wsPort: z.number().int().min(0).max(65535),
  /**
   * Resolved path to the egress mapping JSON file.
   * Passed by app.ts via resolveConfigPaths(); also set directly in tests.
   */
  mapping: z.string().optional(),
  /**
   * Hostname or IP address the WebSocket server binds to.
   * Default: '0.0.0.0' (all interfaces).
   */
  host: z.string().default('0.0.0.0'),
  /**
   * URI path the WebSocket server listens on.
   * Clients must connect to ws://<host>:<port><wsPath>.
   * Default: '/' (root — original behaviour).
   */
  wsPath: z.string().default('/'),
  /**
   * External/advertised port (e.g. when behind a NAT).
   * Used as the WS port in IS-04 control href. Defaults to wsPort.
   */
  outsidePort: z.number().int().min(1).max(65535).optional(),
  /**
   * IS-04 Node API + Registration configuration (E17).
   * Absent / disabled by default — existing embedded behaviour unchanged.
   */
  is04: Is04ConfigSchema.default({
    nodeApi: { enabled: false, host: '0.0.0.0' },
    registration: { enabled: false, port: 80, heartbeatIntervalSec: 5 },
  }),
  /**
   * @deprecated Use `is04.label` instead. Kept for back-compat.
   */
  instanceName: z.string().optional(),
}).strict().superRefine((val, ctx) => {
  const reg = val.is04.registration;
  if (reg.enabled) {
    if (!val.is04.nodeApi.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is04', 'registration', 'enabled'],
        message: 'is04.registration.enabled requires is04.nodeApi.enabled to be true',
      });
    }
    if (reg.host === undefined || reg.host.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is04', 'registration', 'host'],
        message: 'is04.registration.host is required when is04.registration.enabled is true',
      });
    }
    if (val.is04.nodeApi.httpPort === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is04', 'nodeApi', 'httpPort'],
        message: 'is04.nodeApi.httpPort is required when is04.nodeApi.enabled is true',
      });
    }
  }
  if (val.is04.nodeApi.enabled && val.is04.nodeApi.httpPort === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['is04', 'nodeApi', 'httpPort'],
      message: 'is04.nodeApi.httpPort is required when is04.nodeApi.enabled is true',
    });
  }
});
export type Is12AdapterConfig = z.infer<typeof Is12AdapterConfigSchema>;

// ---------------------------------------------------------------------------
// JSON Schema (for configSchema())
// ---------------------------------------------------------------------------

export const IS12_CONFIG_JSON_SCHEMA: JSONSchema = {
  type: 'object',
  required: ['wsPort'],
  properties: {
    wsPort: { type: 'integer', minimum: 0, maximum: 65535, description: 'WebSocket server port (0 = OS-assigned)' },
    host: { type: 'string', default: '0.0.0.0', description: 'Bind address for WS server' },
    wsPath: { type: 'string', default: '/', description: 'URI path for the WebSocket endpoint (e.g. /x-nmos/ncp/v1.0)' },
    outsidePort: { type: 'integer', minimum: 1, maximum: 65535, description: 'Advertised external WS port (used in IS-04 control href)' },
    is04: {
      type: 'object',
      description: 'IS-04 Node API and Registration configuration (E17)',
      properties: {
        nodeApi: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', default: false, description: 'Serve an IS-04 Node API HTTP server' },
            httpPort: { type: 'integer', minimum: 1, maximum: 65535, description: 'IS-04 Node API HTTP port (required when enabled)' },
            host: { type: 'string', default: '0.0.0.0', description: 'Bind address for IS-04 HTTP server' },
          },
          additionalProperties: false,
        },
        registration: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', default: false, description: 'Register in an NMOS Registration API' },
            host: { type: 'string', description: 'Registration API hostname (required when enabled)' },
            port: { type: 'integer', minimum: 1, maximum: 65535, default: 80, description: 'Registration API port' },
            heartbeatIntervalSec: { type: 'integer', minimum: 1, default: 5, description: 'Heartbeat interval (seconds)' },
          },
          additionalProperties: false,
        },
        nodeId: { type: 'string', format: 'uuid', description: 'Stable IS-04 node UUID (auto-generated if absent)' },
        deviceId: { type: 'string', format: 'uuid', description: 'Stable IS-04 device UUID (auto-generated if absent)' },
        label: { type: 'string', description: 'IS-04 node label' },
        description: { type: 'string', description: 'IS-04 node description' },
      },
      additionalProperties: false,
    },
    mapping: { type: 'string', description: 'Resolved path to the egress mapping JSON file' },
    instanceName: { type: 'string', description: '@deprecated — use is04.label' },
  },
  additionalProperties: false,
};
