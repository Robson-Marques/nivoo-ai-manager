import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { apagarSegredosDaConexao, gravarSegredoDaConexao, segredoDaConexao } from '../accounts/secrets';
import { minimalEnv, runProcess } from '../common/exec';
import { appConfig } from '../config';

/**
 * Servidores SSH que as IAs dos projetos podem usar — SEMPRE com a permissão do usuário a cada comando.
 * O Nivoo gera uma chave só para isso (ed25519): a privada fica em `segredos.json` (`ssh--<id>/CHAVE_PRIVADA`,
 * 600) e nunca sai do servidor; a pública aparece na tela para ir no `authorized_keys`. Lista em `ssh.json` (600).
 */
export interface ServidorSsh {
  id: string;
  nome: string;
  host: string;
  porta: number;
  usuario: string;
  projetos: 'todos' | string[];
  chavePublica: string;
  criadoEm: string;
}

const HOST = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[?[0-9a-fA-F:]+\]?$/;
const USUARIO = /^[a-z_][a-z0-9_.-]{0,31}$/i;

function arquivo(): string {
  return process.env.NIVOO_SSH_FILE ?? path.join(path.dirname(appConfig().workspacesRoot), 'ssh.json');
}

export function listarServidores(): ServidorSsh[] {
  try {
    const l = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

function gravar(lista: ServidorSsh[]): void {
  const alvo = arquivo();
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, alvo);
}

export function acharServidor(id: string): ServidorSsh {
  const s = listarServidores().find((x) => x.id === id);
  if (!s) throw new NotFoundException('Servidor SSH não encontrado');
  return s;
}

/** Servidores que este projeto pode usar (sem segredos). */
export function servidoresDoProjeto(projectId: string): ServidorSsh[] {
  return listarServidores().filter((s) => s.projetos === 'todos' || s.projetos.includes(projectId));
}

async function gerarChave(nome: string): Promise<{ privada: string; publica: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-ssh-'));
  try {
    const arq = path.join(dir, 'chave');
    const r = await runProcess('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `nivoo-${nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').slice(0, 40)}`, '-f', arq], { cwd: dir, env: minimalEnv(), timeoutMs: 30_000 });
    if (r.exitCode !== 0) throw new BadRequestException(`não consegui gerar a chave SSH (ssh-keygen): ${r.spawnError ?? r.stderr.trim()}`);
    return { privada: fs.readFileSync(arq, 'utf8'), publica: fs.readFileSync(`${arq}.pub`, 'utf8').trim() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Criar (gera a chave) ou editar: { nome, host, porta, usuario, projetos }. */
export async function salvarServidor(body: any, id?: string): Promise<ServidorSsh> {
  const lista = listarServidores();
  const atual = id ? lista.find((s) => s.id === id) : undefined;
  if (id && !atual) throw new NotFoundException('Servidor SSH não encontrado');
  const nome = String(body?.nome ?? atual?.nome ?? '').trim().slice(0, 60);
  const host = String(body?.host ?? atual?.host ?? '').trim();
  const usuario = String(body?.usuario ?? atual?.usuario ?? '').trim();
  const porta = Number(body?.porta ?? atual?.porta ?? 22);
  if (!nome) throw new BadRequestException('Dê um nome ao servidor (ex.: Produção)');
  if (!HOST.test(host)) throw new BadRequestException('Endereço inválido (ex.: 131.161.180.35 ou servidor.empresa.com.br)');
  if (!USUARIO.test(usuario)) throw new BadRequestException('Usuário inválido (ex.: root, deploy)');
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new BadRequestException('Porta inválida');
  const projetos = body?.projetos ?? atual?.projetos ?? 'todos';
  const s: ServidorSsh = {
    id: atual?.id ?? randomBytes(4).toString('hex'),
    nome, host, porta, usuario,
    projetos: projetos === 'todos' ? 'todos' : Array.isArray(projetos) ? projetos.map(String).slice(0, 500) : 'todos',
    chavePublica: atual?.chavePublica ?? '',
    criadoEm: atual?.criadoEm ?? new Date().toISOString(),
  };
  if (!atual) {
    const k = await gerarChave(nome);
    gravarSegredoDaConexao(`ssh--${s.id}`, 'CHAVE_PRIVADA' as never, k.privada);
    s.chavePublica = k.publica;
  }
  gravar(atual ? lista.map((x) => (x.id === s.id ? s : x)) : [...lista, s]);
  return s;
}

/** Nova chave (a anterior deixa de valer assim que for tirada do authorized_keys do servidor). */
export async function novaChave(id: string): Promise<ServidorSsh> {
  const s = acharServidor(id);
  const k = await gerarChave(s.nome);
  gravarSegredoDaConexao(`ssh--${s.id}`, 'CHAVE_PRIVADA' as never, k.privada);
  const novo = { ...s, chavePublica: k.publica };
  gravar(listarServidores().map((x) => (x.id === id ? novo : x)));
  return novo;
}

export function removerServidor(id: string): void {
  acharServidor(id);
  gravar(listarServidores().filter((s) => s.id !== id));
  apagarSegredosDaConexao(`ssh--${id}`);
}

/**
 * Roda UM comando no servidor (chamado só depois da permissão do usuário, ou pelo botão Testar dele). Saída
 * (stdout + stderr) limitada; tempo limite próprio.
 */
export async function executarNoServidor(id: string, comando: string, timeoutMs = 10 * 60_000): Promise<{ exitCode: number; saida: string }> {
  const s = acharServidor(id);
  const privada = segredoDaConexao(`ssh--${s.id}`, 'CHAVE_PRIVADA' as never);
  if (!privada) throw new BadRequestException('Servidor sem chave: gere uma nova chave');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-ssh-'));
  try {
    const chave = path.join(dir, 'chave');
    fs.writeFileSync(chave, privada.endsWith('\n') ? privada : `${privada}\n`, { mode: 0o600 });
    const conhecidos = path.join(process.env.HOME ?? os.homedir(), '.ssh', 'known_hosts_nivoo');
    fs.mkdirSync(path.dirname(conhecidos), { recursive: true, mode: 0o700 });
    const r = await runProcess(
      process.env.NIVOO_SSH_BIN ?? 'ssh',
      [
        '-i', chave, '-p', String(s.porta),
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${conhecidos}`, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30',
        `${s.usuario}@${s.host}`, '--', comando,
      ],
      { cwd: dir, env: minimalEnv({ HOME: process.env.HOME ?? os.homedir() }), timeoutMs, maxBuffer: 20 * 1024 * 1024 },
    );
    if (r.spawnError) return { exitCode: -1, saida: `não consegui rodar o ssh: ${r.spawnError}` };
    const saida = `${r.stdout}${r.stderr ? `${r.stdout ? '\n' : ''}${r.stderr}` : ''}`;
    const limitada = saida.length > 60_000 ? `${saida.slice(0, 20_000)}\n… (${saida.length - 40_000} caracteres omitidos) …\n${saida.slice(-20_000)}` : saida;
    if (r.timedOut) return { exitCode: -1, saida: `${limitada}\n[tempo esgotado após ${Math.round(timeoutMs / 1000)} s]` };
    return { exitCode: r.exitCode ?? -1, saida: limitada };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
