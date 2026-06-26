import { describe, it, expect } from 'vitest';

describe('adapters/nmos-is12 — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../../src/adapters/nmos-is12/index.js')).resolves.toBeDefined();
  });
});
