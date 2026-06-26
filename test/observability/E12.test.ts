/**
 * E12.T1 — Structured logger (BridgeLogger / pino).
 * E12.T2 — Audit logging (AuditLogger).
 * E12.T3 — Metrics & health (MetricsCollector, HealthAggregator, /healthz).
 * E12.T4 — Record & replay (Recorder, Replayer).
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type pino from 'pino';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { HealthStatus , Adapter } from '../../src/adapters/Adapter.js';
import { makePropertyChangedOp, makeSetPropertyOp, makeMethodInvokeOp } from '../../src/engine/bus/operations.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { AuditLogger } from '../../src/observability/AuditLogger.js';
import { BridgeLogger } from '../../src/observability/BridgeLogger.js';
import { MetricsCollector, HealthAggregator } from '../../src/observability/MetricsCollector.js';
import { Recorder, Replayer } from '../../src/observability/RecordReplay.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const d = join(tmpdir(), `e12-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Capture pino output to a string array. */
function makeCapture(): { lines: string[]; dest: pino.DestinationStream } {
  const lines: string[] = [];
  const dest: pino.DestinationStream = {
    write(chunk: string) {
      lines.push(chunk.trim());
      return true;
    },
  };
  return { lines, dest };
}

function makeOp(overrides: Partial<Parameters<typeof makePropertyChangedOp>[0]> = {}) {
  return makePropertyChangedOp({
    correlationId: 'cid-1',
    origin: 'test',
    nodeId: 'root/sensor',
    property: 'temperature',
    changeType: 'valueChanged',
    value: 42.0,
    ...overrides,
  });
}

/** Minimal fake Adapter for health tests. */
function makeAdapter(id: string, state: HealthStatus['state']): Adapter {
  return {
    id,
    kind: 'egress' as const,
    protocol: 'test',
    configSchema: () => ({}),
    init: async () => {},
    start: async () => {},
    stop: async () => {},
    health: () => ({ state }),
  };
}

// ===========================================================================
// E12.T1 — BridgeLogger
// ===========================================================================

describe('E12.T1 — BridgeLogger', () => {
  it('emits JSON lines at the configured level', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'debug', destination: dest });
    logger.info('hello world');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { msg: string; level: number };
    expect(parsed.msg).toBe('hello world');
    expect(parsed.level).toBe(30); // pino level 30 = info
  });

  it('does not emit messages below the configured level', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'warn', destination: dest });
    logger.debug('should be suppressed');
    logger.info('also suppressed');
    expect(lines).toHaveLength(0);
  });

  it('emits warn and error when level=warn', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'warn', destination: dest });
    logger.warn('watch out');
    logger.error('oh no');
    expect(lines).toHaveLength(2);
  });

  it('redacts password fields', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'info', destination: dest });
    logger.info('connecting', { password: 'secret123', host: 'localhost' });
    const parsed = JSON.parse(lines[0]!) as { password: string; host: string };
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.host).toBe('localhost');
  });

  it('redacts token fields', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'info', destination: dest });
    logger.info('auth', { token: 'abc.def.ghi', user: 'alice' });
    const parsed = JSON.parse(lines[0]!) as { token: string; user: string };
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.user).toBe('alice');
  });

  it('does not redact when disableRedaction=true', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'info', destination: dest, disableRedaction: true });
    logger.info('test', { password: 'visible', token: 'tok' });
    const parsed = JSON.parse(lines[0]!) as { password: string; token: string };
    expect(parsed.password).toBe('visible');
    expect(parsed.token).toBe('tok');
  });

  it('forAdapter() returns an AdapterLogger bound to adapterId', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'info', destination: dest });
    const adapterLog = logger.forAdapter('my-adapter');
    adapterLog.info('started');
    const parsed = JSON.parse(lines[0]!) as { adapterId: string; msg: string };
    expect(parsed.adapterId).toBe('my-adapter');
    expect(parsed.msg).toBe('started');
  });

  it('forAdapter() implements all four AdapterLogger methods', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'debug', destination: dest });
    const al = logger.forAdapter('x');
    al.debug('dbg'); al.info('inf'); al.warn('wrn'); al.error('err');
    expect(lines).toHaveLength(4);
  });

  it('setLevel() changes the active log level', () => {
    const { lines, dest } = makeCapture();
    const logger = new BridgeLogger({ level: 'warn', destination: dest });
    logger.debug('no'); // suppressed
    logger.setLevel('debug');
    logger.debug('yes');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { msg: string };
    expect(parsed.msg).toBe('yes');
  });

  it('level getter returns current level', () => {
    const logger = new BridgeLogger({ level: 'error' });
    expect(logger.level).toBe('error');
  });
});

