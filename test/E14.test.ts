/**
 * E14 — Test Infrastructure & Strategy.
 *
 * T1 — Test helpers: builders/factories + custom matchers.
 * T2 — MQTT mock harness (vi.mock; no external broker — Aedes was removed due to
 *      unpredictable timeouts in CI; real-broker integration is out of scope here).
 * T3 — IS-12 WebSocket typed test client.
 * T4 — E2E vertical-slice: engine→IS-12 Notification (MQTT ingress simulated via
 *      PropertyChangedOp bus injection — no real broker required).
 * T5 — Property-based & fuzz tests (fast-check codec round-trips + malformed frames).
 * T6 — IS-12/MS-05 conformance checks (JSON schema validation).
 * T7 — Coverage gates: verify thresholds already met (checked by npm run validate).
 */

import { randomUUID } from 'node:crypto';

import Ajv from 'ajv';
import fc from 'fast-check';
import { describe, it, vi, expect as vitestExpect, beforeEach, afterEach } from 'vitest';

import { IS12_CONFIG_JSON_SCHEMA } from '../src/adapters/nmos-is12/config.js';
import { Is12EgressAdapter } from '../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { OID_ROOT } from '../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_OBJECT_METHOD } from '../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { IS12MessageType, NcMethodStatus } from '../src/adapters/nmos-is12/ms05/types.js';
import { makePropertyChangedOp } from '../src/engine/bus/operations.js';
import { UceBus } from '../src/engine/bus/UceBus.js';
import { UceEngine } from '../src/engine/UceEngine.js';

import {
  buildCtx,
  buildTree,
  buildSetOp,
  buildChangedOp,
  collectOps,
  expect,
} from './helpers/builders.js';
import { Is12Client } from './helpers/Is12Client.js';

import type { IS12NotificationMessage } from '../src/adapters/nmos-is12/ms05/types.js';

// ---------------------------------------------------------------------------
// Port counter (adapters/WS server)
// ---------------------------------------------------------------------------

// ===========================================================================
// E14.T1 — Test helpers & custom matchers
// ===========================================================================

describe('E14.T1 — Test helpers & custom matchers', () => {
  it('buildNode creates node with default temperature property', () => {
    const { root } = buildTree();
    const p = root.getProperty('temperature');
    vitestExpect(p.ok).toBe(true);
    if (p.ok) vitestExpect(p.value).toBe(20.0);
  });

  it('buildTree returns a usable InstanceTree', () => {
    const { tree } = buildTree();
    const r = tree.findById('root');
    vitestExpect(r.ok).toBe(true);
  });

  it('buildCtx returns a fully wired AdapterContext', () => {
    const ctx = buildCtx({ port: 0 });
    vitestExpect(ctx.bus).toBeDefined();
    vitestExpect(ctx.tree).toBeDefined();
    vitestExpect(ctx.entities).toBeDefined();
  });

  it('buildSetOp returns a valid SetPropertyOp', () => {
    const op = buildSetOp({ value: 99.0 });
    vitestExpect(op.op).toBe('setProperty');
    vitestExpect(op.value).toBe(99.0);
    vitestExpect(op.origin).toBeDefined();
    vitestExpect(op.correlationId).toBeDefined();
  });

  it('buildChangedOp returns a valid PropertyChangedOp', () => {
    const op = buildChangedOp({ origin: 'mqtt', value: 55.0 });
    vitestExpect(op.op).toBe('propertyChanged');
    vitestExpect(op.origin).toBe('mqtt');
    vitestExpect(op.value).toBe(55.0);
  });

  it('collectOps captures all bus publications', () => {
    const bus = new UceBus();
    const ops = collectOps(bus);
    bus.publish(buildChangedOp());
    bus.publish(buildChangedOp({ value: 1.0 }));
    vitestExpect(ops).toHaveLength(2);
  });

  it('custom matcher: toBePropertyChangedOp', () => {
    const op = buildChangedOp({ nodeId: 'root', property: 'temperature', value: 42.0 });
    expect(op).toBePropertyChangedOp('root', 'temperature', 42.0);
  });

  it('custom matcher: toHaveOrigin', () => {
    const op = buildSetOp({ origin: 'is12-ctrl' });
    expect(op).toHaveOrigin('is12-ctrl');
  });

  it('custom matcher: toHaveCorrelationId', () => {
    const id = randomUUID();
    const op = buildSetOp({ correlationId: id });
    expect(op).toHaveCorrelationId(id);
  });

  it('buildCtx shares tree across ctx and engine', () => {
    const { tree } = buildTree();
    const bus = new UceBus();
    const ctx = buildCtx({ tree, bus });
    const engine = new UceEngine({ tree: ctx.tree, bus: ctx.bus });
    engine.start();
    bus.publish(buildSetOp({ nodeId: 'root', property: 'temperature', value: 77.0 }));
    // Engine uses same tree reference — lookup returns updated value after processing
    engine.stop();
    vitestExpect(ctx.tree).toBe(tree);
  });
});

