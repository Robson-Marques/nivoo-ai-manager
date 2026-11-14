import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';

/**
 * Credenciais que o próprio usuário entrega pela tela "Contas de IA" (token oficial do Claude, chaves de
 * API). Ficam num arquivo do servidor com permissão 600 — nunca no git nem no banco — e valem para a API e
 * o worker. Variáveis de ambiente de mesmo nome têm prioridade (configuração feita pelo administrador).
 */
export const SECRET_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

function file(): string {
  return process.env.NIVOO_SECRETS_FILE ?? path.join(path.dirname(appConfig().workspacesRoot), 'segredos.json');
}

function readAll(): Partial<Record<SecretKey, string>> {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

export function getSecret(key: SecretKey): string | undefined {
  return process.env[key] || readAll()[key] || undefined;
}

/** Origem da credencial: configurada pelo administrador (ambiente) ou pela tela. */
export function secretSource(key: SecretKey): 'ambiente' | 'tela' | null {
  if (process.env[key]) return 'ambiente';
  return readAll()[key] ? 'tela' : null;
}

export function setSecret(key: SecretKey, value: string | null): void {
  const all = readAll();
  if (value) all[key] = value;
  else delete all[key];
  const target = file();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/** Variáveis a repassar a um CLI de IA (só as que existem). */
export function secretEnv(keys: SecretKey[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of keys) {
    const v = getSecret(k);
    if (v) env[k] = v;
  }
  return env;
}
