/**
 * Post-build step: write dist/build-info.json with version provenance.
 * CI sets GIT_COMMIT / GIT_TAG / BUILD_TIME; local builds fall back to git + now().
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function git(command) {
  try {
    return execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const gitCommit = process.env.GIT_COMMIT?.trim() || git('git rev-parse HEAD') || 'unknown';
const envTag = process.env.GIT_TAG?.trim();
const gitTag =
  envTag !== undefined && envTag !== ''
    ? envTag
    : git('git describe --tags --exact-match 2>/dev/null');

const builtAtEnv = process.env.BUILD_TIME?.trim();
const info = {
  name: pkg.name,
  version: pkg.version,
  gitCommit,
  gitTag,
  builtAt: builtAtEnv !== undefined && builtAtEnv !== '' ? builtAtEnv : new Date().toISOString(),
};

writeFileSync(join(root, 'dist', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
process.stdout.write(`Wrote dist/build-info.json (${info.version}, ${gitCommit.slice(0, 7)})\n`);
