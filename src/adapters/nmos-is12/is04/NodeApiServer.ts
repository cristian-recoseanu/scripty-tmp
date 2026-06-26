/**
 * E17.T4 / E19.T3 — IS-04 Node API HTTP server (read-only).
 *
 * Serves read-only IS-04 v1.3 Node API endpoints including optional sender/receiver
 * resources for monitor touchpoint resolution.
 */

import http from 'node:http';

import type { Is04Node, Is04Device, Is04Sender, Is04Receiver } from './types.js';

// ---------------------------------------------------------------------------
// Static payloads
// ---------------------------------------------------------------------------

const XNMOS_ROOT = ['node/'];
const API_ROOT = ['v1.3/'];
const RESOURCE_LIST = ['self', 'sources/', 'flows/', 'devices/', 'senders/', 'receivers/'];
const EMPTY_COLLECTIONS = new Set(['sources', 'flows']);

export interface NodeApiMediaResources {
  readonly senders?: readonly Is04Sender[];
  readonly receivers?: readonly Is04Receiver[];
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { code: 404, error: 'Not Found', debug: '' });
}

function methodNotAllowed(res: http.ServerResponse): void {
  json(res, 405, { code: 405, error: 'Method Not Allowed', debug: '' });
}

function routeById<T extends { id: string }>(
  path: string,
  collectionPrefix: string,
  resources: readonly T[],
  res: http.ServerResponse,
): boolean {
  const prefix = `${collectionPrefix}/`;
  if (!path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  const id = path.slice(prefix.length);
  if (id.includes('/')) {
    notFound(res);
    return true;
  }
  const found = resources.find((r) => r.id === id);
  if (found === undefined) {
    notFound(res);
    return true;
  }
  json(res, 200, found);
  return true;
}

// ---------------------------------------------------------------------------
// NodeApiServer
// ---------------------------------------------------------------------------

export class NodeApiServer {
  private readonly _node: Is04Node;
  private readonly _device: Is04Device;
  private readonly _senders: readonly Is04Sender[];
  private readonly _receivers: readonly Is04Receiver[];
  private readonly _port: number;
  private readonly _host: string;
  /** Owned server (created internally). Undefined in shared-server mode. */
  private _ownedServer: http.Server | undefined;
  /** Reference to whatever server is currently handling requests (owned or external). */
  private _activeServer: http.Server | undefined;

  constructor(
    node: Is04Node,
    device: Is04Device,
    port: number,
    host: string,
    externalServer?: http.Server,
    mediaResources?: NodeApiMediaResources,
  ) {
    this._node = node;
    this._device = device;
    this._senders = mediaResources?.senders ?? [];
    this._receivers = mediaResources?.receivers ?? [];
    this._port = port;
    this._host = host;
    if (externalServer !== undefined) {
      this._activeServer = externalServer;
    }
  }

  start(): Promise<void> {
    if (this._activeServer !== undefined) {
      this._activeServer.on('request', (req: http.IncomingMessage, res: http.ServerResponse) =>
        this._handle(req, res),
      );
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => this._handle(req, res));
      server.once('error', (err) => reject(err));
      server.listen(this._port, this._host, () => {
        this._ownedServer = server;
        this._activeServer = server;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    if (this._ownedServer === undefined) {
      this._activeServer = undefined;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this._ownedServer!.close((err) => {
        this._ownedServer = undefined;
        this._activeServer = undefined;
        if (err !== undefined) reject(err);
        else resolve();
      });
    });
  }

  get listeningPort(): number {
    const addr = this._activeServer?.address();
    if (addr !== null && typeof addr === 'object') return addr.port;
    return this._port;
  }

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this._handle(req, res);
  }

  private _handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      methodNotAllowed(res);
      return;
    }

    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    this._route(path, res);
  }

  private _route(path: string, res: http.ServerResponse): void {
    const norm = path.endsWith('/') ? path : `${path}/`;

    if (norm === '/x-nmos/') {
      json(res, 200, XNMOS_ROOT);
      return;
    }

    if (norm === '/x-nmos/node/') {
      json(res, 200, API_ROOT);
      return;
    }

    if (norm === '/x-nmos/node/v1.3/') {
      json(res, 200, RESOURCE_LIST);
      return;
    }

    if (path === '/x-nmos/node/v1.3/self') {
      json(res, 200, this._node);
      return;
    }

    if (norm === '/x-nmos/node/v1.3/devices/') {
      json(res, 200, [this._device]);
      return;
    }

    if (path === `/x-nmos/node/v1.3/devices/${this._device.id}`) {
      json(res, 200, this._device);
      return;
    }

    if (norm.startsWith('/x-nmos/node/v1.3/devices/')) {
      notFound(res);
      return;
    }

    if (norm === '/x-nmos/node/v1.3/senders/') {
      json(res, 200, [...this._senders]);
      return;
    }

    if (routeById(path, '/x-nmos/node/v1.3/senders', this._senders, res)) {
      return;
    }

    if (norm === '/x-nmos/node/v1.3/receivers/') {
      json(res, 200, [...this._receivers]);
      return;
    }

    if (routeById(path, '/x-nmos/node/v1.3/receivers', this._receivers, res)) {
      return;
    }

    const emptyMatch = norm.match(/^\/x-nmos\/node\/v1\.3\/([^/]+)\/$/);
    if (emptyMatch !== null) {
      const collection = emptyMatch[1] ?? '';
      if (EMPTY_COLLECTIONS.has(collection)) {
        json(res, 200, []);
        return;
      }
    }

    notFound(res);
  }
}
