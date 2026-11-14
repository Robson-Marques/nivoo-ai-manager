import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { sha256 } from '../common/hash';

export interface ProjectDirs {
  root: string;
  repo: string;
  data: string;
  worktrees: string;
}

/**
 * Workspaces isolados por projeto:
 *   <WORKSPACES_ROOT>/<slug>/repo        repositório git (main preservada)
 *   <WORKSPACES_ROOT>/<slug>/data        datasets (fora do git)
 *   <WORKSPACES_ROOT>/<slug>/worktrees/<jobId>  worktree na branch job/<id>
 */
@Injectable()
export class WorkspaceService {
  projectDirs(slug: string): ProjectDirs {
    const root = resolveInside(appConfig().workspacesRoot, slug);
    return {
      root,
      repo: path.join(root, 'repo'),
      data: path.join(root, 'data'),
      worktrees: path.join(root, 'worktrees'),
    };
  }

  async ensureProject(slug: string): Promise<ProjectDirs> {
    const dirs = this.projectDirs(slug);
    for (const d of [dirs.root, dirs.data, dirs.worktrees]) fs.mkdirSync(d, { recursive: true });
    if (!fs.existsSync(path.join(dirs.repo, '.git'))) {
      fs.mkdirSync(dirs.repo, { recursive: true });
      await this.git(dirs.repo, ['init', '-q', '-b', 'main']);
      await this.git(dirs.repo, ['config', 'user.name', 'Nivoo AI Manager']);
      await this.git(dirs.repo, ['config', 'user.email', 'nivoo@localhost']);
      fs.writeFileSync(path.join(dirs.repo, '.gitignore'), 'out/\n');
      fs.writeFileSync(
        path.join(dirs.repo, 'README.md'),
        `# Workspace ${slug}\n\nGerenciado pelo Nivoo AI Manager. A branch main é preservada; cada job trabalha em job/<id>.\n`,
      );
      await this.git(dirs.repo, ['add', '-A']);
      await this.git(dirs.repo, ['commit', '-q', '-m', 'workspace inicial']);
    }
    return dirs;
  }

  // ---------- Áreas ----------
  /** Pastas de uma área: <WORKSPACES_ROOT>/areas/<slug>/{base,projetos}. */
  areaDirs(areaSlug: string): { root: string; base: string; projetos: string } {
    const root = resolveInside(appConfig().workspacesRoot, path.join('areas', areaSlug));
    return { root, base: path.join(root, 'base'), projetos: path.join(root, 'projetos') };
  }

  /** Cria a base de conhecimento da área (repositório git) com os arquivos iniciais do modelo. */
  async ensureAreaBase(areaSlug: string, initialFiles: Record<string, string> = {}): Promise<string> {
    const d = this.areaDirs(areaSlug);
    fs.mkdirSync(d.projetos, { recursive: true });
    if (!fs.existsSync(path.join(d.base, '.git'))) {
      fs.mkdirSync(d.base, { recursive: true });
      await this.gitOk(d.base, ['init', '-q', '-b', 'main']);
      await this.gitOk(d.base, ['config', 'user.name', 'Nivoo AI Manager']);
      await this.gitOk(d.base, ['config', 'user.email', 'nivoo@localhost']);
      for (const [rel, content] of Object.entries(initialFiles)) {
        const abs = resolveInside(d.base, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      }
      await this.git(d.base, ['add', '-A']);
      await this.git(d.base, ['commit', '-q', '--allow-empty', '-m', 'base de conhecimento inicial']);
    }
    return d.base;
  }

  /** Grava/remove um arquivo da base e registra no git. Devolve o commit. */
  async writeAreaFile(areaSlug: string, rel: string, content: Buffer | null, author: string): Promise<string | null> {
    const base = await this.ensureAreaBase(areaSlug);
    const abs = resolveInside(base, rel);
    if (abs === base || rel.split(/[\\/]/).includes('.git')) throw new Error('caminho inválido');
    if (content === null) {
      fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) fs.rmSync(abs);
      fs.writeFileSync(abs, content);
    }
    await this.git(base, ['add', '-A']);
    const diff = await this.git(base, ['diff', '--cached', '--quiet']);
    if (diff.exitCode !== 0) {
      await this.gitOk(base, ['-c', `user.name=${author.replace(/[^\w .@-]/g, '').slice(0, 60) || 'operador'}`, 'commit', '-q', '-m', `${content === null ? 'remove' : 'atualiza'} ${rel}`]);
    }
    return this.headCommit(base);
  }

