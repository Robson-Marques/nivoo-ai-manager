/** Testes de aceitação contra PostgreSQL real (DATABASE_URL_TEST). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  // Resolve o tsconfig pela pasta do backend, mesmo quando Jest é chamado pela raiz do repo.
  transform: { '^.+\\.ts
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  // 180s: no runner do CI (1 núcleo, --runInBand, I/O concorrido) um teste que localmente leva ~5s pode arrastar;
  // a folga evita falha por tempo sem mascarar travamento de verdade (que ainda estoura, só que mais tarde).
  testTimeout: 180000,
  // Banco compartilhado: execução serial obrigatória.
  maxWorkers: 1,
};
: ['ts-jest', { tsconfig: require('node:path').join(__dirname, 'tsconfig.test.json') }] },
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  // 180s: no runner do CI (1 núcleo, --runInBand, I/O concorrido) um teste que localmente leva ~5s pode arrastar;
  // a folga evita falha por tempo sem mascarar travamento de verdade (que ainda estoura, só que mais tarde).
  testTimeout: 180000,
  // Banco compartilhado: execução serial obrigatória.
  maxWorkers: 1,
};
