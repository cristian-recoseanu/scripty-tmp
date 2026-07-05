/**
 * E15.T8 — IS1201 Conformance Suite (in-process translation).
 *
 * Translates AMWA nmos-testing IS1201Test.py (test_01..test_11) into
 * Vitest integration tests against a live Is12EgressAdapter instance.
 *
 * Source: https://github.com/AMWA-TV/nmos-testing/blob/master/nmostesting/suites/IS1201Test.py
 */

import http from 'node:http';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

import { NCP_CONTROL_TYPE } from '../../../src/adapters/nmos-is12/is04/resources.js';
import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { OID_DEVICE_MANAGER } from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_OBJECT_METHOD } from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import {
  IS12MessageType,
  NcMethodStatus,
  NcPropertyChangeType,
} from '../../../src/adapters/nmos-is12/ms05/types.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';
import { getFreePort } from '../../helpers/getFreePort.js';
import { Is12Client } from '../../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type {
  IS12CommandMessage,
  IS12CommandResponseMessage,
  IS12ErrorMessage,
} from '../../../src/adapters/nmos-is12/ms05/types.js';

// ---------------------------------------------------------------------------
// Adapter setup helpers
// ---------------------------------------------------------------------------

function makeTree() {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Sensor', path: 'root' },
    [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    [],
  );
  root.setProperty('temperature', 20.0);
  tree.setRoot(root);
  return tree;
}

function makeEntities() {
  const reg = new EntityRegistry();
  reg.register({
    entity_name: 'Sensor',
    properties: [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
    ],
    methods: [],
  });
  return reg;
}

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

function makeCtx(bus?: UceBus): AdapterContext {
  return {
    bus: bus ?? new UceBus(),
    tree: makeTree(),
    types: new DatatypeRegistry(),
    entities: makeEntities(),
    logger: makeLogger(),
    config: { wsPort: 0 },
  };
}

// ---------------------------------------------------------------------------
// Raw WS helpers (for tests that deliberately send malformed messages)
// ---------------------------------------------------------------------------

function rawConnect(port: number): Promise<WebSocket> { // port resolved from adapter.wsPort after start()
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function rawReceive(ws: WebSocket, timeoutMs = 2000): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`rawReceive: no message within ${timeoutMs}ms`));
    }, timeoutMs);
    ws.once('message', (data: Buffer | string) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString())); }
      catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
    ws.once('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_01 (IS-04 control advertisement)', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  const wsPath = '/x-nmos/ncp/v1.0';

  beforeEach(async () => {
    port = await getFreePort();
    adapter = new Is12EgressAdapter('is1201-t01');
    const ctx = makeCtx();
    ctx.config = {
      wsPort: port,
      host: '127.0.0.1',
      wsPath,
      is04: {
        nodeApi: {
          enabled: true,
          httpPort: port,
          host: '127.0.0.1',
          advertiseHost: '127.0.0.1',
        },
        registration: { enabled: false },
      },
    };
    await adapter.init(ctx);
    await adapter.start();
  });

  afterEach(async () => { await adapter.stop(); });

  it('test_01: Node advertises IS-12 NCP control endpoint matching the API under test', async () => {
    const listRes = await httpGet(port, '/x-nmos/node/v1.3/devices/');
    expect(listRes.status).toBe(200);
    const devices = JSON.parse(listRes.body) as { id: string }[];
    expect(devices.length).toBeGreaterThan(0);

    const deviceId = devices[0]!.id;
    const deviceRes = await httpGet(port, `/x-nmos/node/v1.3/devices/${deviceId}`);
    expect(deviceRes.status).toBe(200);

    const device = JSON.parse(deviceRes.body) as {
      controls: { type: string; href: string; authorization: boolean }[];
    };
    const control = device.controls.find((c) => c.type === NCP_CONTROL_TYPE);
    expect(control).toBeDefined();

    const expectedHref = `ws://127.0.0.1:${port}${wsPath}`;
    expect(control!.href).toBe(expectedHref);

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const client = new WebSocket(expectedHref);
      client.once('open', () => resolve(client));
      client.once('error', reject);
    });
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// test_02: WebSocket endpoint successfully opened
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_02: WebSocket endpoint opens', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t02');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('connects successfully and receives no unsolicited message on open', async () => {
    const client = await Is12Client.connect(port);
    // No message should arrive unsolicited — nextNotification should time out
    await expect(client.nextNotification(200)).rejects.toThrow();
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// test_03: Socket is kept open until the client closes it
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_03: socket persists', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t03');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('connection remains open after sending a valid command', async () => {
    const client = await Is12Client.connect(port);
    await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 2 } },
    });
    // Still open — send another command successfully
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 2 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// test_04: Node handles command handle out of range (not 1..65535)
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_04: handle out of range', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t04');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('handle = 0 → Error response', async () => {
    const ws = await rawConnect(port);
    const msg: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 0, oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: {} }],
    };
    ws.send(JSON.stringify(msg));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('handle = 65536 → Error response', async () => {
    const ws = await rawConnect(port);
    const msg: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 65536, oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: {} }],
    };
    ws.send(JSON.stringify(msg));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('handle = 1 (min valid) → CommandResponse', async () => {
    const ws = await rawConnect(port);
    const msg: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 1, oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 1, index: 2 } } }],
    };
    ws.send(JSON.stringify(msg));
    const resp = await rawReceive(ws) as IS12CommandResponseMessage;
    expect(resp.messageType).toBe(IS12MessageType.CommandResponse);
    ws.terminate();
  });

  it('handle = 65535 (max valid) → CommandResponse', async () => {
    const ws = await rawConnect(port);
    const msg: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 65535, oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 1, index: 2 } } }],
    };
    ws.send(JSON.stringify(msg));
    const resp = await rawReceive(ws) as IS12CommandResponseMessage;
    expect(resp.messageType).toBe(IS12MessageType.CommandResponse);
    ws.terminate();
  });
});

