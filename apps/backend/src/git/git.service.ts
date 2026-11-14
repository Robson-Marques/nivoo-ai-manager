import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess, RunResult } from '../common/exec';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { getGitAccount, GitAccount, listGitAccounts, normalizeHost } from './git-accounts';

const ASKPASS = `#!/bin/sh
case "$1" in
  *sername*) printf '%s\\n' "$NIVOO_GIT_USUARIO" ;;
  *) printf '%s\\n' "$NIVOO_GIT_SENHA" ;;
esac
`;

/** Endereço do repositório em HTTPS (aceita também git@host:grupo/repo.git e ssh://). */
export function normalizeRepoUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (process.env.NIVOO_GIT_PERMITIR_LOCAL === '1' && (s.startsWith('/') || s.startsWith('file://'))) return s; // só testes
  let url = s;
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(s); // git@host:grupo/repo.git
  if (scp) url = `https://${scp[1]}/${scp[2]}`;
  const ssh = /^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(s);
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BadRequestException('Endereço do repositório inválido (use https://servidor/grupo/projeto.git)');
  }
  if (!['https:', 'http:'].includes(u.protocol)) throw new BadRequestException('Use um endereço https:// do repositório');
  if (u.username || u.password) throw new BadRequestException('Não coloque usuário ou token no endereço: cadastre a conta Git');
  const caminho = u.pathname.replace(/\/+$/, '');
  if (!caminho || caminho === '/') throw new BadRequestException('Informe o caminho do repositório (grupo/projeto)');
  return `${u.protocol}//${u.host}${caminho.endsWith('.git') ? caminho : `${caminho}.git`}`;
}

export function checkBranch(raw: unknown): string {
  const b = String(raw ?? '').trim() || 'main';
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(b) || b.includes('..') || b.startsWith('-') || b.startsWith('/') || b.endsWith('/')) throw new BadRequestException('Nome de branch inválido');
  return b;
}

export interface GitLink {
  url: string;
  branch: string;
  accountId: string | null;
}

/**
 * Git do projeto: clonar, atualizar (pull), enviar (push) e criar tag. A "pasta principal" do projeto
 * é a branch local `main`, que acompanha a branch remota escolhida. Credenciais entram só por GIT_ASKPASS
 * no processo do git — nunca no endereço, no .git/config, nos logs ou na sessão da IA.
 */
