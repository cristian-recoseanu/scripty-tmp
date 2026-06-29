/**
 * E17 — IS-04 Node API & Registration (IS-12 Discovery)
 *
 * T1 — Config schema validation (is04 block, cross-field rules)
 * T2 — Resource builders (buildIs04Node, buildIs04Device, buildNcpControl)
 * T3 — NCP control endpoint advertised in device.controls
 * T4 — NodeApiServer HTTP endpoints
 * T5 — RegistrationClient (register → heartbeat → deregister) with mock registry
 * T6 — Adapter lifecycle: NodeApiServer + RegistrationClient started/stopped
 * T7 — Scenario-01 bridge.yaml parses with new is04 block
 */

import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Is12AdapterConfigSchema } from '../../../src/adapters/nmos-is12/config.js';
import { NodeApiServer } from '../../../src/adapters/nmos-is12/is04/NodeApiServer.js';
import { RegistrationClient } from '../../../src/adapters/nmos-is12/is04/RegistrationClient.js';
import {
  buildIs04Node,
  buildIs04Device,
  buildIs04Sender,
  buildIs04Receiver,
  buildNcpControl,
  NCP_CONTROL_TYPE,
  NMOS_DEVICE_TYPE,
  nowVersion,
} from '../../../src/adapters/nmos-is12/is04/resources.js';
import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { loadBridgeConfig } from '../../../src/config/loader.js';
import { buildCtx } from '../../helpers/builders.js';
import { getFreePort } from '../../helpers/getFreePort.js';

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Silent logger
// ---------------------------------------------------------------------------

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// T1 — Config schema
// ---------------------------------------------------------------------------

describe('E17.T1 — Is12AdapterConfigSchema with is04 block', () => {
  it('accepts minimal config with no is04 key', () => {
    const result = Is12AdapterConfigSchema.safeParse({ wsPort: 9001 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is04.nodeApi.enabled).toBe(false);
      expect(result.data.is04.registration.enabled).toBe(false);
    }
  });

  it('accepts is04.nodeApi.enabled with httpPort', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      is04: { nodeApi: { enabled: true, httpPort: 9002 } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects is04.nodeApi.enabled without httpPort', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      is04: { nodeApi: { enabled: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten();
      expect(flat.fieldErrors.is04?.join(' ') ?? '').toMatch(/httpPort/i);
    }
  });

  it('rejects registration.enabled without nodeApi.enabled', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      is04: {
        nodeApi: { enabled: false },
        registration: { enabled: true, host: 'registry.local' },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.message;
      expect(msg).toMatch(/nodeApi.enabled/i);
    }
  });

  it('rejects registration.enabled without registration.host', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      is04: {
        nodeApi: { enabled: true, httpPort: 9002 },
        registration: { enabled: true },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.message;
      expect(msg).toMatch(/host/i);
    }
  });

  it('accepts full is04 config with registration', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      is04: {
        nodeId: '00000000-0000-4000-8000-000000000001',
        deviceId: '00000000-0000-4000-8000-000000000002',
        label: 'test bridge',
        description: 'test desc',
        nodeApi: { enabled: true, httpPort: 9002, host: '127.0.0.1' },
        registration: {
          enabled: true,
          host: 'registry.local',
          port: 3000,
          heartbeatIntervalSec: 10,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects nodeId that is not a UUID', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      is04: { nodeId: 'not-a-uuid' },
    });
    expect(result.success).toBe(false);
  });

  it('preserves legacy instanceName and registry keys', () => {
    const result = Is12AdapterConfigSchema.safeParse({
      wsPort: 9001,
      instanceName: 'old-name',
      registry: { enabled: false, address: 'reg.local', port: 3000 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instanceName).toBe('old-name');
    }
  });
});

// ---------------------------------------------------------------------------
// T2/T3 — Resource builders
// ---------------------------------------------------------------------------

