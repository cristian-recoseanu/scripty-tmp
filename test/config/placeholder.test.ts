import { describe, it, expect } from 'vitest';

describe('config — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../src/config/index.js')).resolves.toBeDefined();
  });
});
