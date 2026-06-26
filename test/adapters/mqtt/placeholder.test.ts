import { describe, it, expect } from 'vitest';

describe('adapters/mqtt — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../../src/adapters/mqtt/index.js')).resolves.toBeDefined();
  });
});
