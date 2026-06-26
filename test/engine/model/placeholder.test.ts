import { describe, it, expect } from 'vitest';

describe('engine/model — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../../src/engine/model/index.js')).resolves.toBeDefined();
  });
});
