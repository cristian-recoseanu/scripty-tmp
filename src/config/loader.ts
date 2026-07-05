/**
 * E7.T1 — YAML loader with env interpolation.
 * E7.T2+T5 — Master config validation via zod; returns fully-typed ParsedBridgeConfig.
 *
 * Rules:
 *  - ${VAR_NAME} placeholders are replaced with process.env values.
 *  - Missing required env var → ConfigError naming the var.
 *  - File refs (relative paths in model.*) are resolved relative to the config dir.
 *  - No `any` leaks beyond this module.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';

import { BridgeConfigSchema } from './types.js';

import type { ParsedBridgeConfig } from './types.js';

// ---------------------------------------------------------------------------
// ConfigError
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConfigError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// E7.T1 — Env interpolation
// ---------------------------------------------------------------------------

// Matches ${VAR} or ${VAR:-default} (bash-style default).
const PLACEHOLDER_RE = /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g;

/**
 * Walk any JSON-like value and replace all `${VAR}` or `${VAR:-default}`
 * placeholders in string leaves with the corresponding environment variable.
 * Throws ConfigError only for required variables (no default) that are absent.
 */
export function interpolateEnv(value: unknown, env: Record<string, string | undefined> = process.env): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_RE, (_, name: string, fallback: string | undefined) => {
      const resolved = env[name];
      if (resolved !== undefined) return resolved;
      if (fallback !== undefined) return fallback;
      throw new ConfigError(`Missing required environment variable: ${name}`);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateEnv(v, env);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// E7.T1+T2+T5 — loadBridgeConfig: YAML → interpolate → zod → typed
// ---------------------------------------------------------------------------

/**
 * Load and fully validate `bridge.yaml` from the given path.
 *
 * @param configPath — absolute or cwd-relative path to `bridge.yaml`.
 * @param env — environment variable map (defaults to `process.env`).
 * @returns Fully typed and validated {@link ParsedBridgeConfig}.
 */
export function loadBridgeConfig(
  configPath: string,
  env: Record<string, string | undefined> = process.env,
): ParsedBridgeConfig {
  let raw: unknown;
  try {
    const text = readFileSync(configPath, 'utf8');
    raw = parseYaml(text) as unknown;
  } catch (err) {
    throw new ConfigError(`Failed to read config file '${configPath}': ${String(err)}`, err);
  }

  // E7.T1 — env interpolation
  const interpolated = interpolateEnv(raw, env);

  // E7.T2+T5 — zod validation (typed, strict)
  try {
    return BridgeConfigSchema.parse(interpolated);
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues.map((i) => `  ${i.path.join('.')} — ${i.message}`).join('\n');
      throw new ConfigError(`Bridge config zod validation failed:\n${messages}`, err);
    }
    throw new ConfigError(`Bridge config parse error: ${String(err)}`, err);
  }
}

// ---------------------------------------------------------------------------
// Utility — resolve a path relative to a config file's directory
// ---------------------------------------------------------------------------

export function resolveFromConfig(configPath: string, relativePath: string): string {
  return resolve(dirname(configPath), relativePath);
}