// ===========================================================================
// E12.T2 — AuditLogger
// ===========================================================================

describe('E12.T2 — AuditLogger', () => {
  let bus: UceBus;
  let lines: string[];
  let logger: BridgeLogger;
  let audit: AuditLogger;

  beforeEach(() => {
    bus = new UceBus();
    const capture = makeCapture();
    lines = capture.lines;
    logger = new BridgeLogger({ level: 'debug', destination: capture.dest });
    audit = new AuditLogger(logger);
  });

  afterEach(() => {
    audit.detach();
  });

  it('attach() subscribes and receives propertyChanged ops', () => {
    audit.attach(bus);
    bus.publish(makeOp());
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { msg: string; correlationId: string };
    expect(parsed.msg).toBe('audit:propertyChanged');
    expect(parsed.correlationId).toBe('cid-1');
  });

  it('logs nodeId and property in propertyChanged audit', () => {
    audit.attach(bus);
    bus.publish(makeOp({ nodeId: 'root/sensor', property: 'temperature' }));
    const parsed = JSON.parse(lines[0]!) as { nodeId: string; property: string };
    expect(parsed.nodeId).toBe('root/sensor');
    expect(parsed.property).toBe('temperature');
  });

  it('logs setProperty ops', () => {
    audit.attach(bus);
    bus.publish(makeSetPropertyOp({ correlationId: 'c2', origin: 'ctrl', nodeId: 'root', property: 'x', value: 1 }));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { msg: string };
    expect(parsed.msg).toBe('audit:setProperty');
  });

  it('logs methodInvoke ops', () => {
    audit.attach(bus);
    bus.publish(makeMethodInvokeOp({ correlationId: 'c3', origin: 'test', nodeId: 'root', methodId: 'reset', args: {} }));
    const parsed = JSON.parse(lines[0]!) as { msg: string; methodId: string };
    expect(parsed.msg).toBe('audit:methodInvoke');
    expect(parsed.methodId).toBe('reset');
  });

  it('detach() stops receiving ops', () => {
    audit.attach(bus);
    audit.detach();
    bus.publish(makeOp());
    expect(lines).toHaveLength(0);
  });

  it('attach() is idempotent — second call has no effect', () => {
    audit.attach(bus);
    audit.attach(bus); // should not double-subscribe
    bus.publish(makeOp());
    expect(lines).toHaveLength(1);
  });

  it('isAttached reflects subscription state', () => {
    expect(audit.isAttached).toBe(false);
    audit.attach(bus);
    expect(audit.isAttached).toBe(true);
    audit.detach();
    expect(audit.isAttached).toBe(false);
  });

  it('correlationId is propagated through multiple ops', () => {
    audit.attach(bus);
    const cid = 'trace-xyz';
    bus.publish(makeOp({ correlationId: cid }));
    bus.publish(makeSetPropertyOp({ correlationId: cid, origin: 'ctrl', nodeId: 'root', property: 'v', value: 1 }));
    const ids = lines.map((l) => (JSON.parse(l) as { correlationId: string }).correlationId);
    expect(ids).toEqual([cid, cid]);
  });
});

// ===========================================================================
// E12.T3 — MetricsCollector
// ===========================================================================