describe('E17.T2/T3 — IS-04 resource builders', () => {
  it('buildIs04Node returns a valid node resource', () => {
    const node = buildIs04Node({ httpPort: 9002, httpHost: '127.0.0.1', label: 'test-node' });
    expect(typeof node.id).toBe('string');
    expect(node.id.length).toBeGreaterThan(0);
    expect(node.label).toBe('test-node');
    expect(node.api.versions).toContain('v1.3');
    expect(node.api.endpoints[0]?.port).toBe(9002);
    expect(node.href).toMatch(/http:\/\/127\.0\.0\.1:9002/);
  });

  it('buildIs04Node uses provided nodeId', () => {
    const id = '00000000-0000-4000-8000-000000000042';
    const node = buildIs04Node({ nodeId: id, httpPort: 9002, httpHost: '127.0.0.1' });
    expect(node.id).toBe(id);
  });

  it('buildIs04Device returns valid device with empty senders/receivers', () => {
    const control = buildNcpControl('127.0.0.1', 9001);
    const device = buildIs04Device({
      nodeId: 'node-id-here',
      label: 'test-device',
      controls: [control],
    });
    expect(device.type).toBe(NMOS_DEVICE_TYPE);
    expect(device.node_id).toBe('node-id-here');
    expect(device.senders).toEqual([]);
    expect(device.receivers).toEqual([]);
    expect(device.controls).toHaveLength(1);
  });

  it('buildNcpControl constructs correct urn and ws href (root path)', () => {
    const ctrl = buildNcpControl('192.168.1.50', 9001);
    expect(ctrl.type).toBe(NCP_CONTROL_TYPE);
    expect(ctrl.href).toBe('ws://192.168.1.50:9001/');
    expect(ctrl.authorization).toBe(false);
  });

  it('buildNcpControl includes wsPath in href', () => {
    const ctrl = buildNcpControl('192.168.1.50', 9001, '/x-nmos/ncp/v1.0');
    expect(ctrl.href).toBe('ws://192.168.1.50:9001/x-nmos/ncp/v1.0');
  });

  it('buildNcpControl normalises path without leading slash', () => {
    const ctrl = buildNcpControl('192.168.1.50', 9001, 'x-nmos/ncp/v1.0');
    expect(ctrl.href).toBe('ws://192.168.1.50:9001/x-nmos/ncp/v1.0');
  });

  it('buildNcpControl resolves 0.0.0.0 to hostname', () => {
    const ctrl = buildNcpControl('0.0.0.0', 9001);
    expect(ctrl.href).not.toContain('0.0.0.0');
    expect(ctrl.href).toMatch(/^ws:\/\//);
  });

  it('nowVersion returns a "seconds:nanoseconds" string', () => {
    const v = nowVersion();
    expect(v).toMatch(/^\d+:\d+$/);
  });
});

// ---------------------------------------------------------------------------
// T4 — NodeApiServer HTTP endpoints
// ---------------------------------------------------------------------------

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    }).once('error', reject);
  });
}

function httpMethod(
  method: string,
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    });
    req.once('error', reject);
    req.end();
  });
}

