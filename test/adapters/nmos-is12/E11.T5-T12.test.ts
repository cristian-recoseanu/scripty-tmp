/**
 * E11.T5  — WebSocket server & control session.
 * E11.T6  — Command/CommandResponse message handling.
 * E11.T7  — Subscription/SubscriptionResponse.
 * E11.T8  — Notifications (bus → subscribed sessions).
 * E11.T9  — Error handling & status codes.
 * E11.T10 — Data type marshalling (JSON native).
 * E11.T11 — IS-04 registration (behind is04.registration.enabled flag — no-op in tests).
 * E11.T12 — Adapter config schema validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';


import { IS12_CONFIG_JSON_SCHEMA, Is12AdapterConfigSchema } from '../../../src/adapters/nmos-is12/config.js';
import { Is12EgressAdapter, Is12AdapterFactory } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { OID_DEVICE_MANAGER, OID_CLASS_MANAGER } from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_OBJECT_METHOD, NC_CLASS_MANAGER_METHOD } from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { IS12MessageType, NcMethodStatus } from '../../../src/adapters/nmos-is12/ms05/types.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type {
  IS12CommandMessage,
  IS12SubscriptionMessage,
  IS12CommandResponseMessage,
  IS12SubscriptionResponseMessage,
  IS12NotificationMessage,
  IS12ErrorMessage,
} from '../../../src/adapters/nmos-is12/ms05/types.js';

// ---------------------------------------------------------------------------
// Port allocation — pick a base port unlikely to conflict
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Test tree & context helpers
// ---------------------------------------------------------------------------

function makeTree() {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'MySensor', path: 'root' },
    [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'tags', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
    ],
    [],
  );
  root.setProperty('temperature', 21.5);
  root.setProperty('label', 'sensor-A');
  root.setProperty('tags', ['alpha', 'beta']);
  tree.setRoot(root);
  return tree;
}

function makeEntityRegistry() {
  const reg = new EntityRegistry();
  reg.register({
    entity_name: 'MySensor',
    properties: [
      { id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'label', type: 'string', is_array: false, read_only: false, observable: true, nullable: false },
      { id: 'tags', type: 'string', is_array: true, read_only: false, observable: true, nullable: false },
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
    entities: makeEntityRegistry(),
    logger: makeLogger(),
    config: { wsPort: 0 },
  };
}

// ---------------------------------------------------------------------------
// WS helpers
// ---------------------------------------------------------------------------

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function wsReceive(ws: WebSocket): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    ws.once('message', (data: Buffer | string) => {
      try { resolve(JSON.parse(data.toString())); }
      catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
    ws.once('error', (err: Error) => { reject(err); });
  });
}

function wsSend(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// E11.T12 — Config schema
// ---------------------------------------------------------------------------

describe('E11.T12 — IS-12 adapter config schema', () => {
  it('accepts minimal valid config', () => {
    expect(Is12AdapterConfigSchema.safeParse({ wsPort: 8080 }).success).toBe(true);
  });

  it('rejects config without wsPort', () => {
    expect(Is12AdapterConfigSchema.safeParse({}).success).toBe(false);
  });

  it('rejects wsPort out of range', () => {
    expect(Is12AdapterConfigSchema.safeParse({ wsPort: -1 }).success).toBe(false);
    expect(Is12AdapterConfigSchema.safeParse({ wsPort: 65536 }).success).toBe(false);
  });

  it('accepts wsPort: 0 (OS-assigned)', () => {
    expect(Is12AdapterConfigSchema.safeParse({ wsPort: 0 }).success).toBe(true);
  });

  it('accepts host override', () => {
    expect(Is12AdapterConfigSchema.safeParse({ wsPort: 8080, host: '127.0.0.1' }).success).toBe(true);
  });

  it('configSchema() returns JSON Schema object', () => {
    const adapter = new Is12EgressAdapter('test');
    expect(adapter.configSchema()).toBe(IS12_CONFIG_JSON_SCHEMA);
    expect(adapter.configSchema()).toHaveProperty('type', 'object');
  });

  it('init() rejects invalid config', async () => {
    const adapter = new Is12EgressAdapter('bad-cfg');
    const ctx: AdapterContext = { ...makeCtx(), config: { wsPort: 'not-a-number' } };
    await expect(adapter.init(ctx)).rejects.toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// E11.T5 — WebSocket server & control session
// ---------------------------------------------------------------------------

describe('E11.T5 — WebSocket server & session lifecycle', () => {
  let adapter: Is12EgressAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is12-test');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
  });

  afterEach(async () => {
    await adapter.stop();
  });

  it('health is "initialising" before init', () => {
    const fresh = new Is12EgressAdapter('fresh');
    expect(fresh.health().state).toBe('initialising');
  });

  it('health is "healthy" after start', () => {
    expect(adapter.health().state).toBe('healthy');
  });

  it('health is "stopped" after stop', async () => {
    await adapter.stop();
    expect(adapter.health().state).toBe('stopped');
  });

  it('accepts WebSocket connections', async () => {
    const ws = await wsConnect(port);
    expect(adapter.sessionCount).toBe(1);
    ws.close();
    await new Promise<void>((r) => ws.once('close', r));
  });

  it('session is removed after client disconnects', async () => {
    const ws = await wsConnect(port);
    ws.close();
    await new Promise<void>((r) => ws.once('close', r));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(adapter.sessionCount).toBe(0);
  });

  it('start() before init() rejects', async () => {
    const a = new Is12EgressAdapter('not-inited');
    await expect(a.start()).rejects.toThrow();
  });

  it('adapter id and protocol are correct', () => {
    expect(adapter.id).toBe('is12-test');
    expect(adapter.protocol).toBe('nmos-is12');
    expect(adapter.kind).toBe('egress');
  });
});

// ---------------------------------------------------------------------------
// E11.T9 — Error handling
// ---------------------------------------------------------------------------

describe('E11.T9 — Error handling', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let ws: WebSocket;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is12-err');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
    ws = await wsConnect(port);
  });

  afterEach(async () => {
    ws.terminate();
    await adapter.stop();
  });

  it('sends Error for invalid JSON', async () => {
    const recv = wsReceive(ws);
    ws.send('not-json');
    const msg = await recv as IS12ErrorMessage;
    expect(msg.messageType).toBe(IS12MessageType.Error);
    expect(msg.status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('sends Error for missing messageType', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, { foo: 'bar' });
    const msg = await recv as IS12ErrorMessage;
    expect(msg.messageType).toBe(IS12MessageType.Error);
  });

  it('sends Error for unknown messageType', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, { messageType: 99 });
    const msg = await recv as IS12ErrorMessage;
    expect(msg.messageType).toBe(IS12MessageType.Error);
  });

  it('Command with missing commands array sends Error', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, { messageType: IS12MessageType.Command });
    const msg = await recv as IS12ErrorMessage;
    expect(msg.messageType).toBe(IS12MessageType.Error);
    expect(msg.status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('Command with missing handle sends Error', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, {
      messageType: IS12MessageType.Command,
      commands: [{ oid: OID_DEVICE_MANAGER, methodId: NC_OBJECT_METHOD.Get, arguments: {} }],
    });
    const msg = await recv as IS12ErrorMessage;
    expect(msg.messageType).toBe(IS12MessageType.Error);
    expect(msg.status).toBe(NcMethodStatus.BadCommandFormat);
  });

  it('Command with unknown oid returns BadOid result', async () => {
    const recv = wsReceive(ws);
    const cmd: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 1, oid: 9999, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 3, index: 1 } } }],
    };
    wsSend(ws, cmd);
    const resp = await recv as IS12CommandResponseMessage;
    expect(resp.messageType).toBe(IS12MessageType.CommandResponse);
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadOid);
  });
});

// ---------------------------------------------------------------------------
// E11.T6 — Command/CommandResponse
// ---------------------------------------------------------------------------

describe('E11.T6 — Command/CommandResponse', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let ws: WebSocket;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is12-cmd');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
    ws = await wsConnect(port);
  });

  afterEach(async () => {
    ws.terminate();
    await adapter.stop();
  });

  it('NcClassManager.GetDatatype returns NcFloat64', async () => {
    const recv = wsReceive(ws);
    const cmd: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{
        handle: 1,
        oid: OID_CLASS_MANAGER,
        methodId: NC_CLASS_MANAGER_METHOD.GetDatatype,
        arguments: { name: 'NcFloat64' },
      }],
    };
    wsSend(ws, cmd);
    const resp = await recv as IS12CommandResponseMessage;
    expect(resp.messageType).toBe(IS12MessageType.CommandResponse);
    expect(resp.responses).toHaveLength(1);
    expect(resp.responses[0]?.handle).toBe(1);
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    const val = (resp.responses[0]?.result as { value: { type: number } }).value;
    expect(val.type).toBe(0);
  });

  it('NcClassManager.GetControlClass returns MySensor class', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, {
      messageType: IS12MessageType.Command,
      commands: [{
        handle: 2,
        oid: OID_CLASS_MANAGER,
        methodId: NC_CLASS_MANAGER_METHOD.GetControlClass,
        arguments: { classId: [1, 0, 1] },
      }],
    });
    const resp = await recv as IS12CommandResponseMessage;
    const val = (resp.responses[0]?.result as { value: { name: string } }).value;
    expect(val.name).toBe('MySensor');
  });

  it('NcObject.Get returns property value on root node', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, {
      messageType: IS12MessageType.Command,
      commands: [{
        handle: 3,
        oid: 1, // OID_ROOT
        methodId: NC_OBJECT_METHOD.Get,
        arguments: { id: { level: 3, index: 1 } },
      }],
    });
    const resp = await recv as IS12CommandResponseMessage;
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: unknown }).value).toBe(21.5);
  });

  it('NcObject.Set publishes to bus and returns Ok', async () => {
    const bus = new UceBus();
    const ops: unknown[] = [];
    bus.subscribe({ op: 'setProperty' }, (op) => { ops.push(op); });
    const a = new Is12EgressAdapter('set-test');
    await a.init({ ...makeCtx(bus), config: { wsPort: 0 } });
    await a.start();
    const w2 = await wsConnect(a.wsPort);
    const recv = wsReceive(w2);
    wsSend(w2, {
      messageType: IS12MessageType.Command,
      commands: [{
        handle: 4, oid: 1,
        methodId: NC_OBJECT_METHOD.Set,
        arguments: { id: { level: 3, index: 1 }, value: 99.9 },
      }],
    });
    const resp = await recv as IS12CommandResponseMessage;
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect(ops).toHaveLength(1);
    w2.terminate();
    await a.stop();
  });

  it('batch commands return multiple responses in order', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, {
      messageType: IS12MessageType.Command,
      commands: [
        { handle: 10, oid: OID_CLASS_MANAGER, methodId: NC_CLASS_MANAGER_METHOD.GetDatatype, arguments: { name: 'NcFloat64' } },
        { handle: 11, oid: OID_CLASS_MANAGER, methodId: NC_CLASS_MANAGER_METHOD.GetDatatype, arguments: { name: 'NcString' } },
      ],
    });
    const resp = await recv as IS12CommandResponseMessage;
    expect(resp.responses).toHaveLength(2);
    expect(resp.responses[0]?.handle).toBe(10);
    expect(resp.responses[1]?.handle).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// E11.T7 — Subscription/SubscriptionResponse
// ---------------------------------------------------------------------------

describe('E11.T7 — Subscription/SubscriptionResponse', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let ws: WebSocket;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is12-sub');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
    ws = await wsConnect(port);
  });

  afterEach(async () => {
    ws.terminate();
    await adapter.stop();
  });

  it('returns SubscriptionResponse with valid oids', async () => {
    const recv = wsReceive(ws);
    const sub: IS12SubscriptionMessage = {
      messageType: IS12MessageType.Subscription,
      subscriptions: [1],
    };
    wsSend(ws, sub);
    const resp = await recv as IS12SubscriptionResponseMessage;
    expect(resp.messageType).toBe(IS12MessageType.SubscriptionResponse);
    expect(resp.subscriptions).toContain(1);
  });

  it('filters out unknown oids from subscriptions', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, { messageType: IS12MessageType.Subscription, subscriptions: [1, 9999] });
    const resp = await recv as IS12SubscriptionResponseMessage;
    expect(resp.subscriptions).toContain(1);
    expect(resp.subscriptions).not.toContain(9999);
  });

  it('accepts empty subscriptions list', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, { messageType: IS12MessageType.Subscription, subscriptions: [] });
    const resp = await recv as IS12SubscriptionResponseMessage;
    expect(resp.subscriptions).toHaveLength(0);
  });

  it('replaces previous subscriptions on new Subscription message', async () => {
    wsSend(ws, { messageType: IS12MessageType.Subscription, subscriptions: [1] });
    await wsReceive(ws); // first response
    const recv2 = wsReceive(ws);
    wsSend(ws, { messageType: IS12MessageType.Subscription, subscriptions: [] });
    const resp = await recv2 as IS12SubscriptionResponseMessage;
    expect(resp.subscriptions).toHaveLength(0);
  });

  it('handles missing subscriptions field gracefully', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, { messageType: IS12MessageType.Subscription });
    const resp = await recv as IS12SubscriptionResponseMessage;
    expect(resp.messageType).toBe(IS12MessageType.SubscriptionResponse);
    expect(resp.subscriptions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// E11.T8 — Notifications
// ---------------------------------------------------------------------------

describe('E11.T8 — Notifications', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let bus: UceBus;
  let ws: WebSocket;

  beforeEach(async () => {
    bus = new UceBus();
    adapter = new Is12EgressAdapter('is12-notif');
    await adapter.init(makeCtx(bus));
    await adapter.start();
    port = adapter.wsPort;
    ws = await wsConnect(port);
  });

  afterEach(async () => {
    ws.terminate();
    await adapter.stop();
  });

  async function subscribeToOid(oid: number) {
    const recv = wsReceive(ws);
    wsSend(ws, { messageType: IS12MessageType.Subscription, subscriptions: [oid] });
    await recv; // discard SubscriptionResponse
  }

  it('sends Notification when subscribed oid changes on bus', async () => {
    await subscribeToOid(1);
    const notifPromise = wsReceive(ws);
    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 42.0,
      origin: 'external',
      correlationId: 'c1',
      ts: new Date().toISOString(),
    });
    const notif = await notifPromise as IS12NotificationMessage;
    expect(notif.messageType).toBe(IS12MessageType.Notification);
    expect(notif.notifications).toHaveLength(1);
    expect(notif.notifications[0]?.oid).toBe(1);
    expect(notif.notifications[0]?.eventData.value).toBe(42.0);
  });

  it('does not send Notification to unsubscribed session', async () => {
    // do NOT subscribe
    let received = false;
    ws.on('message', () => { received = true; });
    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root', property: 'temperature', changeType: 'valueChanged',
      value: 99.0, origin: 'external', correlationId: 'c2', ts: new Date().toISOString(),
    });
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(received).toBe(false);
  });

  it('does not echo own-origin PropertyChangedOps', async () => {
    await subscribeToOid(1);
    let received = false;
    ws.on('message', () => { received = true; });
    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root', property: 'temperature', changeType: 'valueChanged',
      value: 55.0, origin: 'is12-notif', // <-- same as adapter id
      correlationId: 'c3', ts: new Date().toISOString(),
    });
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(received).toBe(false);
  });

  it('notifies only sessions subscribed to the changed oid', async () => {
    const a2 = new Is12EgressAdapter('is12-notif-2');
    await a2.init({ ...makeCtx(bus), config: { wsPort: 0 } });
    await a2.start();
    const ws2 = await wsConnect(a2.wsPort);

    // ws2 subscribes, ws does not
    const recv2 = wsReceive(ws2);
    wsSend(ws2, { messageType: IS12MessageType.Subscription, subscriptions: [1] });
    await recv2; // discard SubscriptionResponse

    let ws1Received = false;
    ws.on('message', () => { ws1Received = true; });

    const notifPromise = wsReceive(ws2);
    bus.publish({
      op: 'propertyChanged',
      nodeId: 'root', property: 'temperature', changeType: 'valueChanged',
      value: 77.0, origin: 'external', correlationId: 'c4', ts: new Date().toISOString(),
    });
    const notif = await notifPromise as IS12NotificationMessage;
    expect(notif.messageType).toBe(IS12MessageType.Notification);
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(ws1Received).toBe(false);

    ws2.terminate();
    await a2.stop();
  });
});

// ---------------------------------------------------------------------------
// E11.T10 — Data type marshalling
// ---------------------------------------------------------------------------

describe('E11.T10 — Data type marshalling', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let ws: WebSocket;

  beforeEach(async () => {
    adapter = new Is12EgressAdapter('is12-marshal');
    await adapter.init(makeCtx());
    await adapter.start();
    port = adapter.wsPort;
    ws = await wsConnect(port);
  });

  afterEach(async () => {
    ws.terminate();
    await adapter.stop();
  });

  it('marshals number value correctly over wire', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 1, oid: 1, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 3, index: 1 } } }],
    });
    const resp = await recv as IS12CommandResponseMessage;
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(typeof val).toBe('number');
    expect(val).toBe(21.5);
  });

  it('marshals array value correctly over wire', async () => {
    const recv = wsReceive(ws);
    wsSend(ws, {
      messageType: IS12MessageType.Command,
      commands: [{ handle: 2, oid: 1, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 3, index: 3 } } }],
    });
    const resp = await recv as IS12CommandResponseMessage;
    const val = (resp.responses[0]?.result as { value: unknown }).value;
    expect(Array.isArray(val)).toBe(true);
    expect(val).toEqual(['alpha', 'beta']);
  });
});

// ---------------------------------------------------------------------------
// E11.T11 — IS-04 registration flag (no-op / does not throw)
// ---------------------------------------------------------------------------

describe('E11.T11 — IS-04 registration (is04.registration.enabled=false)', () => {
  it('starts without error when is04.registration.enabled=false (default)', async () => {
    const adapter = new Is12EgressAdapter('is12-is04');
    const ctx: AdapterContext = {
      ...makeCtx(),
      config: { wsPort: 0, is04: { registration: { enabled: false } } },
    };
    await adapter.init(ctx);
    await adapter.start();
    expect(adapter.health().state).toBe('healthy');
    await adapter.stop();
  });
});

// ---------------------------------------------------------------------------
// E11 Factory
// ---------------------------------------------------------------------------

describe('E11 — Is12AdapterFactory', () => {
  it('creates an Is12EgressAdapter with correct protocol', () => {
    const adapter = Is12AdapterFactory.create('test-id', 'egress', {});
    expect(adapter.protocol).toBe('nmos-is12');
    expect(adapter.id).toBe('test-id');
  });

  it('factory protocol token is nmos-is12', () => {
    expect(Is12AdapterFactory.protocol).toBe('nmos-is12');
  });
});