  /** Grava vários arquivos na base da área num único commit (importação de pasta). */
  async importAreaFiles(areaSlug: string, files: Array<{ path: string; content: Buffer }>, author: string, message: string): Promise<string | null> {
    const base = await this.ensureAreaBase(areaSlug);
    for (const f of files) {
      const abs = resolveInside(base, f.path);
      if (abs === base || f.path.split(/[\\/]/).includes('.git')) throw new Error('caminho inválido');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) fs.rmSync(abs);
      fs.writeFileSync(abs, f.content);
    }
    await this.git(base, ['add', '-A']);
    const diff = await this.git(base, ['diff', '--cached', '--quiet']);
    if (diff.exitCode !== 0) {
      await this.gitOk(base, ['-c', `user.name=${author.replace(/[^\w .@-]/g, '').slice(0, 60) || 'operador'}`, 'commit', '-q', '-m', message.slice(0, 200)]);
    }
    return this.headCommit(base);
  }

  /**
   * Nome com que um caminho da base aparece na sessão de IA: arquivos de configuração de harness
   * (.claude/, CLAUDE.md, AGENTS.md...) viram "_claude/", "_CLAUDE.md"... — continuam legíveis como
   * referência, mas nenhum executor os carrega como configuração (hooks, permissões).
   */
  static sessionPath(rel: string): string {
    return rel
      .split('/')
      .map((seg) => (WorkspaceService.HARNESS_FILES.includes(seg) ? `_${seg.replace(/^\./, '')}` : seg))
      .join('/');
  }

  listAreaFiles(areaSlug: string): Array<{ path: string; size: number }> {
    const base = this.areaDirs(areaSlug).base;
    const out: Array<{ path: string; size: number }> = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) out.push({ path: path.relative(base, p).split(path.sep).join('/'), size: fs.statSync(p).size });
      }
    };
    walk(base);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  readAreaFile(areaSlug: string, rel: string): Buffer | null {
    const base = this.areaDirs(areaSlug).base;
    const abs = resolveInside(base, rel);
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) return null;
    return fs.readFileSync(abs);
  }

  async areaHistory(areaSlug: string, limit = 30): Promise<Array<{ commit: string; date: string; author: string; message: string }>> {
    const base = this.areaDirs(areaSlug).base;
    if (!fs.existsSync(path.join(base, '.git'))) return [];
    const r = await this.git(base, ['log', `-${limit}`, '--format=%H%x09%cI%x09%an%x09%s']);
    return r.stdout.split('\n').filter(Boolean).map((l) => {
      const [commit, date, author, message] = l.split('\t');
      return { commit, date, author, message };
    });
  }

  /**
   * Copia a base de conhecimento da área para area/ no worktree (somente leitura para o trabalho:
   * fora do git, renovada a cada sessão). Nunca segue links. Limite total de tamanho.
   */
  copyAreaBaseInto(areaSlug: string, worktree: string, maxBytes = 50 * 1024 * 1024): { files: number; bytes: number; skipped: number } {
    const dest = path.join(worktree, 'area');
    if (fs.existsSync(dest) || this.isLink(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    let bytes = 0;
    let files = 0;
    let skipped = 0;
    for (const f of this.listAreaFiles(areaSlug)) {
      if (bytes + f.size > maxBytes) {
        skipped++;
        continue;
      }
      const target = path.join(dest, WorkspaceService.sessionPath(f.path));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(this.areaDirs(areaSlug).base, f.path), target);
      bytes += f.size;
      files++;
    }
    return { files, bytes, skipped };
  }

  private isLink(p: string): boolean {
    try {
      return fs.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  }

  jobBranch(jobId: string): string {
    return `job/${jobId}`;
  }

  async ensureJobWorktree(slug: string, jobId: string): Promise<string> {
    const dirs = await this.ensureProject(slug);
    const wt = resolveInside(dirs.worktrees, jobId);
    if (!fs.existsSync(path.join(wt, '.git'))) {
      const branch = this.jobBranch(jobId);
      const exists = await this.git(dirs.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      if (exists.exitCode === 0) await this.gitOk(dirs.repo, ['worktree', 'add', '-q', wt, branch]);
      else await this.gitOk(dirs.repo, ['worktree', 'add', '-q', '-b', branch, wt, 'main']);
    }
    fs.mkdirSync(path.join(wt, 'out'), { recursive: true });
    // Cópias de datasets ficam fora do git (dados versionados por sha256 no registro do dataset).
    const exclude = path.join(dirs.repo, '.git', 'info', 'exclude');
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    // dados/ e area/: cópias de leitura (datasets, base de conhecimento da área); .nivoo/: notas e memória
    // (já gravadas no banco). Nada disso entra no git, para não conflitar ao integrar jobs na pasta principal.
    const missing = ['dados/', 'area/', '.nivoo/'].filter((l) => !current.split('\n').includes(l));
    if (missing.length) fs.appendFileSync(exclude, `${current.endsWith('\n') || !current ? '' : '\n'}${missing.join('\n')}\n`);
    return wt;
  }

  /**
   * Arquivos de configuração/instrução de harnesses de agentes (hooks, plugins, memória oculta).
   * Nunca fazem parte do trabalho: são removidos do workspace antes e depois de cada sessão de IA.
   */
  static readonly HARNESS_FILES = ['.claude', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md', '.codex', '.mcp.json', '.cursor', 'GEMINI.md', '.gemini'];

  sanitizeHarnessFiles(worktree: string): string[] {
    const removed: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 6 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (WorkspaceService.HARNESS_FILES.includes(e.name)) {
          fs.rmSync(p, { recursive: true, force: true });
          removed.push(path.relative(worktree, p));
        } else if (e.isDirectory() && !e.isSymbolicLink()) walk(p, depth + 1);
      }
    };
    walk(worktree, 0);
    return removed;
  }

  /** Impressão digital (nomes, tamanhos, mtimes) de um diretório, para detectar alterações indevidas. */
  dirFingerprint(dir: string, ignore: string[] = []): string {
    const items: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        const rel = path.relative(dir, p);
        if (ignore.includes(rel)) continue;
        if (e.isDirectory()) walk(p);
        else {
          const st = fs.lstatSync(p);
          items.push(`${rel}:${st.size}:${st.mtimeMs}`);
        }
      }
    };
    walk(dir);
    return sha256(items.sort().join('\n'));
  }

  /**
   * Hash do estado do workspace (árvore git sem ignorados + arquivos de out/).
   * Usado para detectar se uma sessão produziu algum progresso.
   */
  async snapshotHash(worktree: string): Promise<string> {
    // Notas do agente (.nivoo/) não contam como progresso: só alterações reais no trabalho.
    await this.git(worktree, ['add', '-A']);
    const files = await this.git(worktree, ['ls-files', '-s']);
    const tree = { stdout: files.stdout.split('\n').filter((l) => !/\t\.nivoo\//.test(l)).join('\n') };
    const out = path.join(worktree, 'out');
    const listing: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) {
          const st = fs.statSync(p);
          listing.push(`${path.relative(out, p)}:${st.size}:${st.mtimeMs}`);
        }
      }
    };
    walk(out);
    return sha256(`${tree.stdout.trim()}\n${listing.sort().join('\n')}`);
  }

  /** Commit de checkpoint na branch do job. Retorna o hash do HEAD. */
  async commitCheckpoint(worktree: string, message: string): Promise<string | null> {
    // Repositórios antigos rastreavam .nivoo/: deixa de rastrear (os arquivos continuam no disco).
    await this.git(worktree, ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '.nivoo']);
    await this.git(worktree, ['add', '-A']);
    const diff = await this.git(worktree, ['diff', '--cached', '--quiet']);
    if (diff.exitCode !== 0) await this.gitOk(worktree, ['commit', '-q', '-m', message]);
    const head = await this.git(worktree, ['rev-parse', 'HEAD']);
    return head.exitCode === 0 ? head.stdout.trim() : null;
  }

  /**
   * Traz para a branch do job tudo o que já foi incorporado à pasta principal (main).
   * Em conflito, desfaz a tentativa e devolve os arquivos em conflito.
   */
  async syncWithMain(worktree: string, message: string): Promise<{ ok: true } | { ok: false; files: string[] }> {
    await this.commitCheckpoint(worktree, message);
    const r = await this.git(worktree, ['merge', '--no-edit', '-m', message, 'main']);
    if (r.exitCode === 0) return { ok: true };
    const conflicts = await this.git(worktree, ['diff', '--name-only', '--diff-filter=U']);
    await this.git(worktree, ['merge', '--abort']);
    const files = conflicts.stdout.split('\n').filter(Boolean);
    return { ok: false, files: files.length ? files : [`(git) ${(r.stdout + r.stderr).trim().slice(0, 300)}`] };
  }

  /** Avança a pasta principal (main) até o resultado do job. Falha se a main mudou no meio do caminho. */
  async fastForwardMain(dirKey: string, jobId: string): Promise<{ ok: boolean; commit: string | null }> {
    const repo = this.projectDirs(dirKey).repo;
    const r = await this.git(repo, ['merge', '--ff-only', '-q', this.jobBranch(jobId)]);
    const head = await this.git(repo, ['rev-parse', 'HEAD']);
    return { ok: r.exitCode === 0, commit: head.exitCode === 0 ? head.stdout.trim() : null };
  }

  /** Arquivos da pasta principal (main) do projeto. */
  async listMainFiles(dirKey: string): Promise<Array<{ path: string; size: number }>> {
    const repo = this.projectDirs(dirKey).repo;
    const r = await this.git(repo, ['ls-tree', '-r', '-l', 'main']);
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [meta, file] = l.split('\t');
        const size = Number(meta.trim().split(/\s+/)[3]);
        return { path: file, size: Number.isFinite(size) ? size : 0 };
      });
  }

  async readMainFile(dirKey: string, file: string): Promise<Buffer | null> {
    if (file.includes('..') || file.startsWith('/')) return null;
    const repo = this.projectDirs(dirKey).repo;
    const r = await runProcess('git', ['show', `main:${file}`], { cwd: repo, env: minimalEnv({ GIT_TERMINAL_PROMPT: '0' }), timeoutMs: 30000, maxBuffer: 20 * 1024 * 1024 });
    return r.exitCode === 0 ? Buffer.from(r.stdout, 'utf8') : null;
  }

  async headCommit(worktree: string): Promise<string | null> {
    const head = await this.git(worktree, ['rev-parse', 'HEAD']);
    return head.exitCode === 0 ? head.stdout.trim() : null;
  }

  private async gitOk(cwd: string, args: string[]) {
    const r = await this.git(cwd, args);
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} falhou: ${r.stderr || r.spawnError}`);
    return r;
  }

  private git(cwd: string, args: string[]) {
    return runProcess('git', args, { cwd, env: minimalEnv({ GIT_TERMINAL_PROMPT: '0' }), timeoutMs: 60000 });
  }
}
