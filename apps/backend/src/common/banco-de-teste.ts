import { minimalEnv, runProcess } from './exec';

/**
 * Banco de teste descartável: cada trabalho ganha um banco PostgreSQL vazio só dele, para os testes do projeto que
 * precisam de banco (migrações, testes de integração). Criado na primeira conferência e apagado quando o trabalho
 * termina. Usa um usuário próprio do servidor (NIVOO_TESTES_PG_URL, criado pelo instalador: só pode criar bancos,
 * não é superusuário e não acessa o banco do Nivoo). Sem NIVOO_TESTES_PG_URL, não existe.
 */
export function bancoDeTesteDisponivel(): boolean {
  return !!process.env.NIVOO_TESTES_PG_URL;
}

export function nomeDoBancoDeTeste(jobId: string): string {
  return `teste_${jobId.replace(/[^a-f0-9]/gi, '').slice(0, 20).toLowerCase()}`;
}

function conexao(): URL | null {
  try {
    return process.env.NIVOO_TESTES_PG_URL ? new URL(process.env.NIVOO_TESTES_PG_URL) : null;
  } catch {
    return null;
  }
}

async function psql(sql: string): Promise<{ ok: boolean; saida: string }> {
  const u = conexao();
  if (!u) return { ok: false, saida: 'NIVOO_TESTES_PG_URL ausente' };
  const r = await runProcess(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-qtA', '-h', u.hostname || '127.0.0.1', '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.replace(/^\//, '') || 'postgres', '-c', sql],
    { cwd: '/', env: minimalEnv({ PGPASSWORD: decodeURIComponent(u.password), PGCONNECT_TIMEOUT: '10' }), timeoutMs: 60_000 },
  );
  return { ok: r.exitCode === 0, saida: `${r.stdout}${r.stderr}`.trim() };
}

/** Garante o banco do trabalho e devolve as variáveis para a conferência (ou null, sem o recurso). */
export async function prepararBancoDeTeste(jobId: string, nomeProprio?: string): Promise<{ nome: string; env: Record<string, string> } | null> {
  const u = conexao();
  if (!u) return null;
  const nome = nomeProprio ?? nomeDoBancoDeTeste(jobId);
  const existe = await psql(`SELECT 1 FROM pg_database WHERE datname = '${nome}'`);
  if (!existe.ok) throw new Error(`não consegui falar com o PostgreSQL de testes: ${existe.saida.slice(0, 300)}`);
  if (existe.saida !== '1') {
    const c = await psql(`CREATE DATABASE "${nome}"`);
    if (!c.ok && !/already exists|já existe/i.test(c.saida)) throw new Error(`não consegui criar o banco de teste: ${c.saida.slice(0, 300)}`);
  }
  const url = new URL(u.toString());
  url.pathname = `/${nome}`;
  const host = u.hostname || '127.0.0.1';
  const port = u.port || '5432';
  return {
    nome,
    env: {
      DATABASE_URL_TEST: url.toString(),
      TEST_DATABASE_URL: url.toString(),
      DATABASE_URL: url.toString(),
      PGHOST: host,
      PGPORT: port,
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: nome,
    },
  };
}

/** Apaga o banco do trabalho (fim do trabalho). Nunca lança. */
export async function descartarBancoDeTeste(jobId: string, nomeProprio?: string): Promise<boolean> {
  if (!conexao()) return false;
  const r = await psql(`DROP DATABASE IF EXISTS "${nomeProprio ?? nomeDoBancoDeTeste(jobId)}" WITH (FORCE)`).catch(() => ({ ok: false, saida: '' }));
  return r.ok;
}

export const TEXTO_BANCO_DE_TESTE = [
  '- BANCO DE TESTE: o servidor dá a cada trabalho um PostgreSQL vazio e descartável (apagado no fim do trabalho). Nas conferências,',
  '  DATABASE_URL_TEST, TEST_DATABASE_URL e DATABASE_URL (e PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) apontam para ele. Inclua na',
  '  conferência os testes que precisam de banco (migrações, integração) — não deixe de fora por "falta de banco".',
];
