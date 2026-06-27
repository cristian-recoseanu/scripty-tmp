/**
 * E12.T1 — Structured logger.
 *
 * Wraps pino to produce JSON-structured logs. Provides:
 *   - Configurable log level.
 *   - Secret redaction: strips password/token/key/secret fields from
 *     any object passed to pino's structured bindings.
 *   - `forAdapter(id)` — returns an AdapterLogger bound to the adapter id.
 */

import pino from 'pino';

import type { AdapterLogger } from '../adapters/Adapter.js';
import type { Logger as PinoLogger } from 'pino';


// ---------------------------------------------------------------------------
// Level type
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

// ---------------------------------------------------------------------------
// Redaction paths — strip sensitive fields at any depth
// ---------------------------------------------------------------------------

const REDACTED_PATHS: string[] = [
  'password',
  'passwd',
  'token',
  'accessToken',
  'access_token',
  'secret',
  'apiKey',
  'api_key',
  'key',
  'authorization',
  'Authorization',
  '*.password',
  '*.passwd',
  '*.token',
  '*.accessToken',
  '*.access_token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.key',
  '*.authorization',
  '*.Authorization',
];

// ---------------------------------------------------------------------------
// BridgeLoggerOptions
// ---------------------------------------------------------------------------

export interface BridgeLoggerOptions {
  /**
   * Minimum log level to emit. Defaults to 'info'.
   */
  level?: LogLevel;
  /**
   * Override the pino destination stream (useful in tests to capture output).
   * Defaults to pino's standard stdout.
   */
  destination?: pino.DestinationStream;
  /**
   * Disable redaction (useful in dev/debug only — never in production).
   * Defaults to false (redaction ON).
   */
  disableRedaction?: boolean;
}

// ---------------------------------------------------------------------------
// BridgeLogger
// ---------------------------------------------------------------------------

export class BridgeLogger {
  private readonly _pino: PinoLogger;

  constructor(options: BridgeLoggerOptions = {}) {
    const level: LogLevel = options.level ?? 'info';

    const pinoOpts: pino.LoggerOptions = {
      level,
      ...((options.disableRedaction !== true)
        ? { redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } }
        : {}),
    };

    this._pino = options.destination !== undefined
      ? pino(pinoOpts, options.destination)
      : pino(pinoOpts);
  }

  // ---------------------------------------------------------------------------
  // Direct log methods (structured bindings optional)
  // ---------------------------------------------------------------------------

  trace(msg: string, bindings?: Record<string, unknown>): void {
    if (bindings !== undefined) this._pino.trace(bindings, msg);
    else this._pino.trace(msg);
  }

  debug(msg: string, bindings?: Record<string, unknown>): void {
    if (bindings !== undefined) this._pino.debug(bindings, msg);
    else this._pino.debug(msg);
  }

  info(msg: string, bindings?: Record<string, unknown>): void {
    if (bindings !== undefined) this._pino.info(bindings, msg);
    else this._pino.info(msg);
  }

  warn(msg: string, bindings?: Record<string, unknown>): void {
    if (bindings !== undefined) this._pino.warn(bindings, msg);
    else this._pino.warn(msg);
  }

  error(msg: string, bindings?: Record<string, unknown>): void {
    if (bindings !== undefined) this._pino.error(bindings, msg);
    else this._pino.error(msg);
  }

  fatal(msg: string, bindings?: Record<string, unknown>): void {
    if (bindings !== undefined) this._pino.fatal(bindings, msg);
    else this._pino.fatal(msg);
  }

  // ---------------------------------------------------------------------------
  // forAdapter — returns an AdapterLogger scoped to an adapter instance
  // ---------------------------------------------------------------------------

  forAdapter(adapterId: string): AdapterLogger {
    const child = this._pino.child({ adapterId });
    return {
      info:  (message: string) => child.info(message),
      warn:  (message: string) => child.warn(message),
      error: (message: string) => child.error(message),
      debug: (message: string) => child.debug(message),
    };
  }

  // ---------------------------------------------------------------------------
  // Accessor — underlying pino instance (for advanced use / testing)
  // ---------------------------------------------------------------------------

  get level(): LogLevel {
    return this._pino.level as LogLevel;
  }

  setLevel(level: LogLevel): void {
    this._pino.level = level;
  }
}