@Injectable()
export class GitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  /** Conta indicada, ou a cadastrada para o mesmo servidor do repositório (null = repositório público). */
  accountFor(url: string, accountId?: string | null): GitAccount | null {
    if (accountId) {
      const c = getGitAccount(accountId);
      if (!url.startsWith('/') && !url.startsWith('file://') && normalizeHost(new URL(url).origin) !== c.host) {
        throw new BadRequestException(`A conta "${c.nome}" é de ${c.host}; o repositório é de ${new URL(url).origin}`);
      }
      return c;
    }
    if (url.startsWith('/') || url.startsWith('file://')) return null;
    return listGitAccounts().find((c) => c.host === new URL(url).origin) ?? null;
  }

  /** Executa git com a credencial da conta (se houver), sem prompt interativo. */
  private async git(cwd: string, args: string[], conta: GitAccount | null, timeoutMs = 120_000): Promise<RunResult> {
    let askpass: string | null = null;
    try {
      const extra: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
      if (conta) {
        askpass = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-git-')), 'askpass.sh');
        fs.writeFileSync(askpass, ASKPASS, { mode: 0o700 });
        Object.assign(extra, { GIT_ASKPASS: askpass, NIVOO_GIT_USUARIO: conta.usuario, NIVOO_GIT_SENHA: conta.token });
      }
      return await runProcess('git', ['-c', 'credential.helper=', ...args], { cwd, env: minimalEnv(extra), timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    } finally {
      if (askpass) fs.rmSync(path.dirname(askpass), { recursive: true, force: true });
    }
  }

  private static erro(r: RunResult, conta: GitAccount | null): string {
    const msg = `${r.stderr}\n${r.stdout}`.replace(/https?:\/\/[^@\s]*@/g, 'https://').trim();
    if (/Authentication failed|could not read Username|403|401|Invalid username or password|access denied/i.test(msg)) {
      return conta ? `O servidor recusou a conta Git "${conta.nome}" (token inválido ou sem permissão neste repositório).` : 'O repositório exige login: cadastre uma conta Git para este servidor em Contas.';
    }
    if (/not found|does not exist|Repository not found/i.test(msg)) return 'Repositório não encontrado (confira o endereço e se a conta tem acesso).';
    if (/Remote branch .* not found|couldn't find remote ref/i.test(msg)) return 'Branch não encontrada no repositório.';
    if (r.timedOut) return 'O servidor Git não respondeu a tempo.';
    return msg.split('\n').slice(-3).join(' ').slice(0, 400) || 'falha no git';
  }

  private async ok(cwd: string, args: string[], conta: GitAccount | null, timeoutMs?: number): Promise<RunResult> {
    const r = await this.git(cwd, args, conta, timeoutMs);
    if (r.exitCode !== 0) throw new BadRequestException(GitService.erro(r, conta));
    return r;
  }

  private async identidade(repo: string, conta: GitAccount | null): Promise<void> {
    await this.ok(repo, ['config', 'user.name', conta?.autorNome || 'Nivoo AI Manager'], null);
    await this.ok(repo, ['config', 'user.email', conta?.autorEmail || 'nivoo@localhost'], null);
  }

  /** Clona o repositório para a pasta do projeto; a branch escolhida vira a pasta principal (`main`). */
  async cloneInto(repoDir: string, link: GitLink): Promise<void> {
    const conta = this.accountFor(link.url, link.accountId);
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    const r = await this.git(path.dirname(repoDir), ['clone', '--quiet', '--origin', 'origin', link.url, repoDir], conta, 15 * 60_000);
    if (r.exitCode !== 0) {
      fs.rmSync(repoDir, { recursive: true, force: true });
      throw new BadRequestException(`Não foi possível clonar: ${GitService.erro(r, conta)}`);
    }
    await this.identidade(repoDir, conta);
    const vazio = (await this.git(repoDir, ['rev-parse', '--verify', '-q', 'HEAD'], null)).exitCode !== 0;
    if (vazio) {
      // Repositório novo, sem commits: começa com um README.
      await this.ok(repoDir, ['checkout', '-q', '-b', 'main'], null);
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Projeto\n');
      await this.ok(repoDir, ['add', 'README.md'], null);
      await this.ok(repoDir, ['commit', '-q', '-m', 'início do projeto'], null);
      return;
    }
    const temBranch = (await this.git(repoDir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${link.branch}`], null)).exitCode === 0;
    if (!temBranch) {
      fs.rmSync(repoDir, { recursive: true, force: true });
      throw new BadRequestException(`A branch "${link.branch}" não existe no repositório.`);
    }
    await this.ok(repoDir, ['checkout', '-q', '-B', 'main', `refs/remotes/origin/${link.branch}`], null);
  }

  private async project(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    return p;
  }

  private async linked(projectId: string) {
    const p = await this.project(projectId);
    if (!p.gitUrl || !p.gitBranch) throw new BadRequestException('Este projeto não está ligado a um repositório Git');
    return { p, repo: this.workspace.projectDirs(p.dirKey).repo, conta: this.accountFor(p.gitUrl, p.gitAccountId), branch: p.gitBranch };
  }

  /** Mudanças na pasta principal sob a mesma trava da incorporação de trabalhos. */
  private comTrava<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${'incorporar:' + projectId}))) AS l`;
        return fn();
      },
      { timeout: 20 * 60_000, maxWait: 120_000 },
    );
  }

  /** Liga um projeto (que começou do zero) a um repositório. Não envia nada até o usuário pedir. */
  async link(projectId: string, body: any) {
    const p = await this.project(projectId);
    const url = normalizeRepoUrl(body?.url);
    const branch = checkBranch(body?.branch);
    const conta = this.accountFor(url, body?.accountId ?? null);
    const repo = this.workspace.projectDirs(p.dirKey).repo;
    const tem = (await this.git(repo, ['remote'], null)).stdout.split('\n').includes('origin');
    await this.ok(repo, ['remote', tem ? 'set-url' : 'add', 'origin', url], null);
    await this.identidade(repo, conta);
    await this.prisma.project.update({ where: { id: projectId }, data: { gitUrl: url, gitBranch: branch, gitAccountId: conta?.id ?? null } });
    return this.status(projectId);
  }

  async unlink(projectId: string) {
    await this.prisma.project.update({ where: { id: projectId }, data: { gitUrl: null, gitBranch: null, gitAccountId: null, gitAutoPush: false } });
    return { ok: true };
  }

  async setAutoPush(projectId: string, on: boolean) {
    await this.linked(projectId);
    await this.prisma.project.update({ where: { id: projectId }, data: { gitAutoPush: on } });
    return this.status(projectId);
  }

  /** Situação: quantos commits a enviar / a receber e os últimos commits da pasta principal. */
  async status(projectId: string) {
    const p = await this.project(projectId);
    const repo = this.workspace.projectDirs(p.dirKey).repo;
    const log = (await this.git(repo, ['log', '-10', '--format=%h%x09%an%x09%cI%x09%s', 'main'], null)).stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [commit, autor, data, mensagem] = l.split('\t');
        return { commit, autor, data, mensagem };
      });
    if (!p.gitUrl || !p.gitBranch) return { ligado: false, commits: log };
    const conta = this.accountFor(p.gitUrl, p.gitAccountId);
    const f = await this.git(repo, ['fetch', '--quiet', 'origin', `+refs/heads/${p.gitBranch}:refs/remotes/origin/${p.gitBranch}`], conta);
    let enviar: number | null = null;
    let receber: number | null = null;
    let remotoVazio = false;
    if (f.exitCode === 0) {
      const c = await this.git(repo, ['rev-list', '--left-right', '--count', `main...refs/remotes/origin/${p.gitBranch}`], null);
      [enviar, receber] = c.stdout.trim().split(/\s+/).map(Number);
    } else if (/couldn't find remote ref/i.test(f.stderr)) {
      remotoVazio = true; // branch ainda não existe no remoto: o primeiro envio cria
      enviar = Number((await this.git(repo, ['rev-list', '--count', 'main'], null)).stdout.trim());
      receber = 0;
    }
    return {
      ligado: true,
      url: p.gitUrl,
      branch: p.gitBranch,
      conta: conta ? { id: conta.id, nome: conta.nome } : null,
      autoEnvio: p.gitAutoPush,
      ultimaSincronizacao: p.gitLastSyncAt,
      enviar,
      receber,
      remotoVazio,
      erro: f.exitCode === 0 || remotoVazio ? null : GitService.erro(f, conta),
      commits: log,
    };
  }

  /** Traz as mudanças do repositório para a pasta principal (avanço direto ou merge; conflito → nada muda). */
  async pull(projectId: string) {
    const { p, repo, conta, branch } = await this.linked(projectId);
    return this.comTrava(projectId, async () => {
      await this.ok(repo, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], conta);
      const remoto = `refs/remotes/origin/${branch}`;
      if ((await this.git(repo, ['merge-base', '--is-ancestor', remoto, 'main'], null)).exitCode === 0) {
        return { resultado: 'ja-atualizado', ...(await this.status(projectId)) };
      }
      const ff = await this.git(repo, ['merge', '--ff-only', '-q', remoto], null);
      if (ff.exitCode !== 0) {
        const m = await this.git(repo, ['merge', '--no-edit', '-q', '-m', `Atualiza do repositório (${branch})`, remoto], null);
        if (m.exitCode !== 0) {
          await this.git(repo, ['merge', '--abort'], null);
          throw new ConflictException('As mudanças do repositório conflitam com as daqui (mesmos arquivos alterados dos dois lados). Nada foi alterado. Resolva no repositório e tente de novo.');
        }
      }
      await this.prisma.project.update({ where: { id: p.id }, data: { gitLastSyncAt: new Date() } });
      return { resultado: 'atualizado', ...(await this.status(projectId)) };
    });
  }

  /** Envia a pasta principal para a branch do repositório; com `tag`, cria e envia a tag também. */
  async push(projectId: string, body: any = {}) {
    const { p, repo, conta, branch } = await this.linked(projectId);
    const tag = body?.tag ? String(body.tag).trim() : '';
    if (tag && (await this.git(repo, ['check-ref-format', `refs/tags/${tag}`], null)).exitCode !== 0) throw new BadRequestException('Nome de tag inválido');
    return this.comTrava(projectId, async () => {
      const r = await this.git(repo, ['push', '--quiet', 'origin', `main:refs/heads/${branch}`], conta, 15 * 60_000);
      if (r.exitCode !== 0) {
        if (/rejected|non-fast-forward|fetch first/i.test(r.stderr)) {
          throw new ConflictException('O repositório tem mudanças que ainda não estão aqui. Use "Atualizar do Git" primeiro e envie de novo.');
        }
        throw new BadRequestException(`Não foi possível enviar: ${GitService.erro(r, conta)}`);
      }
      if (tag) {
        const t = await this.git(repo, ['tag', '-a', tag, '-m', String(body?.mensagem ?? `Versão ${tag}`).slice(0, 500), 'main'], null);
        if (t.exitCode !== 0) throw new ConflictException(/already exists/i.test(t.stderr) ? `A tag ${tag} já existe` : GitService.erro(t, null));
        await this.ok(repo, ['push', '--quiet', 'origin', `refs/tags/${tag}`], conta);
      }
      await this.prisma.project.update({ where: { id: p.id }, data: { gitLastSyncAt: new Date() } });
      return { resultado: 'enviado', tag: tag || null, ...(await this.status(projectId)) };
    });
  }
}
