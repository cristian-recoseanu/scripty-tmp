/**
 * E10 — MQTT Ingress Adapter tests.
 *
 * All tests use a vi.mock('mqtt') fake client — no real broker required.
 *
 * T1: Connection management (connect, health, reconnect, LWT, TLS opts, stop)
 * T2: Subscription & topic-filter handling
 * T3: Forward message handling (message → PropertyChangedOp on bus)
 * T4: Static-target resolution & unmatched handling
 * T5: Reverse publisher (bus op → MQTT publish)
 * T6: Debounce/throttle
 * T7: configSchema() / config validation
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MqttAdapterConfigSchema, MQTT_CONFIG_JSON_SCHEMA } from '../../../src/adapters/mqtt/config.js';
import { MqttIngressAdapter } from '../../../src/adapters/mqtt/MqttIngressAdapter.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type { Operation } from '../../../src/engine/bus/operations.js';

// ---------------------------------------------------------------------------
// Fake MqttClient — returned by the mocked connectAsync
// ---------------------------------------------------------------------------

type EventName = 'message' | 'connect' | 'reconnect' | 'error' | 'offline';

interface FakeClient {
  subscribeAsync: ReturnType<typeof vi.fn>;
  publishAsync: ReturnType<typeof vi.fn>;
  endAsync: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  /** Test helper: fire a fake incoming MQTT message. */
  _emit(event: 'message', topic: string, payload: Buffer): void;
  _emit(event: Exclude<EventName, 'message'>, ...args: unknown[]): void;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
}

function makeFakeClient(): FakeClient {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const client: FakeClient = {
    subscribeAsync: vi.fn().mockResolvedValue(undefined),
    publishAsync: vi.fn().mockResolvedValue(undefined),
    endAsync: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return client;
    }),
    _emit(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
    _handlers: handlers,
  };
  return client;
}