describe('E12.T3 — MetricsCollector', () => {
  let bus: UceBus;
  let mc: MetricsCollector;

  beforeEach(() => {
    bus = new UceBus();
    mc = new MetricsCollector();
    mc.attach(bus);
  });

  afterEach(() => {
    mc.detach();
  });

  it('counts propertyChanged ops', () => {
    bus.publish(makeOp());
    bus.publish(makeOp());
    expect(mc.counts.propertyChanged).toBe(2);
  });

  it('counts setProperty ops', () => {
    bus.publish(makeSetPropertyOp({ correlationId: 'c', origin: 'o', nodeId: 'n', property: 'p', value: 1 }));
    expect(mc.counts.setProperty).toBe(1);
  });

  it('counts methodInvoke ops', () => {
    bus.publish(makeMethodInvokeOp({ correlationId: 'c', origin: 'o', nodeId: 'n', methodId: 'm', args: {} }));
    expect(mc.counts.methodInvoke).toBe(1);
  });

  it('incrementErrors() increments error counter', () => {
    mc.incrementErrors();
    mc.incrementErrors();
    expect(mc.counts.errors).toBe(2);
  });

  it('reset() zeroes all counters', () => {
    bus.publish(makeOp());
    mc.incrementErrors();
    mc.reset();
    const c = mc.counts;
    expect(c.propertyChanged).toBe(0);
    expect(c.errors).toBe(0);
  });

  it('attach() is idempotent', () => {
    mc.attach(bus); // second call
    bus.publish(makeOp());
    expect(mc.counts.propertyChanged).toBe(1);
  });

  it('detach() stops counting', () => {
    mc.detach();
    bus.publish(makeOp());
    expect(mc.counts.propertyChanged).toBe(0);
  });

  it('isAttached reflects subscription state', () => {
    expect(mc.isAttached).toBe(true);
    mc.detach();
    expect(mc.isAttached).toBe(false);
  });
});

// ===========================================================================
// E12.T3 — HealthAggregator
// ===========================================================================

describe('E12.T3 — HealthAggregator', () => {
  let ha: HealthAggregator;

  beforeEach(() => {
    ha = new HealthAggregator();
  });

  it('snapshot() returns ok when all adapters healthy', () => {
    ha.register(makeAdapter('a', 'healthy'));
    ha.register(makeAdapter('b', 'healthy'));
    expect(ha.snapshot().status).toBe('ok');
  });

  it('snapshot() returns degraded when any adapter is degraded', () => {
    ha.register(makeAdapter('a', 'healthy'));
    ha.register(makeAdapter('b', 'degraded'));
    expect(ha.snapshot().status).toBe('degraded');
  });

  it('snapshot() returns error when any adapter is in error', () => {
    ha.register(makeAdapter('a', 'healthy'));
    ha.register(makeAdapter('b', 'error'));
    expect(ha.snapshot().status).toBe('error');
  });

  it('error takes precedence over degraded', () => {
    ha.register(makeAdapter('a', 'degraded'));
    ha.register(makeAdapter('b', 'error'));
    expect(ha.snapshot().status).toBe('error');
  });

  it('snapshot() includes per-adapter states', () => {
    ha.register(makeAdapter('mqtt-1', 'healthy'));
    ha.register(makeAdapter('is12-1', 'degraded'));
    const snap = ha.snapshot();
    expect(snap.adapters['mqtt-1']?.state).toBe('healthy');
    expect(snap.adapters['is12-1']?.state).toBe('degraded');
  });

  it('unregister() removes an adapter from future snapshots', () => {
    ha.register(makeAdapter('x', 'error'));
    ha.unregister('x');
    expect(ha.snapshot().status).toBe('ok');
  });

  it('empty aggregator reports ok', () => {
    expect(ha.snapshot().status).toBe('ok');
    expect(ha.snapshot().adapters).toEqual({});
  });
});

// ===========================================================================
// E12.T3 — HealthAggregator /healthz HTTP endpoint
// ===========================================================================

describe('E12.T3 — HealthAggregator /healthz endpoint', () => {
  let ha: HealthAggregator;
  let port: number;

  beforeEach(async () => {
    ha = new HealthAggregator();
    port = await ha.startHttpServer(0);
  });

  afterEach(async () => {
    await ha.stopHttpServer();
  });

  async function getHealthz(): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    return { status: res.status, body: await res.json() };
  }

  it('GET /healthz returns 200 and ok when healthy', async () => {
    ha.register(makeAdapter('a', 'healthy'));
    const { status, body } = await getHealthz();
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe('ok');
  });

  it('GET /healthz returns 200 for degraded', async () => {
    ha.register(makeAdapter('a', 'degraded'));
    const { status, body } = await getHealthz();
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe('degraded');
  });

  it('GET /healthz returns 503 when error', async () => {
    ha.register(makeAdapter('a', 'error'));
    const { status, body } = await getHealthz();
    expect(status).toBe(503);
    expect((body as { status: string }).status).toBe('error');
  });

  it('GET /healthz response contains adapters map', async () => {
    ha.register(makeAdapter('mqtt-1', 'healthy'));
    const { body } = await getHealthz();
    expect((body as { adapters: Record<string, unknown> }).adapters).toHaveProperty('mqtt-1');
  });

  it('non-healthz path returns 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(404);
  });

  it('serverListening is true while running and false after stop', async () => {
    expect(ha.serverListening).toBe(true);
    await ha.stopHttpServer();
    expect(ha.serverListening).toBe(false);
  });

  it('startHttpServer allocates a real port (>0)', () => {
    expect(port).toBeGreaterThan(0);
  });
});