describe('E17.T4 — NodeApiServer', () => {
  let server: NodeApiServer;
  let port: number;
  const nodeId = '00000000-0000-4000-8000-000000000001';
  const deviceId = '00000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    const node = buildIs04Node({ nodeId, httpPort: 0, httpHost: '127.0.0.1' });
    const device = buildIs04Device({
      deviceId,
      nodeId,
      controls: [buildNcpControl('127.0.0.1', 0)],
    });
    server = new NodeApiServer(node, device, 0, '127.0.0.1');
    await server.start();
    port = server.listeningPort;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('GET /x-nmos/ returns ["node/"]', async () => {
    const res = await httpGet(port, '/x-nmos/');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['node/']);
  });

  it('GET /x-nmos/node/ returns ["v1.3/"]', async () => {
    const res = await httpGet(port, '/x-nmos/node/');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['v1.3/']);
  });

  it('GET /x-nmos/node/v1.3/ returns resource list', async () => {
    const res = await httpGet(port, '/x-nmos/node/v1.3/');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as string[];
    expect(body).toContain('self');
    expect(body).toContain('devices/');
  });

  it('GET /x-nmos/node/v1.3/self returns node resource', async () => {
    const res = await httpGet(port, '/x-nmos/node/v1.3/self');
    expect(res.status).toBe(200);
    const node = JSON.parse(res.body) as { id: string; api: unknown };
    expect(node.id).toBe(nodeId);
    expect(node.api).toBeDefined();
  });

  it('GET /x-nmos/node/v1.3/devices/ returns array with one device', async () => {
    const res = await httpGet(port, '/x-nmos/node/v1.3/devices/');
    expect(res.status).toBe(200);
    const list = JSON.parse(res.body) as { id: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(deviceId);
  });

  it('GET /x-nmos/node/v1.3/devices/<id> returns device', async () => {
    const res = await httpGet(port, `/x-nmos/node/v1.3/devices/${deviceId}`);
    expect(res.status).toBe(200);
    const device = JSON.parse(res.body) as { id: string; controls: unknown[] };
    expect(device.id).toBe(deviceId);
    expect(device.controls[0]).toMatchObject({ type: NCP_CONTROL_TYPE });
  });

  it('GET /x-nmos/node/v1.3/sources/ returns []', async () => {
    const res = await httpGet(port, '/x-nmos/node/v1.3/sources/');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('GET /x-nmos/node/v1.3/receivers/ returns []', async () => {
    const res = await httpGet(port, '/x-nmos/node/v1.3/receivers/');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('GET /x-nmos/node/v1.3/senders/<id> returns sender when configured (E19.T3)', async () => {
    await server.stop();
    const senderId = '00000000-0000-4000-8000-000000000010';
    const receiverId = '00000000-0000-4000-8000-000000000011';
    const node = buildIs04Node({ nodeId, httpPort: 0, httpHost: '127.0.0.1' });
    const device = buildIs04Device({
      deviceId,
      nodeId,
      controls: [buildNcpControl('127.0.0.1', 0)],
      senderIds: [senderId],
      receiverIds: [receiverId],
    });
    const sender = buildIs04Sender({ senderId, deviceId: device.id });
    const receiver = buildIs04Receiver({ receiverId, deviceId: device.id });
    server = new NodeApiServer(node, device, 0, '127.0.0.1', undefined, {
      senders: [sender],
      receivers: [receiver],
    });
    await server.start();
    port = server.listeningPort;

    const senderRes = await httpGet(port, `/x-nmos/node/v1.3/senders/${senderId}`);
    expect(senderRes.status).toBe(200);
    expect((JSON.parse(senderRes.body) as { id: string }).id).toBe(senderId);

    const receiverRes = await httpGet(port, `/x-nmos/node/v1.3/receivers/${receiverId}`);
    expect(receiverRes.status).toBe(200);
    expect((JSON.parse(receiverRes.body) as { id: string }).id).toBe(receiverId);

    const missing = await httpGet(port, '/x-nmos/node/v1.3/senders/00000000-0000-4000-8000-000000000099');
    expect(missing.status).toBe(404);
  });

  it('GET unknown path returns 404', async () => {
    const res = await httpGet(port, '/x-nmos/node/v1.3/unknown');
    expect(res.status).toBe(404);
  });

  it('POST returns 405', async () => {
    const res = await httpMethod('POST', port, '/x-nmos/node/v1.3/self');
    expect(res.status).toBe(405);
  });

  it('listeningPort reflects actual bound port', () => {
    expect(server.listeningPort).toBeGreaterThan(0);
    expect(server.listeningPort).toBe(port);
  });
});

// ---------------------------------------------------------------------------
// T5 — RegistrationClient with mock registry
// ---------------------------------------------------------------------------

interface MockRegistryRequest {
  method: string;
  path: string;
  body: string;
}

/** Spins up a minimal mock NMOS Registration API HTTP server. */
function startMockRegistry(port: number, opts?: {
  heartbeatStatus?: number;
  registrationStatus?: number;
}): Promise<{ server: http.Server; requests: MockRegistryRequest[]; close: () => Promise<void> }> {
  const requests: MockRegistryRequest[] = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        requests.push({ method: req.method ?? '', path: req.url ?? '', body });
        const path = req.url ?? '';
        if (path.includes('/health/nodes/')) {
          const status = opts?.heartbeatStatus ?? 200;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ health: String(Math.floor(Date.now() / 1000)) }));
        } else if (path.includes('/resource') && req.method === 'DELETE') {
          res.writeHead(204);
          res.end();
        } else if (path.includes('/resource') && req.method === 'POST') {
          const status = opts?.registrationStatus ?? 200;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end('{}');
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        requests,
        close: () => new Promise<void>((res, rej) => server.close((e) => e ? rej(e) : res())),
      });
    });
  });
}

