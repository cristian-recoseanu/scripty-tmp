/**
 * E22.T13 — Scenario-06 end-to-end: IS-12 ingress → IS-12 egress bidirectional userLabel sync.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Is12EgressAdapter } from '../../src/adapters/nmos-is12/Is12EgressAdapter.js';
import { Is12IngressAdapter } from '../../src/adapters/nmos-is12/Is12IngressAdapter.js';
import { OID_ROOT } from '../../src/adapters/nmos-is12/ms05/IdentityRegistry.js';
import { NC_BLOCK_METHOD, NC_OBJECT_METHOD } from '../../src/adapters/nmos-is12/ms05/NcObjectMethods.js';
import { NcMethodStatus } from '../../src/adapters/nmos-is12/ms05/types.js';
import { loadBridgeConfig } from '../../src/config/loader.js';
import { loadEntities, loadDatatypes, loadTree } from '../../src/config/modelLoader.js';
import { UceBus } from '../../src/engine/bus/UceBus.js';
import { wirePropertyRelays } from '../../src/engine/propertyRelay.js';
import { UceEngine } from '../../src/engine/UceEngine.js';
import { getFreePort } from '../helpers/getFreePort.js';
import { Is12Client } from '../helpers/Is12Client.js';

import type { AdapterContext, AdapterLogger } from '../../src/adapters/Adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(__dirname, '../../Scenarios/Scenario-06');
const REMOTE_FIXTURE = resolve(SCENARIO_DIR, 'fixtures/remote-device');

/** Resolved at runtime from role path `receivers` on the remote fixture. */
let remoteReceiversOid: number;
/** Local UCE `egress-block` oid (managers=2–3, receivers-block=4, egress-block=5). */
const LOCAL_EGRESS_OID = 5;

const noop = () => {};
const makeLogger = (): AdapterLogger => ({ info: noop, warn: noop, error: noop, debug: noop });

