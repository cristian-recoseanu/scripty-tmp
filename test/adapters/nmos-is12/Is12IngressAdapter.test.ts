/**
 * E21 — Is12IngressAdapter unit/integration tests.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stringify } from 'yaml';

import { Is12EgressAdapter } from '../../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { Is12IngressAdapter } from '../../../src/adapters/nmos-is12/Is12IngressAdapter.js';
import { OID_ROOT } from '../../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_OBJECT_METHOD } from '../../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { makePropertyChangedOp } from '../../../src/engine/bus/operations.js';
import { UceBus } from '../../../src/engine/bus/UceBus.js';
import { InstanceNodeImpl } from '../../../src/engine/model/ObjectNodeImpl.js';
import { InstanceTree } from '../../../src/engine/model/ObjectTree.js';
import { DatatypeRegistry } from '../../../src/engine/types/DatatypeRegistry.js';
import { EntityRegistry } from '../../../src/engine/types/EntityRegistry.js';
import { UceEngine } from '../../../src/engine/UceEngine.js';
import { getFreePort } from '../../helpers/getFreePort.js';
import { Is12Client } from '../../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../../src/adapters/Adapter.js';
import type { PropertyChangedOp } from '../../../src/engine/bus/operations.js';

const logger: AdapterLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function writeMapping(dir: string, readOnly = false): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'ingress.is12.yaml');
  writeFileSync(path, stringify({
    version: 1,
    classes: [{
      entityDef: 'Block',
      classId: [1, 1],
      properties: [{ id: 'userLabel', targetId: { level: 1, index: 6 }, readOnly }],
      methods: [],
    }],
  }));
  return path;
}

describe('E21 — Is12IngressAdapter', () => {
  let port: number;
  let upstream: Is12EgressAdapter;
  let adapter: Is12IngressAdapter;
  let bus: UceBus;
  let tree: InstanceTree;
  let upstreamClient: Is12Client;

  beforeEach(async () => {
    port = await getFreePort();
    const entities = new EntityRegistry();
    entities.register({
      entity_name: 'Block',
      properties: [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      methods: [],
    });
    tree = new InstanceTree();
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    root.setProperty('userLabel', 'init');
    tree.setRoot(root);

    const upstreamTree = new InstanceTree();
    const upstreamRoot = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    upstreamRoot.setProperty('userLabel', 'device');
    upstreamTree.setRoot(upstreamRoot);

    const upstreamBus = new UceBus();
    new UceEngine({ tree: upstreamTree, bus: upstreamBus }).start();
    const mapDir = join(tmpdir(), `up-${Date.now()}`);
    upstream = new Is12EgressAdapter('up');
    await upstream.init({
      bus: upstreamBus, tree: upstreamTree, types: new DatatypeRegistry(), entities, logger,
      config: { wsPort: port, mapping: writeMapping(mapDir) },
    });
    await upstream.start();

    bus = new UceBus();
    new UceEngine({ tree, bus }).start();
    adapter = new Is12IngressAdapter('in');
    const bridgeDir = join(tmpdir(), `br-${Date.now()}`);
    await adapter.init({
      bus, tree, types: new DatatypeRegistry(), entities, logger,
      config: { wsUrl: `ws://127.0.0.1:${port}`, rootOid: OID_ROOT, mapping: writeMapping(bridgeDir) },
    });
    await adapter.start();
    upstreamClient = await Is12Client.connect(port);
    await new Promise((r) => setTimeout(r, 100));
  }, 20_000);

  afterEach(async () => {
    await upstreamClient?.close();
    await adapter?.stop();
    await upstream?.stop();
  });

  it('syncs from remote device on connect', () => {
    expect(adapter.health().state).toBe('healthy');
    const prop = tree.root?.getProperty('userLabel');
    expect(prop?.ok && prop.value).toBe('device');
  });

  it('write-back updates remote device when mapping is writable', async () => {
    bus.publish(makePropertyChangedOp({
      origin: 'mqtt-egress',
      nodeId: 'root',
      property: 'userLabel',
      value: 'written-back',
    }));
    await new Promise((r) => setTimeout(r, 300));
    const resp = await upstreamClient.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect((resp.responses[0]?.result as { value: string }).value).toBe('written-back');
  });

  it('rejects invalid config at init', async () => {
    const bad = new Is12IngressAdapter('bad');
    const ctx: AdapterContext = {
      bus: new UceBus(), tree: new InstanceTree(), types: new DatatypeRegistry(),
      entities: new EntityRegistry(), logger, config: { mapping: '/x' },
    };
    await expect(bad.init(ctx)).rejects.toThrow(/invalid config/);
  });

  it('throws when start() is called before init()', async () => {
    const bare = new Is12IngressAdapter('bare');
    await expect(bare.start()).rejects.toThrow(/before init/);
  });

  it('forwards PropertyChanged notifications from remote device', async () => {
    const received: PropertyChangedOp[] = [];
    bus.subscribe({ op: 'propertyChanged' }, (op) => received.push(op as PropertyChangedOp));
    await upstreamClient.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: 'from-notification' },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(received.some((o) => o.origin === 'in' && o.value === 'from-notification')).toBe(true);
  });

  it('rejects init when mapping file is missing', async () => {
    const bad = new Is12IngressAdapter('bad-map');
    await expect(bad.init({
      bus: new UceBus(), tree: new InstanceTree(), types: new DatatypeRegistry(),
      entities: new EntityRegistry(), logger,
      config: { wsUrl: 'ws://127.0.0.1:1', mapping: '/no/such/mapping.yaml' },
    })).rejects.toThrow();
  });
});

describe('E21 — Is12IngressAdapter readOnly write-back', () => {
  it('does not write back when mapping marks property readOnly', async () => {
    const port = await getFreePort();
    const entities = new EntityRegistry();
    entities.register({
      entity_name: 'Block',
      properties: [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      methods: [],
    });
    const tree = new InstanceTree();
    const root = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    root.setProperty('userLabel', 'x');
    tree.setRoot(root);
    const upstreamTree = new InstanceTree();
    const upstreamRoot = new InstanceNodeImpl(
      { location: 'root', entity_def: 'Block', path: 'root' },
      [{ id: 'userLabel', type: 'string', is_array: false, read_only: false, observable: true, nullable: false }],
      [],
    );
    upstreamRoot.setProperty('userLabel', 'device');
    upstreamTree.setRoot(upstreamRoot);
    const upstreamBus = new UceBus();
    new UceEngine({ tree: upstreamTree, bus: upstreamBus }).start();
    const dir = join(tmpdir(), `ro-${Date.now()}`);
    const upstream = new Is12EgressAdapter('up');
    await upstream.init({
      bus: upstreamBus, tree: upstreamTree, types: new DatatypeRegistry(), entities, logger,
      config: { wsPort: port, mapping: writeMapping(dir) },
    });
    await upstream.start();
    const client = await Is12Client.connect(port);

    const bus = new UceBus();
    new UceEngine({ tree, bus }).start();
    const adapter = new Is12IngressAdapter('in-ro');
    await adapter.init({
      bus, tree, types: new DatatypeRegistry(), entities, logger,
      config: {
        wsUrl: `ws://127.0.0.1:${port}`,
        rootOid: OID_ROOT,
        mapping: writeMapping(join(tmpdir(), `ro-map-${Date.now()}`), true),
      },
    });
    await adapter.start();
    await new Promise((r) => setTimeout(r, 100));

    bus.publish(makePropertyChangedOp({
      origin: 'mqtt-egress',
      nodeId: 'root',
      property: 'userLabel',
      value: 'should-not-write',
    }));
    await new Promise((r) => setTimeout(r, 300));

    const resp = await client.command({
      oid: OID_ROOT,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect((resp.responses[0]?.result as { value: string }).value).toBe('device');

    await adapter.stop();
    await client.close();
    await upstream.stop();
  }, 20_000);
});