describe('E17.T5 — RegistrationClient', () => {
  it('registers node + device on start()', async () => {
    const regPort = await getFreePort();
    const mock = await startMockRegistry(regPort);
    const node = buildIs04Node({ nodeId: '00000000-0000-4000-8000-000000000010', httpPort: 9002, httpHost: '127.0.0.1' });
    const device = buildIs04Device({ deviceId: '00000000-0000-4000-8000-000000000011', nodeId: node.id, controls: [] });

    const client = new RegistrationClient({
      registryHost: '127.0.0.1',
      registryPort: regPort,
      heartbeatIntervalSec: 60,
      node,
      device,
      logger: silentLogger,
    });

    await client.start();
    await client.stop();
    await mock.close();

    const posts = mock.requests.filter((r) => r.method === 'POST' && r.path.includes('/resource'));
    expect(posts.length).toBeGreaterThanOrEqual(2);
    const types = posts.map((r) => (JSON.parse(r.body) as { type: string }).type);
    expect(types).toContain('node');
    expect(types).toContain('device');
  });

  it('sends DELETE for device then node on stop()', async () => {
    const regPort = await getFreePort();
    const mock = await startMockRegistry(regPort);
    const nodeId = '00000000-0000-4000-8000-000000000020';
    const deviceId = '00000000-0000-4000-8000-000000000021';
    const node = buildIs04Node({ nodeId, httpPort: 9002, httpHost: '127.0.0.1' });
    const device = buildIs04Device({ deviceId, nodeId, controls: [] });

    const client = new RegistrationClient({
      registryHost: '127.0.0.1',
      registryPort: regPort,
      heartbeatIntervalSec: 60,
      node,
      device,
      logger: silentLogger,
    });

    await client.start();
    await client.stop();
    await mock.close();

    const deletes = mock.requests.filter((r) => r.method === 'DELETE');
    expect(deletes.length).toBe(2);
    const deletePaths = deletes.map((r) => r.path);
    expect(deletePaths.some((p) => p.includes(deviceId))).toBe(true);
    expect(deletePaths.some((p) => p.includes(nodeId))).toBe(true);
  });

  it('re-registers node + device on heartbeat 404', async () => {
    const regPort = await getFreePort();
    let heartbeatCount = 0;
    const requests: MockRegistryRequest[] = [];
    const mockSrv: http.Server = await new Promise((res, rej) => {
      const s = http.createServer((req, resHttp) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          requests.push({ method: req.method ?? '', path: req.url ?? '', body });
          const path = req.url ?? '';
          if (path.includes('/health/nodes/')) {
            heartbeatCount++;
            if (heartbeatCount === 1) {
              resHttp.writeHead(404);
              resHttp.end();
            } else {
              resHttp.writeHead(200, { 'Content-Type': 'application/json' });
              resHttp.end(JSON.stringify({ health: 'ok' }));
            }
          } else if (path.includes('/resource') && req.method === 'POST') {
            resHttp.writeHead(200, { 'Content-Type': 'application/json' });
            resHttp.end('{}');
          } else if (path.includes('/resource') && req.method === 'DELETE') {
            resHttp.writeHead(204);
            resHttp.end();
          } else {
            resHttp.writeHead(404);
            resHttp.end();
          }
        });
      });
      s.once('error', rej);
      s.listen(regPort, '127.0.0.1', () => res(s));
    });

    const node = buildIs04Node({ nodeId: '00000000-0000-4000-8000-000000000030', httpPort: 9002, httpHost: '127.0.0.1' });
    const device = buildIs04Device({ deviceId: '00000000-0000-4000-8000-000000000031', nodeId: node.id, controls: [] });

    const client = new RegistrationClient({
      registryHost: '127.0.0.1',
      registryPort: regPort,
      heartbeatIntervalSec: 1,
      node,
      device,
      logger: silentLogger,
    });

    await client.start();

    await new Promise<void>((r) => setTimeout(r, 1500));

    await client.stop();
    await new Promise<void>((res, rej) => mockSrv.close((e) => e ? rej(e) : res()));

    const postReqs = requests.filter((r) => r.method === 'POST' && r.path.includes('/resource'));
    expect(postReqs.length).toBeGreaterThanOrEqual(4);
  });

  it('throws on registration API error', async () => {
    const regPort = await getFreePort();
    const mock = await startMockRegistry(regPort, { registrationStatus: 500 });
    const node = buildIs04Node({ httpPort: 9002, httpHost: '127.0.0.1' });
    const device = buildIs04Device({ nodeId: node.id, controls: [] });

    const client = new RegistrationClient({
      registryHost: '127.0.0.1',
      registryPort: regPort,
      heartbeatIntervalSec: 60,
      node,
      device,
      logger: silentLogger,
    });

    await expect(client.start()).rejects.toThrow(/HTTP 500/);
    await mock.close();
  });
});

// ---------------------------------------------------------------------------
// T6 — Adapter lifecycle with IS-04
// ---------------------------------------------------------------------------

