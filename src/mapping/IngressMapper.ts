/**
 * E8.T2 — IngressMapper runtime (static resolution only).
 * E8.T6 — Reverse (write-back) mapping.
 *
 * Resolves an ingress message against a pre-defined model tree, decodes the
 * payload, applies transforms, and produces a SetPropertyOp for the engine bus.
 * Reverse mapping produces a rendered topic + payload for write-back.
 */

import type { ModelValue } from '../engine/model/ObjectNode.js';
import type { InstanceTree } from '../engine/model/ObjectTree.js';

import { decode } from './decoders.js';
import { applyTransforms } from './transforms.js';
import type { IngressMapping, IngressRule, ReverseDescriptor } from './types.js';
import {
  extractCaptures,
  interpolateLocation,
  parseTopicFilter,
} from './types.js';

// ---------------------------------------------------------------------------
// Logger interface (injected; avoids no-console lint)
// ---------------------------------------------------------------------------

export interface MapperLogger {
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface MapResult {
  ok: true;
  nodeId: string;
  property: string;
  value: ModelValue;
  captures: Record<string, string>;
}

export type MapOutcome =
  | MapResult
  | { ok: false; dropped: true; reason: string }
  | { ok: false; dropped: false; reason: string };

// ---------------------------------------------------------------------------
// Reverse result
// ---------------------------------------------------------------------------

export interface ReverseResult {
  ok: true;
  topic: string;
  payload: string;
}

export interface ReverseError {
  ok: false;
  reason: string;
}

// ---------------------------------------------------------------------------
// E8.T2 — IngressMapper
// ---------------------------------------------------------------------------

export class IngressMapper {
  private readonly _rules: IngressRule[];
  private readonly _tree: InstanceTree;
  private readonly _logger: MapperLogger;

  constructor(mapping: IngressMapping, tree: InstanceTree, logger: MapperLogger) {
    this._rules = mapping.rules;
    this._tree = tree;
    this._logger = logger;
  }

  // -------------------------------------------------------------------------
  // E8.T2 — map(): match topic → resolve node → decode → transform → MapOutcome
  // -------------------------------------------------------------------------

  /**
   * Process an incoming message. Finds the first rule whose topic filter matches,
   * resolves the target node (static resolution only), decodes and transforms the
   * payload, and returns a MapResult.
   *
   * @param topic — the concrete topic/channel from the ingress adapter.
   * @param payload — raw payload bytes or string.
   */
  map(topic: string, payload: Buffer | string): MapOutcome {
    for (const rule of this._rules) {
      const topicFilter = rule.match['topicFilter'];
      if (typeof topicFilter !== 'string') continue;

      const parsed = parseTopicFilter(topicFilter);
      const captures = extractCaptures(topic, parsed);
      if (captures === null) continue;

      return this._applyRule(rule, captures, payload);
    }
    return { ok: false, dropped: true, reason: `No rule matched topic '${topic}'` };
  }

  // -------------------------------------------------------------------------
  // E8.T6 — reverse(): produce write-back topic + payload from a value + captures
  // -------------------------------------------------------------------------

  /**
   * Produce a write-back topic + encoded payload for a rule's reverse descriptor.
   *
   * @param ruleIndex — index of the rule in the mapping (0-based).
   * @param captures  — the captured wildcard variables for this topic.
   * @param value     — the value to encode (e.g. the new property value).
   */
  reverse(
    ruleIndex: number,
    captures: Record<string, string>,
    value: ModelValue,
  ): ReverseResult | ReverseError {
    const rule = this._rules[ruleIndex];
    if (rule === undefined) {
      return { ok: false, reason: `Rule index ${ruleIndex} does not exist` };
    }
    if (rule.reverse === undefined) {
      return { ok: false, reason: `Rule ${ruleIndex} has no reverse descriptor` };
    }
    return renderReverse(rule.reverse, captures, value);
  }

