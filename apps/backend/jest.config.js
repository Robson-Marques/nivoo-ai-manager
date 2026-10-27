/** Testes de aceitação contra PostgreSQL real (DATABASE_URL_TEST). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  testTimeout: 90000,
  // Banco compartilhado: execução serial obrigatória.
  maxWorkers: 1,
};
