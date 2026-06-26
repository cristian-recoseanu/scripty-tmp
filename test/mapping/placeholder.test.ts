import { describe, it, expect } from 'vitest';

describe('mapping — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../src/mapping/index.js')).resolves.toBeDefined();
  });
});
