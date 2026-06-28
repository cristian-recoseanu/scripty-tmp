import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildInfo {
  name: string;
  version: string;
  gitCommit: string;
  gitTag: string | null;
  builtAt: string;
}

const DEV_BUILD_INFO: BuildInfo = {
  name: 'protocol-bridge',
  version: 'dev',
  gitCommit: 'unknown',
  gitTag: null,
  builtAt: 'unknown',
};

/** Load build metadata written by scripts/write-build-info.mjs (dist/build-info.json). */
export function loadBuildInfo(): BuildInfo {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = readFileSync(join(here, 'build-info.json'), 'utf8');
    return JSON.parse(raw) as BuildInfo;
  } catch {
    return DEV_BUILD_INFO;
  }
}

/** Human-readable version string for CLI output and logs. */
export function formatBuildInfo(info: BuildInfo): string {
  const tag = info.gitTag !== null ? ` tag=${info.gitTag}` : '';
  const shortCommit = info.gitCommit.length > 7 ? info.gitCommit.slice(0, 7) : info.gitCommit;
  return `${info.name} ${info.version} (commit=${shortCommit}${tag}, built=${info.builtAt})`;
}
