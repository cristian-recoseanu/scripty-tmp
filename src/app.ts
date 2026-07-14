/**
 * E16.T8 — Bootstrap entry point.
 *
 * Load bridge config → build model → validate mappings → start engine → init/start adapters → handle shutdown.
 *
 * Usage:
 *   node dist/app.js <path-to-bridge.yaml>
 *   node dist/app.js --version
 *   BRIDGE_CONFIG=<path> node dist/app.js
 */

import { dirname, resolve } from 'node:path';

import { AdapterRegistry } from './adapters/AdapterRegistry.js';
import { MqttEgressAdapterFactory } from './adapters/mqtt/MqttEgressAdapter.js';
import { MqttAdapterFactory } from './adapters/mqtt/MqttIngressAdapter.js';
import { Is12AdapterFactory } from './adapters/nmos-is12/Is12EgressAdapter.js';
import { Is12IngressAdapterFactory } from './adapters/nmos-is12/Is12IngressAdapter.js';
import { formatBuildInfo, loadBuildInfo } from './buildInfo.js';
import { loadBridgeConfig, resolveFromConfig } from './config/loader.js';
import { loadDatatypes, loadEntities, loadTree } from './config/modelLoader.js';
import { validateAdapterMapping } from './config/validateMappings.js';
import { UceBus } from './engine/bus/UceBus.js';
import { wirePropertyRelays } from './engine/propertyRelay.js';
import { UceEngine } from './engine/UceEngine.js';
import { BridgeLogger } from './observability/BridgeLogger.js';

import type { Adapter, AdapterContext } from './adapters/Adapter.js';
import type { LogLevel } from './observability/BridgeLogger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfigPath(): string {
  const arg = process.argv[2];
  const env = process.env.BRIDGE_CONFIG;
  const raw = arg ?? env;
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'No config path provided.\n' +
      'Usage: node app.js <bridge.yaml>  or  BRIDGE_CONFIG=<path> node app.js',
    );
  }
  return resolve(process.cwd(), raw);
}

/**
 * If the config block contains a relative `mapping` string, resolve it to an
 * absolute path so adapters that call path.resolve(cwd, mapping) find the file
 * regardless of the working directory the process was launched from.
 */
function resolveConfigPaths(
  config: Record<string, unknown>,
  configDir: string,
): Record<string, unknown> {
  if (typeof config.mapping === 'string' && !config.mapping.startsWith('/')) {
    return { ...config, mapping: resolve(configDir, config.mapping) };
  }
  return config;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  // 1. Load and fully validate bridge.yaml
  const cfg = loadBridgeConfig(configPath);

  // 2. Structured logger
  const logger = new BridgeLogger({ level: (cfg.instance.logLevel ?? 'info') as LogLevel });
  logger.info(`Protocol Bridge '${cfg.instance.name}' starting…`, { configPath });

  // 3. Load model artefacts
  const entities = loadEntities(resolveFromConfig(configPath, cfg.model.entities));
  const datatypes = loadDatatypes(resolveFromConfig(configPath, cfg.model.datatypes));
  const tree = loadTree(resolveFromConfig(configPath, cfg.model.tree), entities, datatypes);
  logger.info('Model loaded', {
    entities: entities.names().length,
    datatypes: datatypes.names().length,
  });

  // 3b. Cross-validate mapping files against the model (E7.T4 / E21.T1)
  validateAdapterMapping(
    cfg.ingress.protocol,
    'ingress',
    resolveFromConfig(configPath, cfg.ingress.mapping),
    tree,
    entities,
    cfg.ingress.id,
  );
  for (const egress of cfg.egress) {
    validateAdapterMapping(
      egress.protocol,
      'egress',
      resolveFromConfig(configPath, egress.mapping),
      tree,
      entities,
      egress.id,
    );
  }

  // 4. Engine
  const bus = new UceBus();
  const engine = new UceEngine({ tree, bus });
  engine.start();

  let unwireRelays: (() => void) | undefined;
  if (cfg.relays !== undefined && cfg.relays.length > 0) {
    unwireRelays = wirePropertyRelays(bus, engine, cfg.relays);
  }

  // 5. Resolve adapter instances from registry
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(MqttAdapterFactory);
  adapterRegistry.register(MqttEgressAdapterFactory);
  adapterRegistry.register(Is12AdapterFactory);
  adapterRegistry.register(Is12IngressAdapterFactory);

  const adapterSpecs: { adapter: Adapter; config: Record<string, unknown> }[] = [
    {
      adapter: adapterRegistry.create(cfg.ingress.id, 'ingress', cfg.ingress.protocol, cfg.ingress.config),
      // Inject the adapter-level mapping path into the config so adapters that
      // read ctx.config['mapping'] (e.g. IS-12) always find the resolved path.
      // Inner config keys take precedence if they define their own mapping.
      config: resolveConfigPaths({ mapping: cfg.ingress.mapping, ...cfg.ingress.config }, configDir),
    },
    ...cfg.egress.map((e) => ({
      adapter: adapterRegistry.create(e.id, 'egress', e.protocol, e.config),
      config: resolveConfigPaths({ mapping: e.mapping, ...e.config }, configDir),
    })),
  ];

  // 6. Init + start adapters in declaration order; rollback on failure
  const baseCtx = { bus, tree, types: datatypes, entities };
  const started: Adapter[] = [];

  for (const { adapter, config } of adapterSpecs) {
    const ctx: AdapterContext = {
      ...baseCtx,
      logger: logger.forAdapter(adapter.id),
      config,
    };
    try {
      await adapter.init(ctx);
      await adapter.start();
      started.push(adapter);
      logger.info(`Adapter '${adapter.id}' (${adapter.protocol}) started`);
    } catch (err) {
      logger.error(`Adapter '${adapter.id}' (${adapter.protocol}) failed to start: ${String(err)}`);
      for (const a of [...started].reverse()) {
        try { await a.stop(); } catch { /* best-effort rollback */ }
      }
      engine.stop();
      unwireRelays?.();
      throw err;
    }
  }

  logger.info('All adapters started — bridge is running');

  // 7. Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal} — shutting down…`);
    for (const a of [...started].reverse()) {
      try {
        await a.stop();
        logger.info(`Adapter '${a.id}' stopped`);
      } catch (err) {
        logger.error(`Adapter '${a.id}' stop error: ${String(err)}`);
      }
    }
    unwireRelays?.();
    engine.stop();
    logger.info('Bridge stopped');
    process.exit(0);
  };

  process.once('SIGINT',  () => { void shutdown('SIGINT');  });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

if (process.argv.includes('--version') || process.argv.includes('-V')) {
   
  console.log(formatBuildInfo(loadBuildInfo()));
  process.exit(0);
}

main().catch((err: unknown) => {
   
  console.error('Fatal error during startup:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