// ---------------------------------------------------------------------------
// test_05: Node handles command handle that is not a number
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_05: non-numeric handle', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t05');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('string handle → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send(JSON.stringify({
      messageType: IS12MessageType.Command,
      commands: [{ handle: 'abc', oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: {} }],
    }));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('null handle → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send(JSON.stringify({
      messageType: IS12MessageType.Command,
      commands: [{ handle: null, oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: {} }],
    }));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('float handle (non-integer) → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send(JSON.stringify({
      messageType: IS12MessageType.Command,
      commands: [{ handle: 1.5, oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: {} }],
    }));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });
});

// ---------------------------------------------------------------------------
// test_06: Node handles invalid command messageType
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_06: invalid messageType', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t06');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('unknown messageType integer → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send(JSON.stringify({ messageType: 99, commands: [] }));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('string messageType → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send(JSON.stringify({ messageType: 'bogus' }));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('missing messageType → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send(JSON.stringify({ commands: [] }));
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });
});

// ---------------------------------------------------------------------------
// test_07: Node handles invalid JSON
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_07: invalid JSON', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t07');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('non-JSON text → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send('not-valid-json{{');
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });

  it('empty string → Error response', async () => {
    const ws = await rawConnect(port);
    ws.send('');
    const resp = await rawReceive(ws) as IS12ErrorMessage;
    expect(resp.messageType).toBe(IS12MessageType.Error);
    expect(resp.status).toBe(NcMethodStatus.BadCommandFormat);
    ws.terminate();
  });
});