describe('E22.T13 — Scenario-06 e2e IS-12→IS-12 userLabel sync', () => {
  let remotePort: number;
  let localPort: number;
  let remoteAdapter: Is12EgressAdapter;
  let localAdapter: Is12EgressAdapter;
  let ingressAdapter: Is12IngressAdapter;
  let remoteClient: Is12Client;
  let localClient: Is12Client;
  let engine: UceEngine;
  let unwireRelays: (() => void) | undefined;

  beforeAll(async () => {
    remotePort = await getFreePort();
    localPort = await getFreePort();

    const remoteEntities = loadEntities(resolve(REMOTE_FIXTURE, 'model/entities.yaml'));
    const remoteTypes = loadDatatypes(resolve(REMOTE_FIXTURE, 'model/datatypes.yaml'));
    const remoteTree = loadTree(resolve(REMOTE_FIXTURE, 'model/tree.yaml'), remoteEntities, remoteTypes);
    const remoteBus = new UceBus();
    const remoteEngine = new UceEngine({ tree: remoteTree, bus: remoteBus });
    remoteEngine.start();

    remoteAdapter = new Is12EgressAdapter('remote-device');
    await remoteAdapter.init({
      bus: remoteBus,
      tree: remoteTree,
      types: remoteTypes,
      entities: remoteEntities,
      logger: makeLogger(),
      config: {
        wsPort: remotePort,
        mapping: resolve(REMOTE_FIXTURE, 'mapping/egress.is12.yaml'),
      },
    });
    await remoteAdapter.start();
    remoteClient = await Is12Client.connect(remotePort);
    const findResp = await remoteClient.command({
      oid: OID_ROOT,
      methodId: NC_BLOCK_METHOD.FindMembersByPath,
      arguments: { path: ['receivers'] },
    });
    const members = (findResp.responses[0]?.result as { value?: { oid: number }[] }).value;
    remoteReceiversOid = members?.[0]?.oid ?? 0;
    expect(remoteReceiversOid).toBeGreaterThan(0);
    await remoteClient.subscribe([remoteReceiversOid]);

    const entities = loadEntities(resolve(SCENARIO_DIR, 'model/entities.yaml'));
    const types = loadDatatypes(resolve(SCENARIO_DIR, 'model/datatypes.yaml'));
    const tree = loadTree(resolve(SCENARIO_DIR, 'model/tree.yaml'), entities, types);
    const bus = new UceBus();
    engine = new UceEngine({ tree, bus });
    engine.start();

    const bridgeCfg = loadBridgeConfig(resolve(SCENARIO_DIR, 'bridge.yaml'), {
      IS12_REMOTE_WS_URL: `ws://127.0.0.1:${remotePort}`,
    });
    unwireRelays = wirePropertyRelays(bus, engine, bridgeCfg.relays ?? []);

    ingressAdapter = new Is12IngressAdapter('is12-ingress');
    localAdapter = new Is12EgressAdapter('is12-egress');

    const baseCtx = {
      bus, tree, types, entities, logger: makeLogger(),
    } satisfies Omit<AdapterContext, 'config'>;

    await ingressAdapter.init({
      ...baseCtx,
      config: {
        wsUrl: `ws://127.0.0.1:${remotePort}`,
        rootOid: OID_ROOT,
        mapping: resolve(SCENARIO_DIR, 'mapping/ingress.is12.yaml'),
        reconnectPeriodMs: 500,
        reconnectMaxMs: 2000,
      },
    });
    await localAdapter.init({
      ...baseCtx,
      config: {
        wsPort: localPort,
        mapping: resolve(SCENARIO_DIR, 'mapping/egress.is12.yaml'),
      },
    });
    await ingressAdapter.start();
    await localAdapter.start();
    localClient = await Is12Client.connect(localPort);
    await localClient.subscribe([LOCAL_EGRESS_OID]);

    await new Promise((r) => setTimeout(r, 300));
  }, 40_000);

  afterAll(async () => {
    unwireRelays?.();
    await ingressAdapter?.stop();
    await localAdapter?.stop();
    await localClient?.close();
    await remoteClient?.close();
    await remoteAdapter?.stop();
    engine?.stop();
  });

  it('loads committed Scenario-06 artefacts with property relays', () => {
    const cfg = loadBridgeConfig(resolve(SCENARIO_DIR, 'bridge.yaml'));
    expect(cfg.ingress.protocol).toBe('nmos-is12');
    expect(cfg.egress[0]?.protocol).toBe('nmos-is12');
    expect(cfg.relays).toHaveLength(1);
    const egressCfg = cfg.egress[0]?.config as { is04?: { nodeApi?: { enabled?: boolean } } };
    expect(egressCfg.is04?.nodeApi?.enabled).toBe(true);
  });

  it('remote receivers block userLabel change → local egress block reflects new value', async () => {
    await remoteClient.command({
      oid: remoteReceiversOid,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: 'from-remote-receivers' },
    });

    await new Promise((r) => setTimeout(r, 800));

    const resp = await localClient.command({
      oid: LOCAL_EGRESS_OID,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: string }).value).toBe('from-remote-receivers');
  });

  it('local egress block Set → remote receivers block userLabel updated', async () => {
    await localClient.command({
      oid: LOCAL_EGRESS_OID,
      methodId: NC_OBJECT_METHOD.Set,
      arguments: { id: { level: 1, index: 6 }, value: 'from-local-egress' },
    });

    await new Promise((r) => setTimeout(r, 1000));

    const resp = await remoteClient.command({
      oid: remoteReceiversOid,
      methodId: NC_OBJECT_METHOD.Get,
      arguments: { id: { level: 1, index: 6 } },
    });
    expect(resp.responses[0]?.result.status).toBe(NcMethodStatus.Ok);
    expect((resp.responses[0]?.result as { value: string }).value).toBe('from-local-egress');
  });
});
