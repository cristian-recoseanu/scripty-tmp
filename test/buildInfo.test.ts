import { describe, it, expect } from 'vitest';

import { formatBuildInfo, loadBuildInfo } from '../src/buildInfo.js';

describe('buildInfo', () => {
  it('loadBuildInfo returns dev fallback when build-info.json is absent', () => {
    const info = loadBuildInfo();
    expect(info.name).toBe('protocol-bridge');
    expect(info.version).toBeDefined();
    expect(info.gitCommit).toBeDefined();
    expect(info.builtAt).toBeDefined();
  });

  it('formatBuildInfo includes name, version, commit, and build time', () => {
    const line = formatBuildInfo({
      name: 'protocol-bridge',
      version: '0.1.0',
      gitCommit: 'abcdef1234567890',
      gitTag: 'v0.1.0',
      builtAt: '2026-06-28T09:00:00.000Z',
    });
    expect(line).toContain('protocol-bridge 0.1.0');
    expect(line).toContain('commit=abcdef1');
    expect(line).toContain('tag=v0.1.0');
    expect(line).toContain('built=2026-06-28T09:00:00.000Z');
  });

  it('formatBuildInfo omits tag when null', () => {
    const line = formatBuildInfo({
      name: 'protocol-bridge',
      version: '0.1.0',
      gitCommit: 'abc1234',
      gitTag: null,
      builtAt: '2026-06-28T09:00:00.000Z',
    });
    expect(line).not.toContain('tag=');
  });
});
