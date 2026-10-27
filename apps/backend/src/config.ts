import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { config as loadDotenv } from 'dotenv';

// .env do backend (segredos ficam somente aqui, fora do git).
loadDotenv({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

function dir(envName: string, fallback: string): string {
  const raw = process.env[envName] ?? fallback;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(__dirname, '..', '..', '..', raw);
  fs.mkdirSync(abs, { recursive: true });
  return fs.realpathSync(abs);
}

export interface AppConfig {
  port: number;
  workspacesRoot: string;
  artifactsRoot: string;
  workerId: string;
  leaseMs: number;
  pollMs: number;
  enableTestProvider: boolean;
}

let cached: AppConfig | null = null;

export function appConfig(): AppConfig {
  if (cached) return cached;
  cached = {
    port: Number(process.env.PORT ?? 3000),
    workspacesRoot: dir('NIVOO_WORKSPACES_ROOT', './data/workspaces'),
    artifactsRoot: dir('NIVOO_ARTIFACTS_ROOT', './data/artifacts'),
    workerId: process.env.NIVOO_WORKER_ID ?? `${os.hostname()}-${process.pid}`,
    leaseMs: Number(process.env.NIVOO_LEASE_MS ?? 30000),
    pollMs: Number(process.env.NIVOO_POLL_MS ?? 1000),
    enableTestProvider: process.env.NIVOO_ENABLE_TEST_PROVIDER === '1',
  };
  return cached;
}

/** Apenas para testes: força releitura das variáveis de ambiente. */
export function resetConfigCache(): void {
  cached = null;
}