describe('E17.T6 — Adapter lifecycle with IS-04 Node API', () => {
  it('starts and stops cleanly with nodeApi.enabled (shared port: HTTP + WS)', async () => {
    const sharedPort = await getFreePort();
    const adapter = new Is12EgressAdapter('e17-test-no-reg');
    const ctx = buildCtx({ extraConfig: {
      is04: {
        nodeApi: { enabled: true, httpPort: sharedPort },
        registration: { enabled: false },
      },
    }});

    await adapter.init(ctx);
    await adapter.start();
    expect(adapter.health().state).toBe('healthy');

    const res = await httpGet(sharedPort, '/x-nmos/node/v1.3/self');
    expect(res.status).toBe(200);
    const node = JSON.parse(res.body) as { api: unknown };
    expect(node.api).toBeDefined();

    await adapter.stop();
    expect(adapter.health().state).toBe('stopped');
  });

  it('starts and stops cleanly with nodeApi disabled (standalone WS)', async () => {
    const adapter = new Is12EgressAdapter('e17-test-disabled');
    const ctx = buildCtx();

    await adapter.init(ctx);
    await adapter.start();
    expect(adapter.health().state).toBe('healthy');

    await adapter.stop();
    expect(adapter.health().state).toBe('stopped');
  });

  it('nodeApi serves NCP control href pointing at the shared port', async () => {
    const sharedPort = await getFreePort();
    const adapter = new Is12EgressAdapter('e17-test-ncp-ctrl');
    const ctx = buildCtx({ extraConfig: {
      is04: {
        nodeApi: { enabled: true, httpPort: sharedPort, host: '127.0.0.1' },
        registration: { enabled: false },
      },
    }});

    await adapter.init(ctx);
    await adapter.start();

    const res = await httpGet(sharedPort, `/x-nmos/node/v1.3/devices/`);
    const devices = JSON.parse(res.body) as { controls: { type: string; href: string }[] }[];
    const ctrl = devices[0]?.controls.find((c) => c.type === NCP_CONTROL_TYPE);
    expect(ctrl).toBeDefined();
    expect(ctrl?.href).toContain(String(sharedPort));

    await adapter.stop();
  });

  it('WS connects on the same shared port as HTTP when nodeApi.enabled', async () => {
    const sharedPort = await getFreePort();
    const adapter = new Is12EgressAdapter('e17-test-ws-shared');
    const ctx = buildCtx({ extraConfig: {
      is04: {
        nodeApi: { enabled: true, httpPort: sharedPort, host: '127.0.0.1' },
        registration: { enabled: false },
      },
    }});

    await adapter.init(ctx);
    await adapter.start();
    expect(adapter.wsPort).toBe(sharedPort);

    await adapter.stop();
  });

  it('starts registration client when both nodeApi and registration enabled', async () => {
    const sharedPort = await getFreePort();
    const regPort = await getFreePort();
    const mock = await startMockRegistry(regPort);

    const adapter = new Is12EgressAdapter('e17-test-with-reg');
    const ctx = buildCtx({ extraConfig: {
      is04: {
        nodeId: '00000000-0000-4000-8000-000000000099',
        deviceId: '00000000-0000-4000-8000-000000000098',
        nodeApi: { enabled: true, httpPort: sharedPort, host: '127.0.0.1' },
        registration: {
          enabled: true,
          host: '127.0.0.1',
          port: regPort,
          heartbeatIntervalSec: 60,
        },
      },
    }});

    await adapter.init(ctx);
    await adapter.start();
    expect(adapter.health().state).toBe('healthy');

    const posts = mock.requests.filter((r) => r.method === 'POST' && r.path.includes('/resource'));
    expect(posts.length).toBeGreaterThanOrEqual(2);

    await adapter.stop();
    await mock.close();

    const deletes = mock.requests.filter((r) => r.method === 'DELETE');
    expect(deletes.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T7 — Scenario-01 bridge.yaml parses with is04 block
// ---------------------------------------------------------------------------

describe('E17.T7 — Scenario-01 bridge.yaml with is04', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SCENARIO_DIR = resolve(__dirname, '../../../Scenarios/Scenario-01');

  it('loadBridgeConfig succeeds and is04 block validates', () => {
    const cfg = loadBridgeConfig(resolve(SCENARIO_DIR, 'bridge.yaml'));
    const egress = cfg.egress[0];
    expect(egress).toBeDefined();

    const parsed = Is12AdapterConfigSchema.safeParse(egress?.config);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.is04.nodeApi.enabled).toBe(true);
      expect(parsed.data.is04.nodeApi.httpPort).toBe(9002);
      expect(parsed.data.is04.nodeApi.advertiseHost).toBe('localhost');
      expect(parsed.data.is04.registration.enabled).toBe(true);
      expect(parsed.data.is04.registration.host).toBe('localhost');
      expect(parsed.data.is04.registration.port).toBe(8080);
      expect(parsed.data.is04.label).toBe('Scenario-01 Protocol Bridge');
      expect(parsed.data.wsPath).toBe('/x-nmos/ncp/v1.0');
    }
  });
});
