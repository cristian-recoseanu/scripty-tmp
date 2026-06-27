/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'guard-fixture-must-not-import-adapters',
      comment:
        'Guard fixture used by npm run arch:check:guard to prove dependency-cruiser detects violations.',
      severity: 'error',
      from: { path: 'test/arch/engine-adapter-boundary.guard.ts' },
      to: { path: '^src/adapters' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.test.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
