/**
 * E9 — Adapter Framework tests.
 * T1: Adapter & AdapterContext interfaces (fake adapter lifecycle)
 * T2: AdapterRegistry — register, multi-instance, unknown protocol
 * T3: AdapterOrchestrator — ordered init→start, reverse stop, rollback
 * T4: Implicit fan-out — shared bus/tree context wires all adapters automatically
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AdapterOrchestrator, OrchestratorError } from '../../src/adapters/AdapterOrchestrator.js';
import { AdapterRegistry, AdapterRegistryError } from '../../src/adapters/AdapterRegistry.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../src/engine/types/EntityRegistry.js';

import type {
  Adapter,
  AdapterContext,
  AdapterFactory,
  AdapterLogger,
  HealthStatus,
  JSONSchema,
} from '../../src/adapters/Adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(): AdapterContext {
  const tree = new InstanceTree();
  const root = new InstanceNodeImpl(
    { location: 'root', entity_def: 'Root', path: 'root' },
    [{ id: 'value', type: 'numeric', is_array: false, read_only: false, observable: true, nullable: false }],
    [],
  );
  tree.setRoot(root);
  return {
    bus: new UceBus(),
    tree,
    types: new DatatypeRegistry(),
    entities: new EntityRegistry(),
    logger: makeLogger(),
    config: {},
  };
}

function makeLogger(): AdapterLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/** Build a minimal fake Adapter that records lifecycle calls. */
function makeFakeAdapter(
  id: string,
  kind: 'ingress' | 'egress' = 'egress',
  opts: {
    initError?: Error;
    startError?: Error;
    stopError?: Error;
  } = {},
): Adapter & { calls: string[]; ctx: AdapterContext | null } {
  const calls: string[] = [];
  let ctx: AdapterContext | null = null;
  let _health: HealthStatus = { state: 'initialising' };

  return {
    id,
    kind,
    protocol: 'fake',
    calls,
    get ctx() { return ctx; },
    configSchema(): JSONSchema {
      return { type: 'object' };
    },
    init(c: AdapterContext): Promise<void> {
      calls.push('init');
      ctx = c;
      if (opts.initError !== undefined) return Promise.reject(opts.initError);
      _health = { state: 'healthy' };
      return Promise.resolve();
    },
    start(): Promise<void> {
      calls.push('start');
      if (opts.startError !== undefined) return Promise.reject(opts.startError);
      return Promise.resolve();
    },
    stop(): Promise<void> {
      calls.push('stop');
      if (opts.stopError !== undefined) return Promise.reject(opts.stopError);
      _health = { state: 'stopped' };
      return Promise.resolve();
    },
    health(): HealthStatus {
      return _health;
    },
  };
}

/** Minimal AdapterFactory that creates makeFakeAdapter instances. */
function makeFakeFactory(protocol = 'fake'): AdapterFactory {
  return {
    protocol,
    create(id: string, kind: 'ingress' | 'egress'): Adapter {
      return makeFakeAdapter(id, kind);
    },
  };
}

// ---------------------------------------------------------------------------
// E9.T1 — Adapter & AdapterContext interfaces
// ---------------------------------------------------------------------------

describe('E9.T1 — Adapter interface', () => {
  it('fake adapter implements the full Adapter contract', () => {
    const a = makeFakeAdapter('test-1', 'egress');
    expect(a.id).toBe('test-1');
    expect(a.kind).toBe('egress');
    expect(a.protocol).toBe('fake');
    expect(typeof a.configSchema).toBe('function');
    expect(typeof a.init).toBe('function');
    expect(typeof a.start).toBe('function');
    expect(typeof a.stop).toBe('function');
    expect(typeof a.health).toBe('function');
  });

  it('configSchema() returns a JSON Schema object', () => {
    const a = makeFakeAdapter('test-1');
    const schema = a.configSchema();
    expect(schema).toMatchObject({ type: 'object' });
  });

  it('health() returns initialising before init()', () => {
    const a = makeFakeAdapter('test-1');
    expect(a.health().state).toBe('initialising');
  });

  it('health() returns healthy after init()', async () => {
    const a = makeFakeAdapter('test-1');
    await a.init(makeContext());
    expect(a.health().state).toBe('healthy');
  });

  it('health() returns stopped after stop()', async () => {
    const a = makeFakeAdapter('test-1');
    await a.init(makeContext());
    await a.start();
    await a.stop();
    expect(a.health().state).toBe('stopped');
  });

  it('lifecycle runs in order: init → start → stop', async () => {
    const a = makeFakeAdapter('test-1');
    await a.init(makeContext());
    await a.start();
    await a.stop();
    expect(a.calls).toEqual(['init', 'start', 'stop']);
  });

  it('AdapterContext fields are accessible inside init()', async () => {
    const ctx = makeContext();
    const a = makeFakeAdapter('test-1');
    await a.init(ctx);
    expect(a.ctx).toBe(ctx);
  });
});