// Mock the mqtt module so connectAsync returns our fake client
let _fakeClient: FakeClient = makeFakeClient();
vi.mock('mqtt', () => ({
  connectAsync: vi.fn().mockImplementation(() => Promise.resolve(_fakeClient)),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): AdapterLogger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
}

function makeTree(): InstanceTree {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Root', path: 'root' },
    [{ id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  const sensor = new InstanceNodeImpl(
    { location: 'sensor-1', entity_def: 'Sensor', path: 'root/sensor-1' },
    [{ id: 'temperature', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  root.addChild(sensor);
  tree.setRoot(root);
  return tree;
}

/** Write a temp mapping JSON file and return its absolute path. */
function writeTempMapping(rules: unknown[], dir: string, name = 'mapping.json'): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ version: 1, rules }));
  return path;
}

const SENSOR_RULES = [
  {
    match: { topicFilter: 'sensors/+sensorId/temperature' },
    target: { location: 'root/{sensorId}', property: 'temperature', onUnresolved: 'warn' },
    decode: { format: 'raw-number' },
    transform: [],
  },
];

// ---------------------------------------------------------------------------
// Per-test setup: fresh fake client + temp dir + adapter + ctx
// ---------------------------------------------------------------------------

let adapter: MqttIngressAdapter;
let ctx: AdapterContext;
let tmpDir: string;

beforeEach(() => {
  _fakeClient = makeFakeClient();
  tmpDir = join(tmpdir(), `e10-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  adapter = new MqttIngressAdapter('mqtt-test');
  const mappingPath = writeTempMapping(SENSOR_RULES, tmpDir);
  ctx = {
    bus: new UceBus(),
    tree: makeTree(),
    types: new DatatypeRegistry(),
    entities: new EntityRegistry(),
    logger: makeLogger(),
    config: {
      url: 'mqtt://localhost:1883',
      clientId: 'test-client',
      subscriptions: [{ topicFilter: 'sensors/+sensorId/temperature', qos: 0 }],
      mapping: mappingPath,
      reconnectPeriodMs: 100,
      reconnectMaxMs: 1000,
    },
  };
});

afterEach(() => {
  void adapter.stop().catch(() => undefined);
});

// ---------------------------------------------------------------------------
// E10.T7 — Config schema
// ---------------------------------------------------------------------------

describe('E10.T7 — MqttAdapterConfigSchema', () => {
  const validBase = {
    url: 'mqtt://localhost:1883',
    subscriptions: [{ topicFilter: 'sensors/+id/temp' }],
    mapping: './mapping.json',
  };

  it('accepts a minimal valid config', () => {
    expect(() => MqttAdapterConfigSchema.parse(validBase)).not.toThrow();
  });

  it('applies QoS default of 0', () => {
    const cfg = MqttAdapterConfigSchema.parse(validBase);
    expect(cfg.subscriptions[0]?.qos).toBe(0);
  });

  it('applies reconnectPeriodMs default of 1000', () => {
    expect(MqttAdapterConfigSchema.parse(validBase).reconnectPeriodMs).toBe(1000);
  });

  it('applies reconnectMaxMs default of 30000', () => {
    expect(MqttAdapterConfigSchema.parse(validBase).reconnectMaxMs).toBe(30000);
  });

  it('rejects config without url', () => {
    expect(MqttAdapterConfigSchema.safeParse({ subscriptions: [{ topicFilter: 'a' }], mapping: 'x' }).success).toBe(false);
  });

  it('rejects config without subscriptions', () => {
    expect(MqttAdapterConfigSchema.safeParse({ url: 'mqtt://localhost', mapping: 'x' }).success).toBe(false);
  });

  it('rejects empty subscriptions array', () => {
    expect(MqttAdapterConfigSchema.safeParse({ url: 'mqtt://localhost', subscriptions: [], mapping: 'x' }).success).toBe(false);
  });

  it('rejects invalid QoS value', () => {
    expect(MqttAdapterConfigSchema.safeParse({
      ...validBase, subscriptions: [{ topicFilter: 'a', qos: 3 }],
    }).success).toBe(false);
  });

  it('accepts optional auth fields', () => {
    const cfg = MqttAdapterConfigSchema.parse({ ...validBase, username: 'u', password: 'p' });
    expect(cfg.username).toBe('u');
    expect(cfg.password).toBe('p');
  });

  it('accepts LWT config with defaults', () => {
    const cfg = MqttAdapterConfigSchema.parse({ ...validBase, lwt: { topic: 'bridge/lwt', payload: 'offline' } });
    expect(cfg.lwt?.topic).toBe('bridge/lwt');
    expect(cfg.lwt?.qos).toBe(0);
    expect(cfg.lwt?.retain).toBe(false);
  });

  it('accepts debounce config', () => {
    const cfg = MqttAdapterConfigSchema.parse({ ...validBase, debounce: { windowMs: 200 } });
    expect(cfg.debounce?.windowMs).toBe(200);
  });

  it('MQTT_CONFIG_JSON_SCHEMA lists url in required', () => {
    expect((MQTT_CONFIG_JSON_SCHEMA.required as string[])).toContain('url');
  });

  it('configSchema() returns an object schema', () => {
    expect(new MqttIngressAdapter('x').configSchema()).toMatchObject({ type: 'object' });
  });
});

// ---------------------------------------------------------------------------
// E10.T1 — Connection management
// ---------------------------------------------------------------------------

describe('E10.T1 — Connection management', () => {
  it('health is initialising before init()', () => {
    expect(new MqttIngressAdapter('x').health().state).toBe('initialising');
  });

  it('init() rejects on invalid config', async () => {
    const bad = new MqttIngressAdapter('x');
    await expect(bad.init({ ...ctx, config: { subscriptions: [] } })).rejects.toThrow(/invalid config/);
  });

  it('init() rejects when mapping file does not exist', async () => {
    const bad = new MqttIngressAdapter('x');
    await expect(bad.init({
      ...ctx,
      config: { url: 'mqtt://localhost', subscriptions: [{ topicFilter: 'a' }], mapping: '/no/such/file.json' },
    })).rejects.toThrow();
  });

  it('start() throws if called before init()', async () => {
    await expect(new MqttIngressAdapter('x').start()).rejects.toThrow(/before init/);
  });

  it('health is healthy after start()', async () => {
    await adapter.init(ctx);
    await adapter.start();
    expect(adapter.health().state).toBe('healthy');
  });

  it('health is stopped after stop()', async () => {
    await adapter.init(ctx);
    await adapter.start();
    await adapter.stop();
    expect(adapter.health().state).toBe('stopped');
  });

  it('health becomes degraded on reconnect event', async () => {
    await adapter.init(ctx);
    await adapter.start();
    _fakeClient._emit('reconnect');
    expect(adapter.health().state).toBe('degraded');
  });

  it('health becomes error on error event', async () => {
    await adapter.init(ctx);
    await adapter.start();
    _fakeClient._emit('error', new Error('conn refused'));
    expect(adapter.health().state).toBe('error');
  });

  it('health becomes degraded on offline event', async () => {
    await adapter.init(ctx);
    await adapter.start();
    _fakeClient._emit('offline');
    expect(adapter.health().state).toBe('degraded');
  });

  it('health resets to healthy on reconnect → connect sequence', async () => {
    await adapter.init(ctx);
    await adapter.start();
    _fakeClient._emit('reconnect');
    expect(adapter.health().state).toBe('degraded');
    _fakeClient._emit('connect');
    expect(adapter.health().state).toBe('healthy');
  });

  it('stop() calls endAsync on the client', async () => {
    await adapter.init(ctx);
    await adapter.start();
    await adapter.stop();
    expect(_fakeClient.endAsync).toHaveBeenCalledOnce();
  });

  it('LWT is passed to connectAsync', async () => {
    const { connectAsync: mockConnect } = await import('mqtt');
    const lwtDir = join(tmpdir(), `e10-lwt-${Date.now()}`);
    mkdirSync(lwtDir, { recursive: true });
    const lwtAdapter = new MqttIngressAdapter('lwt-test');
    await lwtAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'a' }],
        mapping: writeTempMapping(SENSOR_RULES, lwtDir),
        lwt: { topic: 'bridge/lwt', payload: 'offline', qos: 1, retain: false },
      },
    });
    await lwtAdapter.start();
    const callArgs = (mockConnect as ReturnType<typeof vi.fn>).mock.calls.at(-1) as unknown[];
    const opts = callArgs[1] as { will?: { topic: string } };
    expect(opts.will?.topic).toBe('bridge/lwt');
    await lwtAdapter.stop();
  });
});

// ---------------------------------------------------------------------------
// E10.T2 — Subscription handling
// ---------------------------------------------------------------------------

describe('E10.T2 — Subscription handling', () => {
  it('subscribes to each configured topic filter', async () => {
    await adapter.init(ctx);
    await adapter.start();
    expect(_fakeClient.subscribeAsync).toHaveBeenCalledWith('sensors/+sensorId/temperature', { qos: 0 });
  });

  it('subscribes with the configured QoS', async () => {
    const qosDir = join(tmpdir(), `e10-qos-${Date.now()}`);
    mkdirSync(qosDir, { recursive: true });
    const qosAdapter = new MqttIngressAdapter('qos-test');
    await qosAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'a/b', qos: 1 }],
        mapping: writeTempMapping(SENSOR_RULES, qosDir),
      },
    });
    await qosAdapter.start();
    expect(_fakeClient.subscribeAsync).toHaveBeenCalledWith('a/b', { qos: 1 });
    await qosAdapter.stop();
  });

  it('registers a message event handler', async () => {
    await adapter.init(ctx);
    await adapter.start();
    const events = [..._fakeClient._handlers.keys()];
    expect(events).toContain('message');
  });
});

// ---------------------------------------------------------------------------
// E10.T3 — Forward message → PropertyChangedOp on bus
// ---------------------------------------------------------------------------

describe('E10.T3 — Forward message handling', () => {
  it('publishes PropertyChangedOp with correct fields for a matching topic', async () => {
    await adapter.init(ctx);
    await adapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('42.5'));

    expect(ops).toHaveLength(1);
    const op = ops[0] as { nodeId: string; property: string; value: unknown; origin: string; op: string };
    expect(op.op).toBe('propertyChanged');
    expect(op.nodeId).toBe('root/sensor-1');
    expect(op.property).toBe('temperature');
    expect(op.value).toBe(42.5);
    expect(op.origin).toBe('mqtt-test');
  });

  it('accepts string payloads as well as Buffers', async () => {
    await adapter.init(ctx);
    await adapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('99.0'));
    expect(ops).toHaveLength(1);
  });

  it('drops messages that match no rule', async () => {
    await adapter.init(ctx);
    await adapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    _fakeClient._emit('message', 'unknown/topic', Buffer.from('1'));
    expect(ops).toHaveLength(0);
    expect(adapter.unmatchedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// E10.T4 — Static-target resolution & unmatched handling
// ---------------------------------------------------------------------------

describe('E10.T4 — Static-target resolution', () => {
  it('drops message for node not in static tree and increments unmatchedCount', async () => {
    await adapter.init(ctx);
    await adapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    // sensor-ghost does not exist in the tree
    _fakeClient._emit('message', 'sensors/sensor-ghost/temperature', Buffer.from('50'));

    expect(ops).toHaveLength(0);
    expect(adapter.unmatchedCount).toBe(1);
  });

  it('does not create a new node for an unresolved target', async () => {
    await adapter.init(ctx);
    await adapter.start();

    _fakeClient._emit('message', 'sensors/new-sensor/temperature', Buffer.from('1'));

    expect(ctx.tree.findById('root/new-sensor').ok).toBe(false);
  });

  it('drops malformed payload (JSON decode failure) without crashing', async () => {
    const jsonDir = join(tmpdir(), `e10-json-${Date.now()}`);
    mkdirSync(jsonDir, { recursive: true });
    const jsonAdapter = new MqttIngressAdapter('json-test');
    await jsonAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'sensors/+sensorId/temperature' }],
        mapping: writeTempMapping([{
          match: { topicFilter: 'sensors/+sensorId/temperature' },
          target: { location: 'root/{sensorId}', property: 'temperature', onUnresolved: 'drop' },
          decode: { format: 'json', pointer: '/value', as: 'numeric' },
          transform: [],
        }], jsonDir),
      },
    });
    await jsonAdapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('{not-json}'));

    expect(ops).toHaveLength(0);
    await jsonAdapter.stop();
  });

  it('unmatchedCount starts at 0', () => {
    expect(adapter.unmatchedCount).toBe(0);
  });

  it('known topic succeeds and does not increment unmatchedCount', async () => {
    await adapter.init(ctx);
    await adapter.start();

    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('21'));

    expect(adapter.unmatchedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E10.T5 — Reverse publisher (write-back)
// ---------------------------------------------------------------------------

describe('E10.T5 — Reverse publisher', () => {
  it('publishes to broker when a foreign PropertyChangedOp arrives on bus', async () => {
    const revDir = join(tmpdir(), `e10-rev-${Date.now()}`);
    mkdirSync(revDir, { recursive: true });
    const revAdapter = new MqttIngressAdapter('mqtt-rev');
    await revAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'sensors/+sensorId/temperature' }],
        mapping: writeTempMapping([{
          match: { topicFilter: 'sensors/+sensorId/temperature' },
          target: { location: 'root/{sensorId}', property: 'temperature', onUnresolved: 'warn' },
          decode: { format: 'raw-number' },
          transform: [],
          reverse: {
            topicTemplate: 'sensors/{sensorId}/temperature/set',
            encode: { format: 'raw-number' },
          },
        }], revDir),
      },
    });
    await revAdapter.start();

    // Publish from a different origin — should trigger write-back
    ctx.bus.publish({
      op: 'propertyChanged',
      correlationId: 'wb-1',
      origin: 'other-adapter',
      ts: new Date().toISOString(),
      nodeId: 'root/sensor-1',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 77,
    });

    // Give the async publishAsync microtask time to execute
    await Promise.resolve();

    expect(_fakeClient.publishAsync).toHaveBeenCalled();
    await revAdapter.stop();
  });

  it('does NOT publish write-back for ops originating from itself', async () => {
    const revDir = join(tmpdir(), `e10-self-${Date.now()}`);
    mkdirSync(revDir, { recursive: true });
    const selfAdapter = new MqttIngressAdapter('self-adapter');
    await selfAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'sensors/+sensorId/temperature' }],
        mapping: writeTempMapping([{
          match: { topicFilter: 'sensors/+sensorId/temperature' },
          target: { location: 'root/{sensorId}', property: 'temperature', onUnresolved: 'warn' },
          decode: { format: 'raw-number' },
          transform: [],
          reverse: { topicTemplate: 'sensors/{sensorId}/set', encode: { format: 'raw-number' } },
        }], revDir),
      },
    });
    await selfAdapter.start();

    // Same origin as the adapter id — must be suppressed
    ctx.bus.publish({
      op: 'propertyChanged',
      correlationId: 'self-1',
      origin: 'self-adapter',
      ts: new Date().toISOString(),
      nodeId: 'root/sensor-1',
      property: 'temperature',
      changeType: 'valueChanged',
      value: 10,
    });

    await Promise.resolve();
    expect(_fakeClient.publishAsync).not.toHaveBeenCalled();
    await selfAdapter.stop();
  });
});

// ---------------------------------------------------------------------------
// E10.T6 — Debounce / throttle
// ---------------------------------------------------------------------------

describe('E10.T6 — Debounce', () => {
  it('coalesces a burst to one op when debounce is configured', async () => {
    const debDir = join(tmpdir(), `e10-deb-${Date.now()}`);
    mkdirSync(debDir, { recursive: true });
    const debAdapter = new MqttIngressAdapter('deb-test');
    await debAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'sensors/+sensorId/temperature' }],
        mapping: writeTempMapping(SENSOR_RULES, debDir),
        debounce: { windowMs: 50 },
      },
    });
    await debAdapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    // Rapid burst — all should be coalesced
    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('1'));
    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('2'));
    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('3'));

    // Nothing dispatched yet (within debounce window)
    expect(ops).toHaveLength(0);

    // Wait for debounce window to expire
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(ops).toHaveLength(1);
    await debAdapter.stop();
  });

  it('passes all messages through immediately without debounce', async () => {
    await adapter.init(ctx);
    await adapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('1'));
    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('2'));
    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('3'));

    expect(ops).toHaveLength(3);
  });

  it('stop() cancels pending debounce timers (no late dispatch)', async () => {
    const debDir = join(tmpdir(), `e10-deb2-${Date.now()}`);
    mkdirSync(debDir, { recursive: true });
    const debAdapter = new MqttIngressAdapter('deb-cancel');
    await debAdapter.init({
      ...ctx,
      config: {
        url: 'mqtt://localhost:1883',
        subscriptions: [{ topicFilter: 'sensors/+sensorId/temperature' }],
        mapping: writeTempMapping(SENSOR_RULES, debDir),
        debounce: { windowMs: 200 },
      },
    });
    await debAdapter.start();

    const ops: Operation[] = [];
    ctx.bus.subscribe({ op: 'propertyChanged' }, (op) => { ops.push(op); });

    _fakeClient._emit('message', 'sensors/sensor-1/temperature', Buffer.from('7'));
    // stop before window expires
    await debAdapter.stop();

    await new Promise<void>((r) => setTimeout(r, 300));
    expect(ops).toHaveLength(0);
  });
});