  /**
   * E13.T2 — Find the rule index and captures for a given UCE nodeId + property.
   * Used by the write-back path to match an engine op back to a mapping rule.
   *
   * Because captures were consumed at ingress time and may not be available
   * at write-back time, this derives them by reverse-matching the resolved
   * location template against the rule's target.location pattern.
   *
   * Returns undefined if no rule maps to this nodeId + property.
   */
  findRuleForTarget(
    nodeId: string,
    property: string,
  ): { ruleIndex: number; captures: Record<string, string> } | undefined {
    for (let i = 0; i < this._rules.length; i++) {
      const rule = this._rules[i];
      if (rule === undefined) continue;
      if (rule.target.property !== property) continue;
      if (rule.reverse === undefined) continue;

      // Derive captures by reverse-matching nodeId against the location template
      const captures = extractCapturesFromLocation(rule.target.location, nodeId);
      if (captures !== null) {
        return { ruleIndex: i, captures };
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _applyRule(
    rule: IngressRule,
    captures: Record<string, string>,
    payload: Buffer | string,
  ): MapOutcome {
    // Resolve location template to a node path
    const resolvedPath = interpolateLocation(rule.target.location, captures);

    // E8.T2 — static node resolution (never create a node)
    const lookup = this._tree.findById(resolvedPath);
    if (!lookup.ok) {
      return this._handleUnresolved(
        rule,
        `Node '${resolvedPath}' does not exist in the tree`,
      );
    }

    const node = lookup.node;

    // Validate property exists on the node
    if (!node.properties.has(rule.target.property)) {
      return this._handleUnresolved(
        rule,
        `Property '${rule.target.property}' not found on node '${resolvedPath}'`,
      );
    }

    // E8.T3 — decode
    const decodeResult = decode(payload, rule.decode);
    if (!decodeResult.ok) {
      return { ok: false, dropped: true, reason: `Decode failed: ${decodeResult.reason}` };
    }

    // E8.T4 — transform pipeline
    const transformResult = applyTransforms(decodeResult.value, rule.transform);
    if (!transformResult.ok) {
      return {
        ok: false,
        dropped: true,
        reason: `Transform failed: ${transformResult.reason}`,
      };
    }

    return {
      ok: true,
      nodeId: resolvedPath,
      property: rule.target.property,
      value: transformResult.value,
      captures,
    };
  }

  private _handleUnresolved(
    rule: IngressRule,
    reason: string,
  ): MapOutcome {
    const policy = rule.target.onUnresolved;
    if (policy === 'warn') {
      this._logger.warn(`IngressMapper: ${reason}`);
      return { ok: false, dropped: true, reason };
    }
    if (policy === 'error') {
      this._logger.error(`IngressMapper: ${reason}`);
      return { ok: false, dropped: false, reason };
    }
    // drop — silent
    return { ok: false, dropped: true, reason };
  }
}

// ---------------------------------------------------------------------------
// E13.T2 — extractCapturesFromLocation
// ---------------------------------------------------------------------------

/**
 * Given a location template like "root/sensors/{sensorId}" and a concrete
 * resolved nodeId like "root/sensors/temp-1", extract the capture variables.
 * Returns null if the nodeId does not match the template pattern.
 */
export function extractCapturesFromLocation(
  locationTemplate: string,
  nodeId: string,
): Record<string, string> | null {
  const names: string[] = [];
  const escaped = locationTemplate
    .split('/')
    .map((seg) => {
      const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(seg);
      if (m !== null && m[1] !== undefined) {
        names.push(m[1]);
        return `(?<${m[1]}>[^/]+)`;
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const pattern = new RegExp(`^${escaped}$`);
  const match = pattern.exec(nodeId);
  if (match === null) return null;
  const groups = match.groups ?? {};
  const captures: Record<string, string> = {};
  for (const name of names) {
    captures[name] = groups[name] ?? '';
  }
  return captures;
}

// ---------------------------------------------------------------------------
// E8.T6 — renderReverse (also exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * Render a reverse descriptor to a concrete topic + JSON payload.
 */
export function renderReverse(
  desc: ReverseDescriptor,
  captures: Record<string, string>,
  value: ModelValue,
): ReverseResult | ReverseError {
  // E13.T4 — pick the target topic based on write strategy
  const targetTemplate =
    desc.writeStrategy === 'command' && desc.commandTopicTemplate !== undefined
      ? desc.commandTopicTemplate
      : desc.topicTemplate;

  // Render topic template
  const topic = targetTemplate.replace(
    /\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => {
      if (name === '$value') return typeof value === 'object' ? JSON.stringify(value) : String(value);
      return captures[name] ?? `{${name}}`;
    },
  );

  // Render payload
  const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
  switch (desc.encode.format) {
    case 'raw-string':
      return { ok: true, topic, payload: typeof value === 'object' ? JSON.stringify(value) : String(value) };

    case 'raw-number':
      return { ok: true, topic, payload: typeof value === 'object' ? JSON.stringify(value) : String(value) };

    case 'json': {
      if (desc.encode.template !== undefined) {
        const rendered = renderJsonTemplate(desc.encode.template, captures, valueStr);
        return { ok: true, topic, payload: JSON.stringify(rendered) };
      }
      return { ok: true, topic, payload: JSON.stringify(value) };
    }
  }
}

function renderJsonTemplate(
  template: unknown,
  captures: Record<string, string>,
  valueStr: string,
): unknown {
  if (typeof template === 'string') {
    return template
      .replace(/\{\$value\}/g, valueStr)
      .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match: string, n: string) => captures[n] ?? `{${n}}`);
  }
  if (Array.isArray(template)) {
    return template.map((item: unknown) => renderJsonTemplate(item, captures, valueStr));
  }
  if (typeof template === 'object' && template !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = renderJsonTemplate(v, captures, valueStr);
    }
    return out;
  }
  return template;
}
