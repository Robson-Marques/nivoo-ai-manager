/** Testes de aceitação contra PostgreSQL real (DATABASE_URL_TEST). */
const path = require('node:path');

module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  // O tsconfig é absoluto, independente de onde o runner chama o Jest.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.test.json') }] },
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  testTimeout: 180000,
  maxWorkers: 1,
};