// ---------------------------------------------------------------------------
// test_08: Node handles oid of object not found in Device Model (BadOid)
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_08: BadOid for unknown oid', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t08');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('Get on non-existent oid → result.status BadOid (404)', async () => {
    const client = await Is12Client.connect(port);
    const resp = await client.command({
      oid: 99999,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 1 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadOid);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// test_09: Node handles invalid property identifier (PropertyNotImplemented)
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_09: PropertyNotImplemented', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t09');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('Get with non-existent property id → PropertyNotImplemented (502)', async () => {
    const client = await Is12Client.connect(port);
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 99, index: 99 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.PropertyNotImplemented);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// test_10: Node handles invalid method identifier (MethodNotImplemented)
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_10: MethodNotImplemented', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is1201-t10');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('calling a non-existent method on DeviceManager → MethodNotImplemented (501)', async () => {
    const client = await Is12Client.connect(port);
    const resp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: { level: 99, index: 99 },
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.MethodNotImplemented);
    await client.close();
  });

  it('calling a non-existent method on a user-defined object → MethodNotImplemented (501)', async () => {
    const client = await Is12Client.connect(port);
    // oid=1 is the root (registered in IdentityRegistry)
    const resp = await client.command({
      oid: 1,
      methodId: { level: 99, index: 1 },
      arguments: {},
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.MethodNotImplemented);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// test_11: Node implements subscription and notification (PropertyChanged event)
// ---------------------------------------------------------------------------

describe('IS1201 Conformance — test_11: subscription + PropertyChanged notification', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let bus: UceBus;

  beforeEach(async () => {
    bus = new UceBus();
    adapter = new Is12EgressAdapter('is1201-t11');
    await adapter.init(makeCtx(bus));
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => { await adapter.stop(); });

  it('subscribing to oid=1 then publishing a property change produces a Notification', async () => {
    const client = await Is12Client.connect(port);

    // Subscribe to the root node (oid=1)
    const subResp = await client.subscribe([1]);
    expect(subResp.messageType).toBe(IS12MessageType.SubscriptionResponse);
    expect(subResp.subscriptions).toContain(1);

    // Trigger a property-changed op on the bus (simulating an ingress change)
    const notifPromise = client.nextNotification(2000);
    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 42.0,
      origin: 'external',
      correlationId: 'test-corr',
      ts: new Date().toISOString(),
    });

    const notif = await notifPromise;

    // Structural checks
    expect(notif.messageType).toBe(IS12MessageType.Notification);
    expect(Array.isArray(notif.notifications)).toBe(true);
    expect(notif.notifications.length).toBeGreaterThan(0);

    const n = notif.notifications[0]!;
    expect(n.oid).toBe(1);
    expect(n.eventId).toMatchObject({ level: 1, index: 1 }); // NcObject.PropertyChanged
    expect(n.eventData.changeType).toBe(NcPropertyChangeType.ValueChanged); // 0
    expect(n.eventData.value).toBe(42.0);
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(n.eventData.propertyId).toMatchObject({ level: expect.any(Number), index: expect.any(Number) });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */

    await client.close();
  });

  it('IS-12 Set userLabel → Notification with propertyId {level:1,index:6} (mirrors AMWA test_11 set/restore cycle)', async () => {
    const client = await Is12Client.connect(port);
    await client.subscribe([OID_DEVICE_MANAGER, 1]); // DeviceManager + root

    // Register notification waiter BEFORE sending Set — the notification and
    // command response arrive in the same WS flush; waiter must be in place first.
    const notifPromise = client.nextNotification(2000);
    const setResp = await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: 'test-label' },
    });
    expect(setResp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);

    const notif = await notifPromise;
    expect(notif.messageType).toBe(IS12MessageType.Notification);
    const n = notif.notifications[0]!;
    expect(n.oid).toBe(OID_DEVICE_MANAGER);
    expect(n.eventId).toMatchObject({ level: 1, index: 1 });
    expect(n.eventData.propertyId).toMatchObject({ level: 1, index: 6 });
    expect(n.eventData.changeType).toBe(NcPropertyChangeType.ValueChanged);
    expect(n.eventData.value).toBe('test-label');
    expect(n.eventData.sequenceItemIndex).toBeNull();

    // Restore — second notification
    const notifPromise2 = client.nextNotification(2000);
    await client.command({
      oid: OID_DEVICE_MANAGER,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: '' },
    });
    const notif2 = await notifPromise2;
    expect(notif2.notifications[0]?.eventData.value).toBe('');

    await client.close();
  });

  it('unsubscribed client does NOT receive notifications', async () => {
    const client = await Is12Client.connect(port);
    // Do NOT subscribe

    let received = false;
    const ws = (client as unknown as { _ws: WebSocket })._ws;
    ws.on('message', () => { received = true; });

    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 99.0,
      origin: 'external',
      correlationId: 'test-no-sub',
      ts: new Date().toISOString(),
    });

    await new Promise<void>((r) => setTimeout(r, 100));
    expect(received).toBe(false);
    await client.close();
  });

  it('notification is NOT sent back to the originating adapter session', async () => {
    const client = await Is12Client.connect(port);
    await client.subscribe([1]);

    let received = false;
    const ws = (client as unknown as { _ws: WebSocket })._ws;
    ws.on('message', () => { received = true; });

    // origin matches adapter id → should be suppressed
    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 55.0,
      origin: 'is1201-t11', // same as adapter.id
      correlationId: 'echo-test',
      ts: new Date().toISOString(),
    });

    await new Promise<void>((r) => setTimeout(r, 100));
    expect(received).toBe(false);
    await client.close();
  });
});