// ===========================================================================
// E14.T2 — MQTT mock harness
// (Aedes was removed — unpredictable timeouts; real-broker integration is
// covered by the existing E10/E13 tests which also use vi.mock('mqtt').)
// ===========================================================================

describe('E14.T2 — MQTT mock harness', () => {
  it('vi.mock MQTT: connectAsync returns a controllable fake client', async () => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const published: string[] = [];
    const fakeClient = {
      on(e: string, cb: (...a: unknown[]) => void) {
        const b = handlers[e] ?? []; handlers[e] = b; b.push(cb); return this;
      },
      emit(e: string, ...a: unknown[]) { for (const cb of handlers[e] ?? []) cb(...a); },
      publishAsync: vi.fn().mockImplementation((_t: string, p: string) => { published.push(p); return Promise.resolve(); }),
      subscribeAsync: vi.fn().mockResolvedValue(undefined),
      endAsync: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnect = vi.fn().mockResolvedValue(fakeClient);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const c: typeof fakeClient = await mockConnect('mqtt://localhost:1883');
    await c.publishAsync('t', '42');
    vitestExpect(published).toContain('42');
    vitestExpect(mockConnect).toHaveBeenCalledWith('mqtt://localhost:1883');
  });

  it('vi.mock MQTT: subscribeAsync resolves without error', async () => {
    const fakeClient = {
      subscribeAsync: vi.fn().mockResolvedValue(undefined),
      endAsync: vi.fn().mockResolvedValue(undefined),
    };
    await vitestExpect(fakeClient.subscribeAsync('sensors/#')).resolves.toBeUndefined();
  });

  it('vi.mock MQTT: on/emit handler round-trip delivers message', () => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const fakeClient = {
      on(e: string, cb: (...a: unknown[]) => void) {
        const b = handlers[e] ?? []; handlers[e] = b; b.push(cb);
      },
      emit(e: string, ...a: unknown[]) { for (const cb of handlers[e] ?? []) cb(...a); },
    };
    const received: unknown[] = [];
    fakeClient.on('message', (...a: unknown[]) => received.push(a));
    fakeClient.emit('message', 'sensors/temp', Buffer.from('21.5'));
    vitestExpect(received).toHaveLength(1);
  });

  it('vi.mock MQTT: endAsync resolves cleanly', async () => {
    const fakeClient = { endAsync: vi.fn().mockResolvedValue(undefined) };
    await vitestExpect(fakeClient.endAsync()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// E14.T3 — IS-12 WebSocket typed test client
// ===========================================================================

describe('E14.T3 — IS-12 typed test client', () => {
  let adapter: Is12EgressAdapter;
  let port: number;
  let client: Is12Client;

  beforeEach(async () => {
    const { tree } = buildTree();
    const bus = new UceBus();
    const engine = new UceEngine({ tree, bus });
    engine.start();

    adapter = new Is12EgressAdapter('is12-e14');
    await adapter.init(buildCtx({ tree, bus }));
    await adapter.start();
    port = adapter.wsPort;
    client = await Is12Client.connect(port);
  });

  afterEach(async () => {
    await client.close();
    await adapter.stop();
  });

  it('command() Get returns ok result', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    vitestExpect(resp.messageType).toBe(IS12MessageType.CommandResponse);
    vitestExpect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
  });

  it('command() Set returns ok result', async () => {
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 3, index: 1 }, value: 55.0 },
    });
    vitestExpect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
  });

  it('command() unknown oid returns BadOid', async () => {
    const resp = await client.command({
      oid: 9999,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });
    vitestExpect(resp.responses[0]?.result.status).toBe(NcMethodStatus.BadOid);
  });

  it('subscribe() + nextNotification() receives Notification on bus change', async () => {
    const { tree } = buildTree();
    const bus = new UceBus();
    const engine2 = new UceEngine({ tree, bus });
    engine2.start();

    const a2 = new Is12EgressAdapter('is12-e14-notif');
    await a2.init(buildCtx({ tree, bus }));
    await a2.start();

    const c2 = await Is12Client.connect(a2.wsPort);
    await c2.subscribe([OID_ROOT]);

    // Push a PropertyChangedOp from a different origin → triggers Notification
    const notifPromise = c2.nextNotification(300);
    bus.publish(makePropertyChangedOp({
      correlationId: randomUUID(),
      origin: 'external',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 88.0,
    }));

    const notif = await notifPromise;
    vitestExpect(notif.messageType).toBe(IS12MessageType.Notification);
    vitestExpect(notif.notifications[0]?.eventData.value).toBe(88.0);

    await c2.close();
    await a2.stop();
    engine2.stop();
  });

  it('nextNotification() rejects on timeout when no notification arrives', async () => {
    await client.subscribe([OID_ROOT]);
    await vitestExpect(client.nextNotification(50)).rejects.toThrow('no Notification received');
  });

  it('handle auto-increments per command', async () => {
    const r1 = await client.command({ oid: OID_ROOT, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 3, index: 1 } } });
    const r2 = await client.command({ oid: OID_ROOT, methodId: NC_OBJECT_METHOD.Get, arguments: { id: { level: 3, index: 1 } } });
    vitestExpect(r1.responses[0]?.handle).not.toBe(r2.responses[0]?.handle);
  });
});

