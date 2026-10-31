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
    const missing = ['dados/', '.nivoo/memoria.md'].filter((l) => !current.split('\n').includes(l));
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
    await this.git(worktree, ['add', '-A']);
    const diff = await this.git(worktree, ['diff', '--cached', '--quiet']);
    if (diff.exitCode !== 0) await this.gitOk(worktree, ['commit', '-q', '-m', message]);
    const head = await this.git(worktree, ['rev-parse', 'HEAD']);
    return head.exitCode === 0 ? head.stdout.trim() : null;
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
