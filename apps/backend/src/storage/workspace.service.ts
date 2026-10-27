import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';

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
    return wt;
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
