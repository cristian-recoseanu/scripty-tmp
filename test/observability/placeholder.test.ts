import { describe, it, expect } from 'vitest';

describe('observability — placeholder', () => {
  it('barrel is importable', async () => {
    await expect(import('../../src/observability/index.js')).resolves.toBeDefined();
  });
});
