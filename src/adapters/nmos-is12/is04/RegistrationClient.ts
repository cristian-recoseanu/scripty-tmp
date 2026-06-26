/**
 * E17.T5 — IS-04 Registration API client.
 *
 * Implements the Registration API workflow from AMWA IS-04 v1.3 §4:
 *
 *   1. Register node   POST /x-nmos/registration/v1.3/resource
 *   2. Register device POST /x-nmos/registration/v1.3/resource
 *   3. Heartbeat       POST /x-nmos/registration/v1.3/health/nodes/<nodeId>
 *      - On 404 → re-registers node + device.
 *      - On non-2xx → logged as error; next heartbeat retries.
 *   4. Deregister (stop):
 *      DELETE /x-nmos/registration/v1.3/resource/nodes/<nodeId>
 *      DELETE /x-nmos/registration/v1.3/resource/devices/<deviceId>
 *
 * Uses Node.js built-in `node:http` (no external dependencies).
 */

import http from 'node:http';

import type { Is04Node, Is04Device, Is04RegistrationBody } from './types.js';

// ---------------------------------------------------------------------------
// Logger interface (minimal — mirrors AdapterLogger)
// ---------------------------------------------------------------------------

export interface RegistrationLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  body: string;
}

function httpRequest(
  method: string,
  host: string,
  port: number,
  path: string,
  body?: string,
): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    const req = http.request({ method, host, port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
      });
    });

    req.once('error', (err) => reject(err));
    req.setTimeout(10_000, () => {
      req.destroy(new Error('Registration API request timed out'));
    });

    if (body !== undefined) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// RegistrationClientOptions
// ---------------------------------------------------------------------------

export interface RegistrationClientOptions {
  registryHost: string;
  registryPort: number;
  heartbeatIntervalSec: number;
  node: Is04Node;
  device: Is04Device;
  logger: RegistrationLogger;
}

// ---------------------------------------------------------------------------
// RegistrationClient
// ---------------------------------------------------------------------------

export class RegistrationClient {
  private readonly _opts: RegistrationClientOptions;
  private _heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private _registered = false;

  private static readonly _BASE = '/x-nmos/registration/v1.3';

  constructor(opts: RegistrationClientOptions) {
    this._opts = opts;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    await this._register();
    this._startHeartbeat();
  }

  async stop(): Promise<void> {
    this._stopHeartbeat();
    if (this._registered) {
      await this._deregister().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this._opts.logger.warn('IS-04 deregistration failed', { error: message });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  private async _register(): Promise<void> {
    const { registryHost, registryPort, node, device, logger } = this._opts;

    await this._postResource<Is04Node>('node', node);
    logger.info('IS-04 node registered', { nodeId: node.id, registryHost, registryPort });

    await this._postResource<Is04Device>('device', device);
    logger.info('IS-04 device registered', { deviceId: device.id });

    this._registered = true;
  }

  private async _postResource<T>(type: string, data: T): Promise<void> {
    const body: Is04RegistrationBody<T> = { type: type as never, data };
    const res = await httpRequest(
      'POST',
      this._opts.registryHost,
      this._opts.registryPort,
      `${RegistrationClient._BASE}/resource`,
      JSON.stringify(body),
    );

    if (res.status < 200 || res.status > 299) {
      throw new Error(
        `IS-04 registration POST failed: HTTP ${res.status} — ${res.body.slice(0, 256)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  private _startHeartbeat(): void {
    const intervalMs = this._opts.heartbeatIntervalSec * 1000;
    this._heartbeatTimer = setInterval(() => {
      this._heartbeat().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this._opts.logger.error('IS-04 heartbeat error', { error: message });
      });
    }, intervalMs);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer !== undefined) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }
  }

  private async _heartbeat(): Promise<void> {
    const { registryHost, registryPort, node, logger } = this._opts;
    const res = await httpRequest(
      'POST',
      registryHost,
      registryPort,
      `${RegistrationClient._BASE}/health/nodes/${node.id}`,
    );

    if (res.status === 404) {
      logger.warn('IS-04 heartbeat 404 — re-registering', { nodeId: node.id });
      this._registered = false;
      await this._register();
      return;
    }

    if (res.status < 200 || res.status > 299) {
      throw new Error(`IS-04 heartbeat non-2xx: HTTP ${res.status}`);
    }

    logger.info('IS-04 heartbeat ok', { nodeId: node.id });
  }

  // -------------------------------------------------------------------------
  // Deregistration
  // -------------------------------------------------------------------------

  private async _deregister(): Promise<void> {
    const { node, device, logger } = this._opts;

    await this._deleteResource('devices', device.id);
    logger.info('IS-04 device deregistered', { deviceId: device.id });

    await this._deleteResource('nodes', node.id);
    logger.info('IS-04 node deregistered', { nodeId: node.id });

    this._registered = false;
  }

  private async _deleteResource(type: string, id: string): Promise<void> {
    const res = await httpRequest(
      'DELETE',
      this._opts.registryHost,
      this._opts.registryPort,
      `${RegistrationClient._BASE}/resource/${type}/${id}`,
    );

    if (res.status !== 204 && res.status !== 404) {
      throw new Error(
        `IS-04 deregistration DELETE failed: HTTP ${res.status} — ${res.body.slice(0, 256)}`,
      );
    }
  }
}