// ===========================================================================
// E12.T4 — Record & Replay
// ===========================================================================

describe('E12.T4 — Recorder & Replayer', () => {
  let bus: UceBus;
  let dir: string;

  beforeEach(() => {
    bus = new UceBus();
    dir = tmpDir();
  });

  it('Recorder captures ops as NDJSON', async () => {
    const rec = new Recorder();
    const file = join(dir, 'ops.ndjson');
    rec.start(bus, file);
    bus.publish(makeOp({ correlationId: 'r1' }));
    bus.publish(makeOp({ correlationId: 'r2' }));
    await rec.stop();

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const ops = lines.map((l) => JSON.parse(l) as { correlationId: string });
    expect(ops[0]!.correlationId).toBe('r1');
    expect(ops[1]!.correlationId).toBe('r2');
  });

  it('recordedCount tracks number of ops written', async () => {
    const rec = new Recorder();
    const file = join(dir, 'count.ndjson');
    rec.start(bus, file);
    bus.publish(makeOp());
    bus.publish(makeOp());
    bus.publish(makeOp());
    expect(rec.recordedCount).toBe(3);
    await rec.stop();
  });

  it('isRecording is true while active and false after stop', async () => {
    const rec = new Recorder();
    expect(rec.isRecording).toBe(false);
    rec.start(bus, join(dir, 'r.ndjson'));
    expect(rec.isRecording).toBe(true);
    await rec.stop();
    expect(rec.isRecording).toBe(false);
  });

  it('start() is idempotent — second call does not double-subscribe', async () => {
    const rec = new Recorder();
    const file = join(dir, 'idem.ndjson');
    rec.start(bus, file);
    rec.start(bus, file); // second call is no-op
    bus.publish(makeOp());
    await rec.stop();
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('Replayer re-publishes ops onto the bus in order', async () => {
    const file = join(dir, 'replay.ndjson');
    writeFileSync(
      file,
      [
        JSON.stringify(makeOp({ correlationId: 'rx1', value: 1.0 })),
        JSON.stringify(makeOp({ correlationId: 'rx2', value: 2.0 })),
      ].join('\n') + '\n',
    );

    const received: string[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => {
      received.push((op as ReturnType<typeof makeOp>).correlationId);
    });

    const replayer = new Replayer();
    const count = await replayer.replay(bus, file);
    expect(count).toBe(2);
    expect(received).toEqual(['rx1', 'rx2']);
  });

  it('Replayer returns correct count and skips blank lines', async () => {
    const file = join(dir, 'blank.ndjson');
    writeFileSync(
      file,
      '\n' + JSON.stringify(makeOp({ correlationId: 'a' })) + '\n\n' + JSON.stringify(makeOp({ correlationId: 'b' })) + '\n',
    );
    const replayer = new Replayer();
    const count = await replayer.replay(bus, file);
    expect(count).toBe(2);
  });

  it('record → replay → identical tree state', async () => {
    const file = join(dir, 'round.ndjson');
    const rec = new Recorder();
    rec.start(bus, file);
    bus.publish(makeOp({ correlationId: 'rr1', value: 10.0 }));
    bus.publish(makeOp({ correlationId: 'rr2', value: 20.0 }));
    await rec.stop();

    const bus2 = new UceBus();
    const replayed: number[] = [];
    bus2.subscribe({ op: 'propertyChanged' }, (op) => {
      replayed.push((op as ReturnType<typeof makeOp>).value as number);
    });

    const replayer = new Replayer();
    await replayer.replay(bus2, file);
    expect(replayed).toEqual([10.0, 20.0]);
  });

  it('Recorder stop() resolves when called without prior start()', async () => {
    const rec = new Recorder();
    await expect(rec.stop()).resolves.toBeUndefined();
  });
});
