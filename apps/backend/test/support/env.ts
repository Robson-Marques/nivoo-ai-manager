import * as os from 'node:os';
import * as path from 'node:path';

/** Ambiente isolado dos testes: banco nivoo_test e diretórios temporários. */
export const TEST_DB = process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/nivoo_test';
export const TEST_ROOT = process.env.NIVOO_TEST_ROOT ?? path.join(os.tmpdir(), 'nivoo-test');

export function applyTestEnv(): void {
  process.env.DATABASE_URL = TEST_DB;
  process.env.NIVOO_WORKSPACES_ROOT = path.join(TEST_ROOT, 'workspaces');
  process.env.NIVOO_ARTIFACTS_ROOT = path.join(TEST_ROOT, 'artifacts');
  process.env.NIVOO_LEASE_MS = process.env.NIVOO_LEASE_MS ?? '3000';
  process.env.NIVOO_POLL_MS = '200';
  process.env.NIVOO_PREVIA_PORT = process.env.NIVOO_PREVIA_PORT ?? '0'; // portão da prévia em porta livre nos testes
  // Os testes NUNCA mexem nos logins reais desta máquina: remover a conexão do ChatGPT roda "codex logout" e o do
  // Claude "claude auth logout". Fora do ensaio real (NIVOO_RUN_CLI_INTEGRATION=1), cada CLI usa uma pasta de teste.
  if (process.env.NIVOO_RUN_CLI_INTEGRATION !== '1') {
    process.env.CODEX_HOME = path.join(TEST_ROOT, 'home-codex');
    process.env.CLAUDE_CONFIG_DIR = path.join(TEST_ROOT, 'home-claude');
    process.env.GEMINI_CLI_HOME = path.join(TEST_ROOT, 'home-gemini');
  }
}
