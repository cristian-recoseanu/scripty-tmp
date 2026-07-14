/**
 * E8.T1 — Ingress + Egress mapping DSL types (zod schemas + derived TS types).
 * E8.T5 — Egress DSL types.
 * E8.T6 — Reverse mapping types.
 *
 * No protocol-specific identifiers in the core types — adapters add their own
 * protocol-level fields in `match` and `config` blocks.
 */

import { z } from 'zod';

import type { BaseType } from '../engine/types/Datatype.js';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const BaseTypeSchema = z.enum(['string', 'bool', 'numeric', 'object']);

export const ON_UNRESOLVED = ['drop', 'warn', 'error'] as const;
export type OnUnresolved = (typeof ON_UNRESOLVED)[number];

// ---------------------------------------------------------------------------
// E8.T1 — Decode descriptor
// ---------------------------------------------------------------------------

export const DecodeSchema = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('json'),
    /** RFC-6901 JSON Pointer into the parsed payload. */
    pointer: z.string().optional(),
    as: BaseTypeSchema,
  }).strict(),
  z.object({
    format: z.literal('raw-number'),
  }).strict(),
  z.object({
    format: z.literal('raw-string'),
  }).strict(),
  z.object({
    format: z.literal('custom'),
    /** Module path to a function `(payload: Buffer) => ModelValue`. */
    handler: z.string().min(1),
  }).strict(),
]);

export type DecodeDescriptor = z.infer<typeof DecodeSchema>;

// ---------------------------------------------------------------------------
// E8.T4 — Transform descriptors
// ---------------------------------------------------------------------------

export const TransformSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('round'), decimals: z.number().int().nonnegative() }).strict(),
  z.object({ op: z.literal('scale'), factor: z.number() }).strict(),
  z.object({
    op: z.literal('enum-map'),
    map: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  }).strict(),
  z.object({
    op: z.literal('template'),
    /** Handlebars-like template using `{$value}` and capture vars. */
    template: z.string().min(1),
  }).strict(),
  z.object({
    op: z.literal('clamp'),
    min: z.number(),
    max: z.number(),
  }).strict(),
]);

export type TransformDescriptor = z.infer<typeof TransformSchema>;

// ---------------------------------------------------------------------------
// E8.T6 — Reverse (write-back) descriptor
// ---------------------------------------------------------------------------

