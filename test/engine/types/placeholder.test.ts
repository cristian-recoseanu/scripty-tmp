import { describe, it, expect } from 'vitest';

describe('engine/types — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../../src/engine/types/index.js')).resolves.toBeDefined();
  });
});
