/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-engine-to-adapters',
      comment:
        'The UCE engine must remain protocol-neutral and must not import adapters.',
      severity: 'error',
      from: { path: '^src/engine' },
      to: { path: '^src/adapters' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies can cause subtle runtime issues.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