export const ReverseSchema = z.object({
  /** Template string with `{captureVar}` and `{$value}` placeholders. */
  topicTemplate: z.string().min(1),
  /**
   * Topic strategy for write-back and echo suppression:
   * - 'single' (default): a single state topic — write-back republishes to topicTemplate;
   *   echoes recognised by matching value + recent write-back window.
   * - 'command': split command/state topics — write-back publishes to commandTopicTemplate
   *   (topicTemplate is the state topic used only for ingress reads); echoes cannot arrive
   *   on the state topic from our own write-back, so no echo suppression needed.
   */
  writeStrategy: z.enum(['single', 'command']).default('single'),
  /** Required when writeStrategy='command': the topic to publish write-back to. */
  commandTopicTemplate: z.string().min(1).optional(),
  encode: z.object({
    format: z.enum(['json', 'raw-string', 'raw-number']),
    /** For json: an object template where leaf string values may contain `{$value}`. */
    template: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
}).strict();

export type ReverseDescriptor = z.infer<typeof ReverseSchema>;

// ---------------------------------------------------------------------------
// E8.T1 — Ingress rule
// ---------------------------------------------------------------------------

export const IngressRuleSchema = z.object({
  /**
   * Protocol-specific match descriptor (e.g. `{ topicFilter: "..." }` for MQTT).
   * Kept as open record — the adapter validates its own match shape.
   */
  match: z.record(z.string(), z.unknown()),
  target: z.object({
    /**
     * Location path template with `{captureVar}` placeholders.
     * e.g. "root/sensors/{sensorId}"
     */
    location: z.string().min(1),
    /** Property id on the resolved node. */
    property: z.string().min(1),
    onUnresolved: z.enum(['drop', 'warn', 'error']).default('warn'),
  }).strict(),
  decode: DecodeSchema,
  transform: z.array(TransformSchema).default([]),
  reverse: ReverseSchema.optional(),
}).strict();

export type IngressRule = z.infer<typeof IngressRuleSchema>;

// ---------------------------------------------------------------------------
// E8.T1 — Ingress mapping file
// ---------------------------------------------------------------------------

export const IngressMappingSchema = z.object({
  version: z.literal(1),
  rules: z.array(IngressRuleSchema).min(1),
}).strict();

export type IngressMapping = z.infer<typeof IngressMappingSchema>;

// ---------------------------------------------------------------------------
// E8.T5 — Egress property mapping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// E8.T5 — Egress touchpoint types (NcTouchpointNmos per MS-05-02)
// ---------------------------------------------------------------------------

/** Identifies an NMOS resource associated with a receiver/sender monitor. */
export const NcTouchpointNmosResourceSchema = z.object({
  /** IS-04 resource type — MUST be "receiver" for NcReceiverMonitor. */
  resourceType: z.string().min(1),
  /** IS-04 resource UUID. */
  id: z.string().min(1),
}).strict();

/** A single NcTouchpointNmos entry — BCP-008-01 §Touchpoints and IS-04 receivers. */
export const NcTouchpointSchema = z.object({
  /** MUST be "x-nmos" for all NMOS touchpoints. */
  contextNamespace: z.string().min(1),
  resource: NcTouchpointNmosResourceSchema,
}).strict();

export type NcTouchpoint = z.infer<typeof NcTouchpointSchema>;

// ---------------------------------------------------------------------------
// E8.T5 — Egress per-instance config
// ---------------------------------------------------------------------------

/**
 * Static configuration for a specific tree node instance in the egress model.
 * Identified by the node's tree location path (e.g. "root/receiver-monitors/rx-monitor-01").
 */
export const EgressInstanceMappingSchema = z.object({
  /** Full tree path of the node (slash-separated location chain). */
  location: z.string().min(1),
  /**
   * Remote IS-12 role path for this UCE location (ingress client role).
   * Slash-separated roles relative to root, e.g. `receivers` or `stereo-gain/channel-gain`.
   * Resolved to a runtime oid via FindMembersByPath at connect.
   */
  rolePath: z.string().min(1).optional(),
  /**
   * Static NcTouchpoints exposed on 1p7 for this node.
   * For NcReceiverMonitor nodes: MUST contain exactly one NcTouchpointNmos with
   * resourceType "receiver" and the associated IS-04 receiver UUID.
   */
  touchpoints: z.array(NcTouchpointSchema).optional(),
}).strict();

export type EgressInstanceMapping = z.infer<typeof EgressInstanceMappingSchema>;

// ---------------------------------------------------------------------------
// E8.T5 — Egress property mapping
// ---------------------------------------------------------------------------

export const EgressPropertyMappingSchema = z.object({
  /** UCE property id (matches PropertyDef.id). */
  id: z.string().min(1),
  /** Target (protocol-specific) property identifier — kept as unknown for generality. */
  targetId: z.unknown(),
  /** Optional concrete numeric datatype name (e.g. "NcFloat64"). */
  datatype: z.string().optional(),
  readOnly: z.boolean().optional(),
}).strict();

export type EgressPropertyMapping = z.infer<typeof EgressPropertyMappingSchema>;

export const EgressMethodMappingSchema = z.object({
  /** UCE method id. */
  id: z.string().min(1),
  /** Target (protocol-specific) method identifier. */
  targetId: z.unknown(),
}).strict();

export type EgressMethodMapping = z.infer<typeof EgressMethodMappingSchema>;

export const EgressClassMappingSchema = z.object({
  /** Names a UCE EntityDefinition (entity_name). */
  entityDef: z.string().min(1),
  /** Protocol-specific class identifier (opaque to core). */
  classId: z.unknown(),
  inheritsFrom: z.string().optional(),
  properties: z.array(EgressPropertyMappingSchema).default([]),
  methods: z.array(EgressMethodMappingSchema).default([]),
}).strict();

export type EgressClassMapping = z.infer<typeof EgressClassMappingSchema>;

// ---------------------------------------------------------------------------
// E8.T5 — Egress mapping file
// ---------------------------------------------------------------------------

export const EgressMappingSchema = z.object({
  version: z.literal(1),
  classes: z.array(EgressClassMappingSchema).min(1),
  /**
   * Per-instance static configuration (e.g. touchpoints for NcReceiverMonitor).
   * Each entry is identified by the node's full tree location path.
   */
  instances: z.array(EgressInstanceMappingSchema).optional(),
  subscriptions: z.object({
    autoSubscribeObservable: z.boolean().default(true),
  }).strict().optional(),
}).strict();

export type EgressMapping = z.infer<typeof EgressMappingSchema>;

// ---------------------------------------------------------------------------
// Wildcard capture helpers (E8.T1)
// ---------------------------------------------------------------------------

/**
 * Parse a topic-filter pattern like "sensors/+sensorId/temperature" into:
 * - `pattern`: a RegExp matching concrete topics
 * - `names`: ordered list of capture variable names
 *
 * MQTT `+name` wildcard → named capture group `(?<name>[^/]+)`.
 * MQTT `#` multi-level wildcard → `(?:.*)` at end (unnamed).
 */
export interface ParsedTopicFilter {
  pattern: RegExp;
  names: string[];
}

export function parseTopicFilter(topicFilter: string): ParsedTopicFilter {
  const names: string[] = [];
  const escaped = topicFilter
    .split('/')
    .map((seg) => {
      // +name wildcard
      const namedMatch = /^\+([A-Za-z_][A-Za-z0-9_]*)$/.exec(seg);
      if (namedMatch !== null) {
        const name = namedMatch[1];
        if (name !== undefined) {
          names.push(name);
          return `(?<${name}>[^/]+)`;
        }
      }
      // bare + wildcard (unnamed)
      if (seg === '+') return '[^/]+';
      // # multi-level wildcard (must be last segment)
      if (seg === '#') return '(?:.*)';
      // literal — escape regex metacharacters
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\/');
  return { pattern: new RegExp(`^${escaped}$`), names };
}

/**
 * Extract capture variables from a concrete topic using a parsed filter.
 * Returns `null` if the topic does not match.
 */
export function extractCaptures(
  topic: string,
  parsed: ParsedTopicFilter,
): Record<string, string> | null {
  const m = parsed.pattern.exec(topic);
  if (m === null) return null;
  const groups = m.groups ?? {};
  const captures: Record<string, string> = {};
  for (const name of parsed.names) {
    captures[name] = groups[name] ?? '';
  }
  return captures;
}

/**
 * Interpolate a location template like "root/sensors/{sensorId}" with captured vars.
 */
export function interpolateLocation(template: string, captures: Record<string, string>): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    return captures[name] ?? `{${name}}`;
  });
}

// Re-export BaseType for convenience
export type { BaseType };
