import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';

const root = join(import.meta.dirname, '..');

describe('app --version', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        HUSKY: '0',
        GIT_COMMIT: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
    });
  });

  it('prints stamped build info and exits 0', () => {
    const out = execFileSync('node', ['dist/app.js', '--version'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(out).toContain('protocol-bridge');
    expect(out).toContain('0.1.0');
    expect(out).toContain('deadbee');
  });
});
