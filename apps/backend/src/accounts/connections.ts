import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';

/**
 * Conexões de IA: quantas contas o usuário quiser de cada tipo (ex.: "ChatGPT 1" e "ChatGPT 2"), cada uma
 * com nome próprio e login/chave/pasta de configuração SEPARADOS — duas contas do mesmo serviço nunca se
 * misturam. O id da primeira conexão de cada tipo é o próprio tipo (ex.: `codex-cli`), que usa a
 * configuração padrão do serviço (compatível com o que já estava conectado); as seguintes são
 * `<tipo>--<8 hex>` e usam pasta própria em ~/.nivoo-ia/<id>.
 */
export const TIPOS_IA = ['claude-code-cli', 'claude-api', 'codex-cli', 'codex-api', 'gemini-api', 'nvidia-api'] as const;
export type TipoIa = (typeof TIPOS_IA)[number];

export const TIPO_INFO: Record<TipoIa, { ia: string; modo: 'conta' | 'api'; nomePadrao: string; conta?: string; ondeChave?: string }> = {
  'claude-code-cli': { ia: 'Claude', modo: 'conta', nomePadrao: 'Claude', conta: 'conta do Claude (Pro/Max)' },
  'claude-api': { ia: 'Claude', modo: 'api', nomePadrao: 'Claude API', ondeChave: 'console.anthropic.com' },
  'codex-cli': { ia: 'ChatGPT', modo: 'conta', nomePadrao: 'ChatGPT', conta: 'conta do ChatGPT (Plus/Pro)' },
  'codex-api': { ia: 'ChatGPT', modo: 'api', nomePadrao: 'ChatGPT API', ondeChave: 'platform.openai.com' },
  'gemini-api': { ia: 'Gemini', modo: 'api', nomePadrao: 'Gemini API', ondeChave: 'aistudio.google.com' },
  'nvidia-api': { ia: 'NVIDIA', modo: 'api', nomePadrao: 'NVIDIA NIM (grátis para avaliação)', ondeChave: 'build.nvidia.com' },
};

export interface Conexao {
  id: string;
  tipo: TipoIa;
  nome: string;
  padrao: boolean;
  criadaEm: string;
  /** A IA recusou o login numa sessão real (token expirado/revogado, chave inválida): precisa reconectar. */
  falhaLogin?: { mensagem: string; em: string } | null;
}

const ID_EXTRA = /^([a-z]+(?:-[a-z]+)*-(?:cli|api))--([0-9a-f]{8})$/;

/** Tipo de uma conexão (ou null se o id não é de IA). */
export function tipoDe(id: string): TipoIa | null {
  if ((TIPOS_IA as readonly string[]).includes(id)) return id as TipoIa;
  const m = ID_EXTRA.exec(id);
  return m && (TIPOS_IA as readonly string[]).includes(m[1]) ? (m[1] as TipoIa) : null;
}

/** Conexão adicional (pasta própria) ou a primeira de cada tipo (configuração padrão do serviço). */
export function ehAdicional(id: string): boolean {
  const m = ID_EXTRA.exec(id);
  return !!m && (TIPOS_IA as readonly string[]).includes(m[1]);
}

function file(): string {
  return process.env.NIVOO_CONEXOES_FILE ?? path.join(path.dirname(appConfig().workspacesRoot), 'conexoes.json');
}

export function existeArquivoConexoes(): boolean {
  return fs.existsSync(file());
}

export function listarConexoes(): Conexao[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return [];
  }
}

export function gravarConexoes(lista: Conexao[]): void {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function acharConexao(id: string): Conexao | undefined {
  return listarConexoes().find((c) => c.id === id);
}

/** Novo id: o próprio tipo se ainda não há conexão com ele; senão `<tipo>--<hex>`. */
export function novoId(tipo: TipoIa, existentes: Conexao[]): string {
  if (!existentes.some((c) => c.id === tipo)) return tipo;
  let id: string;
  do id = `${tipo}--${randomBytes(4).toString('hex')}`;
  while (existentes.some((c) => c.id === id));
  return id;
}

const FALHA_LOGIN = /(?:API Error|status(?: code)?|HTTP|error)[:= "]*\(?401\b|\b401 Unauthori[sz]ed|unauthori[sz]ed|authentication_error|failed to authenticate|invalid (?:x-)?api[ _-]?key|api key not valid|api_key_invalid|access token is invalid|token (?:has )?expired|not logged in|please run .*login|invalid_grant|refresh token/i;

/** O erro de uma sessão é de login recusado (não de limite de uso ou rede)? */
export function ehFalhaDeLogin(texto: string | undefined | null): boolean {
  return !!texto && FALHA_LOGIN.test(texto);
}

/**
 * Marca (ou limpa, com null) a falha de login de uma conexão. O status do CLI só vê que existe um token;
 * esta marca registra que a IA o recusou de verdade, para a tela pedir "Reconecte" em vez de "Conectado".
 */
export function marcarFalhaLogin(id: string, mensagem: string | null): void {
  const lista = listarConexoes();
  const c = lista.find((x) => x.id === id);
  if (!c) return;
  if (!mensagem && !c.falhaLogin) return;
  c.falhaLogin = mensagem ? { mensagem: mensagem.slice(0, 300), em: new Date().toISOString() } : null;
  gravarConexoes(lista);
}

/** Ids de IA que um projeto pode usar: os seis tipos e as conexões adicionais cadastradas. */
export function aiConnectionIds(): string[] {
  return [...new Set([...TIPOS_IA, ...listarConexoes().map((c) => c.id)])];
}
