import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appConfig } from '../config';

/**
 * Credenciais que o próprio usuário entrega pela tela "Conexões" (token oficial do Claude, chaves de
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

/**
 * Credencial de uma conexão: a primeira de cada tipo usa as chaves globais (e as variáveis de ambiente do
 * administrador); as adicionais guardam a sua em `<id>/<CHAVE>`, sem nunca herdar a das outras.
 */
export function segredoDaConexao(conexao: string | null, key: SecretKey): string | undefined {
  if (!conexao) return getSecret(key);
  return readAll()[`${conexao}/${key}` as SecretKey] || undefined;
}

export function gravarSegredoDaConexao(conexao: string | null, key: SecretKey, value: string | null): void {
  if (!conexao) return setSecret(key, value);
  setSecret(`${conexao}/${key}` as SecretKey, value);
}

/** Remove todas as credenciais de uma conexão adicional. */
export function apagarSegredosDaConexao(conexao: string): void {
  const all = readAll() as Record<string, string>;
  for (const k of Object.keys(all)) if (k.startsWith(`${conexao}/`)) delete all[k];
  const target = file();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/**
 * Variáveis da conferência de um projeto: tokens/segredos que a INSTALAÇÃO e os testes precisam (ex.: o token de um
 * registro de pacotes privado, GITLAB_PACKAGE_TOKEN). Ficam no mesmo cofre 600 (nunca no banco, no git nem na sessão da
 * IA) e entram só no ambiente da conferência. Chave: `confenv:<projectId>:<NOME>`.
 */
const PREFIXO_CONFENV = 'confenv:';
const NOME_VAR_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function nomeDeVariavelValido(nome: string): boolean {
  return NOME_VAR_OK.test(nome) && nome.length <= 100;
}

/** Nomes das variáveis da conferência do projeto (nunca os valores — segredo não volta para a tela). */
export function nomesDasVariaveisDaConferencia(projectId: string): string[] {
  const p = `${PREFIXO_CONFENV}${projectId}:`;
  return Object.keys(readAll())
    .filter((k) => k.startsWith(p))
    .map((k) => k.slice(p.length))
    .sort();
}

export function gravarVariavelDaConferencia(projectId: string, nome: string, valor: string | null): void {
  if (!nomeDeVariavelValido(nome)) throw new Error('nome de variável inválido (use letras, números e _; comece com letra ou _)');
  setSecret(`${PREFIXO_CONFENV}${projectId}:${nome}` as SecretKey, valor);
}

/** As variáveis da conferência do projeto (nome → valor) para injetar no ambiente — só a conferência as recebe. */
export function variaveisDaConferencia(projectId: string): Record<string, string> {
  const all = readAll() as Record<string, string>;
  const p = `${PREFIXO_CONFENV}${projectId}:`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith(p) && v) env[k.slice(p.length)] = v;
  return env;
}

/** Apaga todas as variáveis da conferência de um projeto (ao excluir o projeto). */
export function apagarVariaveisDaConferencia(projectId: string): void {
  const all = readAll() as Record<string, string>;
  let mudou = false;
  for (const k of Object.keys(all)) if (k.startsWith(`${PREFIXO_CONFENV}${projectId}:`)) (delete all[k], (mudou = true));
  if (!mudou) return;
  const target = file();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/**
 * Pasta de configuração própria de uma variante "API" de uma IA (ex.: claude-api), dentro do HOME do
 * serviço: o login da conta e o uso por chave de API nunca se misturam.
 */
export function isolatedHome(name: string): string {
  const dir = path.join(process.env.HOME ?? os.homedir(), '.nivoo-ia', name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