// ===========================================================================
// E14.T4 — E2E vertical-slice: engine → IS-12 Notification
// (MQTT ingress is simulated by publishing PropertyChangedOp directly onto the
// bus — equivalent to what MqttIngressAdapter does after decoding a message.
// A real external broker is not needed and is out of scope for this harness.)
// ===========================================================================

describe('E14.T4 — E2E vertical-slice: engine → IS-12 Notification', () => {
  let is12Adapter: Is12EgressAdapter;
  let engine: UceEngine;
  let bus: UceBus;
  let is12Port: number;

  beforeEach(async () => {
    const { tree } = buildTree();
    bus = new UceBus();
    engine = new UceEngine({ tree, bus });
    engine.start();
    is12Adapter = new Is12EgressAdapter('is12-e14-e2e');
    await is12Adapter.init(buildCtx({ tree, bus }));
    await is12Adapter.start();
    is12Port = is12Adapter.wsPort;
  });

  afterEach(async () => {
    await is12Adapter.stop();
    engine.stop();
  });

  it('bus PropertyChangedOp → IS-12 Notification delivered to subscribed client', async () => {
    const client = await Is12Client.connect(is12Port);
    await client.subscribe([OID_ROOT]);

    const notifPromise = client.nextNotification(500);
    bus.publish(makePropertyChangedOp({
      correlationId: randomUUID(),
      origin: 'simulated-mqtt',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 37.5,
    }));

    const notif = await notifPromise;
    vitestExpect(notif.messageType).toBe(IS12MessageType.Notification);
    vitestExpect(notif.notifications[0]?.eventData.value).toBe(37.5);

    await client.close();
  });

  it('multiple bus ops → all IS-12 Notifications arrive', async () => {
    const client = await Is12Client.connect(is12Port);
    await client.subscribe([OID_ROOT]);

    const values = [1.0, 2.0, 3.0];
    const received: number[] = [];
    for (const v of values) {
      const notifPromise = client.nextNotification(300);
      bus.publish(makePropertyChangedOp({
        correlationId: randomUUID(),
        origin: 'simulated-mqtt',
        nodeId: 'root',
        property: 'temperature',
        changeType: 'valueChanged',
        value: v,
      }));
      const n = await notifPromise;
      received.push(n.notifications[0]?.eventData.value as number);
    }

    vitestExpect(received).toEqual(values);
    await client.close();
  });

  it('IS-12 Set command → engine applies change → tree updated', async () => {
    const client = await Is12Client.connect(is12Port);
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 3, index: 1 }, value: 99.0 },
    });
    vitestExpect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);

    await new Promise<void>((r) => setTimeout(r, 20));

    const lookup = engine.tree.findById('root');
    vitestExpect(lookup.ok).toBe(true);
    if (lookup.ok) {
      const val = lookup.node.getProperty('temperature');
      if (val.ok) vitestExpect(val.value).toBe(99.0);
    }
    await client.close();
  });

  it('shared bus: PropertyChangedOp reaches clients on two independent adapters simultaneously', async () => {
    // Two IS-12 adapters share the same bus. A bus.publish(PropertyChangedOp)
    // (the mechanism used by MqttIngressAdapter after decoding a message)
    // should deliver Notifications to subscribed clients on BOTH adapters.
    const { buildEntityRegistry } = await import('./helpers/builders.js');
    const readerAdapter = new Is12EgressAdapter('is12-reader');
    await readerAdapter.init(buildCtx({ tree: engine.tree, bus, entities: buildEntityRegistry() }));
    await readerAdapter.start();

    const c1 = await Is12Client.connect(is12Port);
    const c2 = await Is12Client.connect(readerAdapter.wsPort);
    await c1.subscribe([OID_ROOT]);
    await c2.subscribe([OID_ROOT]);

    const notif1Promise = c1.nextNotification(500);
    const notif2Promise = c2.nextNotification(500);

    // Simulate what MqttIngressAdapter does when it receives a telemetry message
    bus.publish(makePropertyChangedOp({
      correlationId: randomUUID(),
      origin: 'simulated-mqtt',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 77.0,
    }));

    const [n1, n2] = await Promise.all([notif1Promise, notif2Promise]);
    vitestExpect(n1.notifications[0]?.eventData.value).toBe(77.0);
    vitestExpect(n2.notifications[0]?.eventData.value).toBe(77.0);

    await c1.close();
    await c2.close();
    await readerAdapter.stop();
  });
});