// ---------------------------------------------------------------------------
// E9.T2 — AdapterRegistry
// ---------------------------------------------------------------------------

describe('E9.T2 — AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('starts empty', () => {
    expect(registry.protocols()).toHaveLength(0);
  });

  it('registers a factory', () => {
    registry.register(makeFakeFactory('mqtt'));
    expect(registry.has('mqtt')).toBe(true);
  });

  it('has() returns false for unregistered protocol', () => {
    expect(registry.has('nmos-is12')).toBe(false);
  });

  it('protocols() lists all registered tokens', () => {
    registry.register(makeFakeFactory('mqtt'));
    registry.register(makeFakeFactory('nmos-is12'));
    expect(registry.protocols()).toContain('mqtt');
    expect(registry.protocols()).toContain('nmos-is12');
  });

  it('create() returns an Adapter instance', () => {
    registry.register(makeFakeFactory('mqtt'));
    const adapter = registry.create('ingress-1', 'ingress', 'mqtt', {});
    expect(adapter.id).toBe('ingress-1');
    expect(adapter.kind).toBe('ingress');
  });

  it('create() allows two instances of the same protocol', () => {
    const factory: AdapterFactory = {
      protocol: 'nmos-is12',
      create(id, kind) {
        return makeFakeAdapter(id, kind);
      },
    };
    registry.register(factory);
    const a1 = registry.create('egress-1', 'egress', 'nmos-is12', {});
    const a2 = registry.create('egress-2', 'egress', 'nmos-is12', {});
    expect(a1).not.toBe(a2);
    expect(a1.id).toBe('egress-1');
    expect(a2.id).toBe('egress-2');
  });

  it('create() throws AdapterRegistryError for unknown protocol', () => {
    expect(() => registry.create('x', 'egress', 'ghost', {})).toThrow(AdapterRegistryError);
  });

  it('error message names the missing protocol', () => {
    registry.register(makeFakeFactory('mqtt'));
    expect(() => registry.create('x', 'egress', 'ghost', {})).toThrow(/ghost/);
  });

  it('error message lists known protocols', () => {
    registry.register(makeFakeFactory('mqtt'));
    let msg = '';
    try {
      registry.create('x', 'egress', 'ghost', {});
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toMatch(/mqtt/);
  });

  it('registering same protocol twice replaces the factory', () => {
    const f1 = makeFakeFactory('mqtt');
    const f2: AdapterFactory = {
      protocol: 'mqtt',
      create(id, kind) { return makeFakeAdapter(id, kind); },
    };
    registry.register(f1);
    registry.register(f2);
    expect(registry.protocols().filter((p) => p === 'mqtt')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// E9.T3 — AdapterOrchestrator lifecycle
// ---------------------------------------------------------------------------

describe('E9.T3 — AdapterOrchestrator lifecycle', () => {
  it('initialises and starts adapters in order', async () => {
    const order: string[] = [];
    const a = makeFakeAdapter('a');
    const b = makeFakeAdapter('b');

    // Intercept calls to track global order
    const origAInit = a.init.bind(a);
    vi.spyOn(a, 'init').mockImplementation((ctx) => { order.push('a:init'); return origAInit(ctx); });
    const origAStart = a.start.bind(a);
    vi.spyOn(a, 'start').mockImplementation(() => { order.push('a:start'); return origAStart(); });
    const origBInit = b.init.bind(b);
    vi.spyOn(b, 'init').mockImplementation((ctx) => { order.push('b:init'); return origBInit(ctx); });
    const origBStart = b.start.bind(b);
    vi.spyOn(b, 'start').mockImplementation(() => { order.push('b:start'); return origBStart(); });

    const orch = new AdapterOrchestrator([a, b], makeContext());
    await orch.start();
    expect(order).toEqual(['a:init', 'b:init', 'a:start', 'b:start']);
  });

  it('stops adapters in reverse start order', async () => {
    const a = makeFakeAdapter('a');
    const b = makeFakeAdapter('b');
    const c = makeFakeAdapter('c');
    const orch = new AdapterOrchestrator([a, b, c], makeContext());
    await orch.start();

    const stopOrder: string[] = [];
    vi.spyOn(a, 'stop').mockImplementation(() => { stopOrder.push('a'); return Promise.resolve(); });
    vi.spyOn(b, 'stop').mockImplementation(() => { stopOrder.push('b'); return Promise.resolve(); });
    vi.spyOn(c, 'stop').mockImplementation(() => { stopOrder.push('c'); return Promise.resolve(); });

    await orch.stop();
    expect(stopOrder).toEqual(['c', 'b', 'a']);
  });

  it('rollback stops already-started adapters in reverse order when a start fails', async () => {
    const a = makeFakeAdapter('a');
    const b = makeFakeAdapter('b');
    const c = makeFakeAdapter('c', 'egress', { startError: new Error('start failed') });

    const stopOrder: string[] = [];
    vi.spyOn(a, 'stop').mockImplementation(() => { stopOrder.push('a'); return Promise.resolve(); });
    vi.spyOn(b, 'stop').mockImplementation(() => { stopOrder.push('b'); return Promise.resolve(); });
    vi.spyOn(c, 'stop').mockImplementation(() => { stopOrder.push('c'); return Promise.resolve(); });

    const orch = new AdapterOrchestrator([a, b, c], makeContext());
    await expect(orch.start()).rejects.toThrow(OrchestratorError);
    // a and b were started; c failed — rollback reverses: b then a
    expect(stopOrder).toEqual(['b', 'a']);
  });

  it('wraps init failure in OrchestratorError', async () => {
    const a = makeFakeAdapter('fail', 'egress', { initError: new Error('boom') });
    const orch = new AdapterOrchestrator([a], makeContext());
    await expect(orch.start()).rejects.toThrow(OrchestratorError);
    await expect(orch.start()).rejects.toThrow(/fail/);
  });

  it('wraps start failure in OrchestratorError naming the adapter', async () => {
    const a = makeFakeAdapter('boom-adapter', 'egress', { startError: new Error('no conn') });
    const orch = new AdapterOrchestrator([a], makeContext());
    await expect(orch.start()).rejects.toThrow(/boom-adapter/);
  });

  it('stop() collects errors and throws OrchestratorError', async () => {
    const a = makeFakeAdapter('a', 'egress', { stopError: new Error('fail-stop') });
    const orch = new AdapterOrchestrator([a], makeContext());
    await orch.start();
    await expect(orch.stop()).rejects.toThrow(OrchestratorError);
  });

  it('stop() continues stopping remaining adapters even after one fails', async () => {
    const a = makeFakeAdapter('a', 'egress', { stopError: new Error('fail') });
    const b = makeFakeAdapter('b');
    const orch = new AdapterOrchestrator([a, b], makeContext());
    await orch.start();

    const bStopped: string[] = [];
    vi.spyOn(b, 'stop').mockImplementation(() => { bStopped.push('b'); return Promise.resolve(); });

    await expect(orch.stop()).rejects.toThrow(OrchestratorError);
    expect(bStopped).toContain('b');
  });

  it('startedAdapters is empty before start()', () => {
    const orch = new AdapterOrchestrator([makeFakeAdapter('a')], makeContext());
    expect(orch.startedAdapters).toHaveLength(0);
  });

  it('startedAdapters contains all adapters after successful start()', async () => {
    const a = makeFakeAdapter('a');
    const b = makeFakeAdapter('b');
    const orch = new AdapterOrchestrator([a, b], makeContext());
    await orch.start();
    expect(orch.startedAdapters).toHaveLength(2);
  });

  it('startedAdapters is empty after stop()', async () => {
    const a = makeFakeAdapter('a');
    const orch = new AdapterOrchestrator([a], makeContext());
    await orch.start();
    await orch.stop();
    expect(orch.startedAdapters).toHaveLength(0);
  });

  it('healthSnapshot() returns health for all adapters', async () => {
    const a = makeFakeAdapter('a');
    const b = makeFakeAdapter('b');
    const orch = new AdapterOrchestrator([a, b], makeContext());
    await orch.start();
    const snap = orch.healthSnapshot();
    expect(snap.get('a')?.state).toBe('healthy');
    expect(snap.get('b')?.state).toBe('healthy');
  });

  it('healthSnapshot() works before start()', () => {
    const a = makeFakeAdapter('a');
    const orch = new AdapterOrchestrator([a], makeContext());
    const snap = orch.healthSnapshot();
    expect(snap.get('a')?.state).toBe('initialising');
  });

  it('rollback suppresses stop errors during rollback', async () => {
    const a = makeFakeAdapter('a', 'egress', { stopError: new Error('rollback-stop-fail') });
    const b = makeFakeAdapter('b', 'egress', { startError: new Error('start-fail') });
    const orch = new AdapterOrchestrator([a, b], makeContext());
    // rollback of 'a' will throw from stop() — should be suppressed, only start failure propagated
    await expect(orch.start()).rejects.toThrow(/b/);
  });
});

// ---------------------------------------------------------------------------
// E9.T4 — Implicit fan-out via shared bus/tree context
// ---------------------------------------------------------------------------

describe('E9.T4 — Implicit fan-out', () => {
  it('all adapters receive the same bus instance from context', async () => {
    const ctx = makeContext();
    const a = makeFakeAdapter('ingress-1', 'ingress');
    const b = makeFakeAdapter('egress-1', 'egress');
    const c = makeFakeAdapter('egress-2', 'egress');

    const orch = new AdapterOrchestrator([a, b, c], ctx);
    await orch.start();

    expect(a.ctx?.bus).toBe(ctx.bus);
    expect(b.ctx?.bus).toBe(ctx.bus);
    expect(c.ctx?.bus).toBe(ctx.bus);
  });

  it('all adapters share the same tree instance', async () => {
    const ctx = makeContext();
    const a = makeFakeAdapter('ingress-1', 'ingress');
    const b = makeFakeAdapter('egress-1', 'egress');

    const orch = new AdapterOrchestrator([a, b], ctx);
    await orch.start();

    expect(a.ctx?.tree).toBe(ctx.tree);
    expect(b.ctx?.tree).toBe(ctx.tree);
  });

  it('fan-out: PropertyChangedOp published by ingress is received by both egress adapters', async () => {
    const ctx = makeContext();

    const received1: unknown[] = [];
    const received2: unknown[] = [];

    // Egress adapters subscribe to bus during init
    const egress1: Adapter = {
      id: 'egress-1', kind: 'egress', protocol: 'fake',
      configSchema: () => ({}),
      init(c) { c.bus.subscribe({ op: 'propertyChanged' }, (op) => { received1.push(op); }); return Promise.resolve(); },
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      health: () => ({ state: 'healthy' }),
    };
    const egress2: Adapter = {
      id: 'egress-2', kind: 'egress', protocol: 'fake',
      configSchema: () => ({}),
      init(c) { c.bus.subscribe({ op: 'propertyChanged' }, (op) => { received2.push(op); }); return Promise.resolve(); },
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      health: () => ({ state: 'healthy' }),
    };

    const orch = new AdapterOrchestrator([egress1, egress2], ctx);
    await orch.start();

    // Ingress publishes a PropertyChangedOp on the shared bus
    ctx.bus.publish({
      op: 'propertyChanged',
      correlationId: 'c1',
      origin: 'ingress-1',
      ts: new Date().toISOString(),
      nodeId: 'root',
      property: 'value',
      changeType: 'valueChanged',
      value: 42,
    });

    // Both egress adapters should have received it exactly once
    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('fan-out: a second egress receives events without any routing config', async () => {
    const ctx = makeContext();
    const received: unknown[] = [];

    const lateEgress: Adapter = {
      id: 'egress-late', kind: 'egress', protocol: 'fake',
      configSchema: () => ({}),
      init(c) { c.bus.subscribe({ op: 'propertyChanged' }, (op) => { received.push(op); }); return Promise.resolve(); },
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      health: () => ({ state: 'healthy' }),
    };

    const orch = new AdapterOrchestrator([lateEgress], ctx);
    await orch.start();

    ctx.bus.publish({
      op: 'propertyChanged',
      correlationId: 'c2',
      origin: 'ingress-1',
      ts: new Date().toISOString(),
      nodeId: 'root',
      property: 'value',
      changeType: 'valueChanged',
      value: 99,
    });

    expect(received).toHaveLength(1);
  });
});
