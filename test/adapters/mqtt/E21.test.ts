/**
 * E21 — MQTT Egress adapter unit tests.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { stringify } from 'yaml';

import { MqttEgressAdapter } from '../../../src/adapters/mqtt/MqttEgressAdapter.js';
import { makePropertyChangedOp } from '../../../src/engine/bus/operations.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type { PropertyChangedOp } from '../../../src/engine/bus/operations.js';

type FakeClient = {
  published: { topic: string; payload: string; opts?: unknown }[];
  on: ReturnType<typeof vi.fn>;
  subscribeAsync: ReturnType<typeof vi.fn>;
  publishAsync: ReturnType<typeof vi.fn>;
  endAsync: ReturnType<typeof vi.fn>;
  _emit: (e: string, ...a: unknown[]) => void;
  _handlers: Map<string, ((...a: unknown[]) => void)[]>;
};

function makeFake(): FakeClient {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const published: FakeClient['published'] = [];
  const c: FakeClient = {
    published,
    subscribeAsync: vi.fn().mockResolvedValue(undefined),
    publishAsync: vi.fn().mockImplementation((t: string, p: string, o?: unknown) => {
      published.push({ topic: t, payload: p.toString(), opts: o });
      return Promise.resolve();
    }),
    endAsync: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((e: string, h: (...a: unknown[]) => void) => {
      const l = handlers.get(e) ?? [];
      l.push(h);
      handlers.set(e, l);
      return c;
    }),
    _emit(e: string, ...a: unknown[]) {
      for (const h of handlers.get(e) ?? []) h(...a);
    },
    _handlers: handlers,
  };
  return c;
}

let fake = makeFake();
vi.mock('mqtt', () => ({
  connectAsync: vi.fn().mockImplementation(() => Promise.resolve(fake)),
}));

const logger: AdapterLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function writeMapping(dir: string, singleTopic = false): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'egress.mqtt.yaml');
  const topic = singleTopic ? 'bridge/root/userLabel' : 'bridge/root/userLabel/set';
  const reverseTopic = 'bridge/root/userLabel';
  writeFileSync(p, stringify({
    version: 1,
    rules: [{
      match: { topicFilter: topic },
      target: { location: 'root', property: 'userLabel' },
      decode: { format: 'raw-string' },
      transform: [],
      reverse: { topicTemplate: reverseTopic, writeStrategy: 'single', encode: { format: 'raw-string' } },
    }],
  }));
  return p;
}

describe('E21 — MqttEgressAdapter', () => {
  let adapter: MqttEgressAdapter;
  let bus: UceBus;
  let ctx: AdapterContext;

  beforeEach(async () => {
    fake = makeFake();
    const tree = new InstanceTree();
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    root.setProperty('userLabel', 'hello');
    tree.setRoot(root);
    bus = new UceBus();
    const mapping = writeMapping(join(tmpdir(), `mqtt-eg-${Date.now()}`));
    adapter = new MqttEgressAdapter('mqtt-out');
    ctx = {
      bus, tree, types: new DatatypeRegistry(), entities: new EntityRegistry(), logger,
      config: {
        url: 'mqtt://localhost:1883',
        mapping,
        subscriptions: [{ topicFilter: 'bridge/root/userLabel/set', qos: 1 }],
        publish: { qos: 1, retain: true },
      },
    };
    await adapter.init(ctx);
    await adapter.start();
    fake.published.length = 0;
  });

  afterEach(async () => {
    await adapter?.stop();
  });

  it('publishes UCE changes to outbound topic with retain', () => {
    bus.publish(makePropertyChangedOp({
      origin: 'is12-ingress',
      nodeId: 'root',
      property: 'userLabel',
      value: 'published-val',
    }));
    const pub = fake.published.find((p) => p.topic === 'bridge/root/userLabel');
    expect(pub?.payload).toBe('published-val');
    expect((pub?.opts as { retain?: boolean })?.retain).toBe(true);
  });

  it('maps inbound set-topic to bus PropertyChangedOp', () => {
    const received: PropertyChangedOp[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op as PropertyChangedOp));
    fake._emit('message', 'bridge/root/userLabel/set', Buffer.from('from-set'));
    expect(received.some((o) => o.origin === 'mqtt-out' && o.value === 'from-set')).toBe(true);
  });

  it('publishes state topic after inbound set-topic write (split-topic pattern)', () => {
    fake.published.length = 0;
    fake._emit('message', 'bridge/root/userLabel/set', Buffer.from('from-set'));
    const statePub = fake.published.find((p) => p.topic === 'bridge/root/userLabel');
    expect(statePub?.payload).toBe('from-set');
    expect((statePub?.opts as { retain?: boolean })?.retain).toBe(true);
  });

  it('suppresses echo when set-topic repeats a value just written', () => {
    const received: PropertyChangedOp[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op as PropertyChangedOp));
    fake._emit('message', 'bridge/root/userLabel/set', Buffer.from('echo-val'));
    fake._emit('message', 'bridge/root/userLabel/set', Buffer.from('echo-val'));
    expect(received.filter((o) => o.value === 'echo-val')).toHaveLength(1);
  });

  it('suppresses echo when outbound publish is received on the same subscribed topic', async () => {
    await adapter.stop();
    fake = makeFake();
    const singleTopic = 'bridge/root/userLabel';
    const single = new MqttEgressAdapter('mqtt-single');
    const mapping = writeMapping(join(tmpdir(), `mqtt-single-${Date.now()}`), true);
    const localBus = new UceBus();
    await single.init({
      bus: localBus, tree: ctx.tree, types: ctx.types, entities: ctx.entities, logger: ctx.logger,
      config: {
        url: 'mqtt://localhost:1883',
        mapping,
        subscriptions: [{ topicFilter: singleTopic, qos: 1 }],
        publish: { qos: 1, retain: true },
      },
    });
    await single.start();
    fake.published.length = 0;

    const received: PropertyChangedOp[] = [];
    localBus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op as PropertyChangedOp));

    localBus.publish(makePropertyChangedOp({
      origin: 'is12-ingress',
      nodeId: 'root',
      property: 'userLabel',
      value: 'outbound-echo',
    }));

    expect(fake.published.some((p) => p.topic === singleTopic && p.payload === 'outbound-echo')).toBe(true);

    fake._emit('message', singleTopic, Buffer.from('outbound-echo'));
    expect(received.filter((o) => o.origin === 'mqtt-single')).toHaveLength(0);

    await single.stop();
    adapter = new MqttEgressAdapter('mqtt-out');
    await adapter.init(ctx);
    await adapter.start();
    fake.published.length = 0;
  });

  it('logs publish failures without throwing', () => {
    fake.publishAsync.mockRejectedValueOnce(new Error('broker down'));
    bus.publish(makePropertyChangedOp({
      origin: 'is12-ingress',
      nodeId: 'root',
      property: 'userLabel',
      value: 'x',
    }));
    expect(fake.publishAsync).toHaveBeenCalled();
  });

  it('rejects invalid config', async () => {
    const bad = new MqttEgressAdapter('bad');
    await expect(bad.init({ ...ctx, config: { url: 'not-a-url', mapping: '/x' } }))
      .rejects.toThrow(/invalid config/);
  });

  it('updates health on broker reconnect/offline/error events', () => {
    fake._emit('reconnect');
    expect(adapter.health().state).toBe('degraded');
    fake._emit('offline');
    expect(adapter.health().detail).toBe('offline');
    fake._emit('error', new Error('broker fault'));
    expect(adapter.health().state).toBe('error');
    fake._emit('connect');
    expect(adapter.health().state).toBe('healthy');
  });

  it('throws when start() is called before init()', async () => {
    const bare = new MqttEgressAdapter('bare');
    await expect(bare.start()).rejects.toThrow(/before init/);
  });

  it('ignores inbound messages that do not match any rule', () => {
    const received: PropertyChangedOp[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op as PropertyChangedOp));
    fake._emit('message', 'unknown/topic', Buffer.from('x'));
    expect(received).toHaveLength(0);
  });

  it('passes optional broker credentials and LWT into mqtt client options', async () => {
    await adapter.stop();
    fake = makeFake();
    const creds = new MqttEgressAdapter('creds');
    const mapping = writeMapping(join(tmpdir(), `mqtt-creds-${Date.now()}`));
    await creds.init({
      bus, tree: ctx.tree, types: ctx.types, entities: ctx.entities, logger: ctx.logger,
      config: {
        url: 'mqtt://localhost:1883',
        mapping,
        clientId: 'bridge-egress',
        username: 'user',
        password: 'secret',
        lwt: { topic: 'bridge/status', payload: 'offline', qos: 1, retain: true },
        subscriptions: [{ topicFilter: 'bridge/root/userLabel/set', qos: 1 }],
        publish: { qos: 1, retain: true },
      },
    });
    await creds.start();
    const { connectAsync } = await import('mqtt');
    expect(connectAsync).toHaveBeenCalled();
    await creds.stop();
    adapter = new MqttEgressAdapter('mqtt-out');
    await adapter.init(ctx);
    await adapter.start();
    fake.published.length = 0;
  });

  it('clears pending debounce timer when messages arrive in burst', async () => {
    await adapter.stop();
    vi.useFakeTimers();
    fake = makeFake();
    const debounced = new MqttEgressAdapter('debounced2');
    const mapping = writeMapping(join(tmpdir(), `deb2-${Date.now()}`));
    const localBus = new UceBus();
    await debounced.init({
      bus: localBus, tree: ctx.tree, types: ctx.types, entities: ctx.entities, logger: ctx.logger,
      config: {
        url: 'mqtt://localhost:1883',
        mapping,
        subscriptions: [{ topicFilter: 'bridge/root/userLabel/set', qos: 0 }],
        publish: { qos: 0, retain: false },
        debounce: { windowMs: 100 },
      },
    });
    await debounced.start();
    const received: PropertyChangedOp[] = [];
    localBus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op as PropertyChangedOp));
    fake._emit('message', 'bridge/root/userLabel/set', Buffer.from('a'));
    await vi.advanceTimersByTimeAsync(40);
    fake._emit('message', 'bridge/root/userLabel/set', Buffer.from('b'));
    await vi.advanceTimersByTimeAsync(40);
    expect(received).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(received).toHaveLength(1);
    expect(received[0]?.value).toBe('b');
    await debounced.stop();
    vi.useRealTimers();
    await adapter.start();
  });
});