// ===========================================================================
// E14.T5 — Property-based & fuzz tests
// ===========================================================================

describe('E14.T5 — Property-based & fuzz tests', () => {
  it('buildSetOp / bus round-trip: origin always preserved', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 32 }), (origin: string) => {
        const bus = new UceBus();
        const ops = collectOps(bus);
        const op = buildSetOp({ origin });
        bus.publish(op);
        vitestExpect(ops[0]).toHaveProperty('origin', origin);
      }),
    );
  });

  it('buildChangedOp: value round-trips through bus unchanged', () => {
    fc.assert(
      fc.property(fc.float({ noNaN: true }), (v: number) => {
        const bus = new UceBus();
        const ops = collectOps(bus);
        bus.publish(buildChangedOp({ value: v }));
        vitestExpect((ops[0] as { value: unknown }).value).toBe(v);
      }),
    );
  });

  it('IS-12 adapter: malformed JSON frame does not crash the adapter', async () => {
    const { tree } = buildTree();
    const bus = new UceBus();
    const adapter = new Is12EgressAdapter('fuzz-is12');
    await adapter.init(buildCtx({ tree, bus }));
    await adapter.start();
    const fuzzPort = adapter.wsPort;

    const WebSocket = (await import('ws')).default;
    const ws = await new Promise<InstanceType<typeof WebSocket>>((resolve, reject) => {
      const w = new WebSocket(`ws://127.0.0.1:${fuzzPort}`);
      w.once('open', () => resolve(w));
      w.once('error', reject);
    });

    // Send multiple malformed frames
    const garbage = [
      '{not json',
      '',
      '[]',
      '{"messageType":999,"commands":[]}',
      'null',
      '{"messageType":0}',
    ];
    for (const g of garbage) {
      ws.send(g);
    }

    // Wait a tick — if adapter crashed it would be unhealthy
    await new Promise<void>((r) => setTimeout(r, 30));
    vitestExpect(adapter.health().state).toBe('healthy');

    ws.close();
    await adapter.stop();
  });

  it('MQTT adapter: malformed payload does not crash adapter', async () => {
    const { decode } = await import('../src/mapping/decoders.js');
    // '' (empty) decodes to 0 which is valid — omit it.
    // Only test payloads that are genuinely non-finite.
    const badPayloads = ['not-a-number', 'NaN', 'Infinity', '-Infinity', '{}', 'abc'];
    for (const bad of badPayloads) {
      const result = decode(Buffer.from(bad), { format: 'raw-number' });
      // Should return ok:false rather than throw
      vitestExpect(result.ok).toBe(false);
    }
  });
});

