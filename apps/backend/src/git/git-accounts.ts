import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';

/**
 * Contas Git (GitHub, GitLab próprio). O token fica num arquivo do servidor com permissão 600 — nunca no
 * git nem no banco — e só é usado pelo sistema para clonar, atualizar e enviar. A IA nunca o recebe.
 */
export interface GitAccount {
  id: string;
  nome: string;
  tipo: 'github' | 'gitlab';
  /** Endereço do servidor, ex.: https://github.com ou https://git.minhaempresa.com.br */
  host: string;
  usuario: string;
  token: string;
  /** Autor dos commits enviados (opcional; senão "Nivoo AI Manager"). */
  autorNome?: string;
  autorEmail?: string;
}

export type GitAccountPublic = Omit<GitAccount, 'token'>;

function file(): string {
  return process.env.NIVOO_GIT_ACCOUNTS_FILE ?? path.join(path.dirname(appConfig().workspacesRoot), 'git-contas.json');
}

function readAll(): GitAccount[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(contas: GitAccount[]): void {
  const target = file();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(contas, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function publicAccount(c: GitAccount): GitAccountPublic {
  const { token: _token, ...resto } = c;
  void _token;
  return resto;
}

export function listGitAccounts(): GitAccount[] {
  return readAll();
}

export function getGitAccount(id: string): GitAccount {
  const c = readAll().find((x) => x.id === id);
  if (!c) throw new NotFoundException('Conta Git não encontrada');
  return c;
}

/** Endereço base normalizado (https://host[:porta]), sem barra no fim. */
export function normalizeHost(raw: unknown): string {
  let h = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
  let u: URL;
  try {
    u = new URL(h);
  } catch {
    throw new BadRequestException('Endereço do servidor Git inválido');
  }
  if (u.username || u.password) throw new BadRequestException('Não coloque usuário ou senha no endereço');
  return `${u.protocol}//${u.host}`;
}

export function saveGitAccount(c: Omit<GitAccount, 'id'>): GitAccount {
  const conta: GitAccount = { ...c, id: randomUUID() };
  writeAll([...readAll(), conta]);
  return conta;
}

/** Renomear e/ou trocar o token (ex.: o anterior expirou). Projetos ligados à conta continuam ligados. */
export function updateGitAccount(id: string, mudancas: { nome?: string; token?: string }): GitAccount {
  const contas = readAll();
  const c = contas.find((x) => x.id === id);
  if (!c) throw new NotFoundException('Conta Git não encontrada');
  if (mudancas.nome) c.nome = mudancas.nome;
  if (mudancas.token) c.token = mudancas.token;
  writeAll(contas);
  return c;
}

export function deleteGitAccount(id: string): void {
  const contas = readAll();
  if (!contas.some((c) => c.id === id)) throw new NotFoundException('Conta Git não encontrada');
  writeAll(contas.filter((c) => c.id !== id));
}
