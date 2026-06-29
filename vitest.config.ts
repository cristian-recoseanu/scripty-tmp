import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Vitest 4: sequential execution for e2e tests that bind ports (replaces poolOptions singleFork)
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/app.ts'],
      thresholds: {
        lines: 80,
        // Vitest 4 AST-aware V8 remapping counts branches more accurately than v3 (~78% here).
        branches: 78,
        functions: 80,
        statements: 80,
        perFile: false,
      },
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