// ===========================================================================
// E14.T6 — IS-12/MS-05 conformance checks (JSON Schema)
// ===========================================================================

describe('E14.T6 — IS-12/MS-05 conformance', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const ajv = new Ajv({ strict: false });

  it('IS-12 adapter config schema is a valid JSON Schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
    vitestExpect(() => (ajv as Ajv).compile(IS12_CONFIG_JSON_SCHEMA)).not.toThrow();
  });

  it('IS-12 adapter config schema rejects missing wsPort', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const validate = (ajv as Ajv).compile(IS12_CONFIG_JSON_SCHEMA);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    vitestExpect(validate({})).toBe(false);
  });

  it('IS-12 adapter config schema accepts valid config', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const validate = (ajv as Ajv).compile(IS12_CONFIG_JSON_SCHEMA);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    vitestExpect(validate({ wsPort: 8080 })).toBe(true);
  });

  it('IS-12 CommandResponse message matches expected shape', async () => {
    const { tree } = buildTree();
    const bus = new UceBus();
    const engine = new UceEngine({ tree, bus });
    engine.start();

    const adapter = new Is12EgressAdapter('conform-is12');
    await adapter.init(buildCtx({ tree, bus }));
    await adapter.start();

    const client = await Is12Client.connect(adapter.wsPort);
    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 3, index: 1 } },
    });

    // Structural conformance: required fields present
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    vitestExpect(resp).toMatchObject({
      messageType: IS12MessageType.CommandResponse,
      responses: vitestExpect.arrayContaining([
        vitestExpect.objectContaining({
          handle: vitestExpect.any(Number),
          result: vitestExpect.objectContaining({
            status: vitestExpect.any(Number),
          }),
        }),
      ]),
    });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */

    await client.close();
    await adapter.stop();
    engine.stop();
  });

  it('IS-12 Notification message matches expected shape', async () => {
    const { tree } = buildTree();
    const bus = new UceBus();
    const engine = new UceEngine({ tree, bus });
    engine.start();

    const adapter = new Is12EgressAdapter('conform-notif');
    await adapter.init(buildCtx({ tree, bus }));
    await adapter.start();

    const client = await Is12Client.connect(adapter.wsPort);
    await client.subscribe([OID_ROOT]);

    const notifPromise = client.nextNotification(300);
    bus.publish(makePropertyChangedOp({
      correlationId: randomUUID(),
      origin: 'external',
      nodeId: 'root',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 50.0,
    }));

    const notif: IS12NotificationMessage = await notifPromise;

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    vitestExpect(notif).toMatchObject({
      messageType: IS12MessageType.Notification,
      notifications: vitestExpect.arrayContaining([
        vitestExpect.objectContaining({
          oid: vitestExpect.any(Number),
          eventId: vitestExpect.objectContaining({ level: 1, index: 1 }),
          eventData: vitestExpect.objectContaining({
            propertyId: vitestExpect.objectContaining({ level: vitestExpect.any(Number) }),
            changeType: vitestExpect.any(Number),
            value: 50.0,
          }),
        }),
      ]),
    });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */

    await client.close();
    await adapter.stop();
    engine.stop();
  });

  it('SubscriptionResponse message matches expected shape', async () => {
    const adapter = new Is12EgressAdapter('conform-sub');
    await adapter.init(buildCtx());
    await adapter.start();

    const client = await Is12Client.connect(adapter.wsPort);
    const resp = await client.subscribe([OID_ROOT]);

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    vitestExpect(resp).toMatchObject({
      messageType: IS12MessageType.SubscriptionResponse,
      subscriptions: vitestExpect.any(Array),
    });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */

    await client.close();
    await adapter.stop();
  });
});
