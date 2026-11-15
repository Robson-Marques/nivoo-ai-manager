import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '../config';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { sha256 } from '../common/hash';

export interface ProjectDirs {
  root: string;
  repo: string;
  knowledge: string;
  worktrees: string;
}

/** Pasta, dentro do diretório de trabalho da IA, com as cópias de leitura: base/ e conhecimento/. */
export const SESSION_CONTEXT_DIR = 'contexto';

export interface KnowledgeFile {
  path: string;
  size: number;
}

/**
 * Pastas de um projeto (<dirKey> = areas/<base>/projetos/<projeto>):
 *   repo/                 repositório git; a branch main é a "pasta principal" que acumula o trabalho
 *   conhecimento/         conhecimento enviado pelo usuário (git próprio; a IA recebe cópia, nunca altera)
 *   worktrees/<jobId>     worktree de cada job na branch job/<id>
 * Base: <WORKSPACES_ROOT>/areas/<base>/base — padrões compartilhados pelos projetos da base (git próprio).
 */
@Injectable()
export class WorkspaceService {
  projectDirs(slug: string): ProjectDirs {
    const root = resolveInside(appConfig().workspacesRoot, slug);
    return {
      root,
      repo: path.join(root, 'repo'),
      knowledge: path.join(root, 'conhecimento'),
      worktrees: path.join(root, 'worktrees'),
    };
  }

  async ensureProject(slug: string): Promise<ProjectDirs> {
    const dirs = this.projectDirs(slug);
    for (const d of [dirs.root, dirs.worktrees]) fs.mkdirSync(d, { recursive: true });
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

  // ---------- Modelos (tabela Area) ----------
  /** Pastas de um modelo: <WORKSPACES_ROOT>/areas/<slug>/{base (materiais), projetos}. */
  areaDirs(areaSlug: string): { root: string; base: string; projetos: string } {
    const root = resolveInside(appConfig().workspacesRoot, path.join('areas', areaSlug));
    return { root, base: path.join(root, 'base'), projetos: path.join(root, 'projetos') };
  }

  // ---------- Pastas de conhecimento (base e projeto): repositórios git próprios ----------
  /** Cria a pasta de conhecimento (git) com os arquivos iniciais, se ainda não existir. */
  async ensureKnowledge(dir: string, initialFiles: Record<string, string> = {}): Promise<string> {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.mkdirSync(dir, { recursive: true });
      await this.gitOk(dir, ['init', '-q', '-b', 'main']);
      await this.gitOk(dir, ['config', 'user.name', 'Nivoo AI Manager']);
      await this.gitOk(dir, ['config', 'user.email', 'nivoo@localhost']);
      for (const [rel, content] of Object.entries(initialFiles)) {
        const abs = resolveInside(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      }
      await this.git(dir, ['add', '-A']);
      await this.git(dir, ['commit', '-q', '--allow-empty', '-m', 'conhecimento inicial']);
    }
    return dir;
  }

  /** Grava (content) ou remove (null) arquivos num único commit. Devolve o commit. */
  async writeKnowledge(dir: string, files: Array<{ path: string; content: Buffer | null }>, author: string, message: string): Promise<string | null> {
    await this.ensureKnowledge(dir);
    for (const f of files) {
      const abs = resolveInside(dir, f.path);
      if (abs === dir || f.path.split(/[\\/]/).includes('.git')) throw new Error('caminho inválido');
      if (f.content === null) {
        fs.rmSync(abs, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (this.isLink(abs)) fs.rmSync(abs);
      fs.writeFileSync(abs, f.content);
    }
    await this.git(dir, ['add', '-A']);
    const diff = await this.git(dir, ['diff', '--cached', '--quiet']);
    if (diff.exitCode !== 0) {
      await this.gitOk(dir, ['-c', `user.name=${author.replace(/[^\w .@-]/g, '').slice(0, 60) || 'operador'}`, 'commit', '-q', '-m', message.slice(0, 200)]);
    }
    return this.headCommit(dir);
  }

  listKnowledge(dir: string): KnowledgeFile[] {
    const out: KnowledgeFile[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) out.push({ path: path.relative(dir, p).split(path.sep).join('/'), size: fs.statSync(p).size });
      }
    };
    walk(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  readKnowledge(dir: string, rel: string): Buffer | null {
    const abs = resolveInside(dir, rel);
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) return null;
    return fs.readFileSync(abs);
  }

  async knowledgeHistory(dir: string, limit = 30): Promise<Array<{ commit: string; date: string; author: string; message: string }>> {
    if (!fs.existsSync(path.join(dir, '.git'))) return [];
    const r = await this.git(dir, ['log', `-${limit}`, '--format=%H%x09%cI%x09%an%x09%s']);
    return r.stdout.split('\n').filter(Boolean).map((l) => {
      const [commit, date, author, message] = l.split('\t');
      return { commit, date, author, message };
    });
  }

  /**
   * Nome com que um caminho de conhecimento aparece na sessão de IA: arquivos de configuração de harness
   * (.claude/, CLAUDE.md, AGENTS.md...) viram "_claude/", "_CLAUDE.md"... — continuam legíveis como
   * referência, mas nenhum executor os carrega como configuração (hooks, permissões).
   */
  static sessionPath(rel: string): string {
    return rel
      .split('/')
      .map((seg) => (WorkspaceService.HARNESS_FILES.includes(seg) ? `_${seg.replace(/^\./, '')}` : seg))
      .join('/');
  }

  /**
   * Copia uma pasta de conhecimento para <destino> (ex.: area/ ou conhecimento/ no worktree): somente
   * leitura para o trabalho, fora do git do projeto, renovada a cada sessão. Nunca segue links.
   */
  copyKnowledgeInto(dir: string, dest: string, maxBytes = 50 * 1024 * 1024): { files: number; bytes: number; skipped: number } {
    if (fs.existsSync(dest) || this.isLink(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    let bytes = 0;
    let files = 0;
    let skipped = 0;
    for (const f of this.listKnowledge(dir)) {
      if (bytes + f.size > maxBytes) {
        skipped++;
        continue;
      }
      const target = path.join(dest, WorkspaceService.sessionPath(f.path));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(dir, f.path), target);
      bytes += f.size;
      files++;
    }
    return { files, bytes, skipped };
  }

  /**
   * Prepara contexto/ no diretório de trabalho da IA: contexto/base (padrões da base) e
   * contexto/conhecimento (conhecimento do projeto). Devolve quantos arquivos ficaram de fora pelo limite.
   */
  prepareSessionContext(areaSlug: string, projectDirKey: string, workdir: string): { skipped: number } {
    const root = path.join(workdir, SESSION_CONTEXT_DIR);
    if (fs.existsSync(root) || this.isLink(root)) fs.rmSync(root, { recursive: true, force: true });
    const a = this.copyKnowledgeInto(this.areaDirs(areaSlug).base, path.join(root, 'base'));
    const b = this.copyKnowledgeInto(this.projectDirs(projectDirKey).knowledge, path.join(root, 'conhecimento'));
    return { skipped: a.skipped + b.skipped };
  }

  /** Mudanças do worktree em relação ao ponto onde saiu da pasta principal (para a conferência das regras). */
  async diffAgainstMain(worktree: string, maxChars = 60_000): Promise<string> {
    const base = (await this.git(worktree, ['merge-base', 'main', 'HEAD'])).stdout.trim();
    if (!base) return '(sem referência da pasta principal)';
    await this.git(worktree, ['add', '-A', '--intent-to-add']); // arquivos novos aparecem no diff
    const stat = (await this.git(worktree, ['diff', '--stat', base])).stdout;
    const diff = (await this.git(worktree, ['diff', base])).stdout;
    const full = `${stat}\n${diff}`;
    return full.length > maxChars ? `${full.slice(0, maxChars)}\n… (cortado; leia os arquivos alterados diretamente)` : full || '(nenhuma mudança)';
  }

  /**
   * Instruções de agente que o PRÓPRIO repositório versiona (ex.: CLAUDE.md/AGENTS.md de um projeto
   * clonado do GitLab). Antes da sessão viram cópia legível em contexto/repositorio/ (renomeadas com "_",
   * inertes como configuração) e saem da pasta de trabalho; depois da sessão voltam intactas do git —
   * nunca são apagadas nem alteradas no repositório por causa da limpeza de segurança.
   */
  async hideRepoHarness(workdir: string, tracked?: string[]): Promise<string[]> {
    const files = tracked ?? (await this.trackedHarnessFiles(workdir));
    for (const rel of files) {
      const src = path.join(workdir, rel);
      if (!fs.existsSync(src) || this.isLink(src) || !fs.lstatSync(src).isFile()) continue;
      const dest = path.join(workdir, SESSION_CONTEXT_DIR, 'repositorio', WorkspaceService.sessionPath(rel));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return files;
  }

  /**
   * Arquivos de instrução de agente que são do próprio repositório do projeto: versionados na pasta principal
   * (main), mais os DOCUMENTOS (CLAUDE.md, AGENTS.md…) já commitados por uma etapa do trabalho. Pastas de
   * configuração (.claude/, .codex/…) criadas no trabalho continuam sendo plantio e são removidas.
   */
  async trackedHarnessFiles(worktree: string): Promise<string[]> {
    // Versionados na main e no commit da própria pasta de trabalho (o que a sessão encontra em disco).
    // Uma etapa anterior do mesmo trabalho pode ter criado (e commitado) um CLAUDE.md: ele é do trabalho e
    // precisa ser escondido e devolvido como os da main, não apagado na limpeza antes da próxima sessão.
    // Do commit do trabalho só valem documentos; pastas de configuração (.claude/…) só se a main já as tem.
    const listar = async (ref: string) => {
      const r = await this.git(worktree, ['ls-tree', '-r', '-z', '--name-only', ref]);
      return r.exitCode !== 0 ? [] : r.stdout.split('\0').filter((f) => f && f.split('/').some((seg) => WorkspaceService.HARNESS_FILES.includes(seg)));
    };
    return [...new Set([...(await listar('refs/heads/main')), ...this.docsEditaveis(await listar('HEAD'))])];
  }

  /** Devolve à pasta de trabalho as instruções de agente versionadas, exatamente como estão no git. */
  async restoreRepoHarness(worktree: string, files: string[]): Promise<void> {
    if (!files.length) return;
    // Só os que existem no commit da pasta de trabalho (a lista vem da main, que pode ter andado): um
    // arquivo ausente faria o checkout inteiro falhar e nada voltaria.
    const r = await this.git(worktree, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...files]);
    const noHead = new Set(r.exitCode === 0 ? r.stdout.split('\0').filter(Boolean) : []);
    const voltar = files.filter((f) => noHead.has(f));
    if (voltar.length) await this.gitOk(worktree, ['checkout', 'HEAD', '--', ...voltar]);
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
    const exclude = path.join(dirs.repo, '.git', 'info', 'exclude');
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    // contexto/: cópias de leitura (padrões da base e conhecimento do projeto); .nivoo/: notas e memória
    // (já gravadas no banco). Nada disso entra no git, para não conflitar ao integrar jobs na pasta principal.
    // node_modules/, __pycache__/…: dependências e caches da conferência (npm ci, testes, build) — nunca vão para o commit.
    const missing = [`${SESSION_CONTEXT_DIR}/`, '.nivoo/', 'out/', ...WorkspaceService.LIXO_DE_EXECUCAO.map((d) => `${d}/`)].filter((l) => !current.split('\n').includes(l));
    if (missing.length) fs.appendFileSync(exclude, `${current.endsWith('\n') || !current ? '' : '\n'}${missing.join('\n')}\n`);
    return wt;
  }

  /**
   * Arquivos de configuração/instrução de harnesses de agentes (hooks, plugins, memória oculta).
   * Nunca fazem parte do trabalho: são removidos do workspace antes e depois de cada sessão de IA.
   */
  static readonly HARNESS_FILES = ['.claude', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md', '.codex', '.mcp.json', '.cursor', 'GEMINI.md', '.gemini'];

  /** Documentos de instrução (texto) que o repositório versiona e a IA pode atualizar como parte do trabalho. */
  static readonly DOCS_EDITAVEIS = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md'];

  /**
   * Dos arquivos de instrução versionados, os que são documento (ex.: CLAUDE.md na raiz ou numa pasta comum),
   * nunca os de dentro de pastas de configuração (.claude/, .codex/, .gemini/: hooks, permissões, servidores).
   */
  docsEditaveis(versionados: string[]): string[] {
    return versionados.filter((f) => {
      const seg = f.split('/');
      return WorkspaceService.DOCS_EDITAVEIS.includes(seg[seg.length - 1]) && !seg.slice(0, -1).some((s) => WorkspaceService.HARNESS_FILES.includes(s));
    });
  }

  /**
   * Durante a sessão esses documentos ficam fora da pasta (a IA não os carrega como configuração); se a IA
   * escreveu um deles de novo, é a atualização pedida pelo trabalho: guarda o conteúdo para valer depois da
   * limpeza (vai para o commit do trabalho e passa pela conferência das regras como qualquer arquivo).
   */
  capturarDocsEditados(worktree: string, docs: string[]): Map<string, Buffer> {
    const editados = new Map<string, Buffer>();
    for (const rel of docs) {
      const p = path.join(worktree, rel);
      if (!fs.existsSync(p) || this.isLink(p) || !fs.lstatSync(p).isFile() || fs.statSync(p).size > 512 * 1024) continue;
      editados.set(rel, fs.readFileSync(p));
    }
    return editados;
  }

  /**
   * Documentos de instrução (CLAUDE.md, AGENTS.md, GEMINI.md…) presentes na pasta depois da sessão — editados OU
   * criados pela IA (ex.: o plano pede "registre a regra no CLAUDE.md" num repositório que ainda não tem um).
   * Nunca os de dentro de pastas de configuração (.claude/, .codex/, .gemini/), nem de contexto/, .nivoo/, out/.
   */
  docsNoTrabalho(worktree: string): string[] {
    const achados: string[] = [];
    const pular = new Set(['.git', 'node_modules', SESSION_CONTEXT_DIR, '.nivoo', 'out']);
    const walk = (dir: string, depth: number) => {
      if (depth > 6 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (depth === 0 && pular.has(e.name)) continue;
        if (e.name === '.git' || e.name === 'node_modules' || e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        if (e.isFile() && WorkspaceService.DOCS_EDITAVEIS.includes(e.name)) achados.push(path.relative(worktree, p));
        else if (e.isDirectory() && !WorkspaceService.HARNESS_FILES.includes(e.name)) walk(p, depth + 1);
      }
    };
    walk(worktree, 0);
    return achados;
  }

  gravarDocsEditados(worktree: string, editados: Map<string, Buffer>): void {
    for (const [rel, conteudo] of editados) {
      const p = resolveInside(worktree, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, conteudo);
    }
  }

  /** Pastas que são só instalação ou cache (refeitas quando preciso): nunca são resultado do trabalho. */
  static readonly LIXO_DE_EXECUCAO = ['node_modules', '__pycache__', '.pytest_cache', '.cache', '.npm', '.turbo'];

  /**
   * Limpeza ao fim de cada trabalho (concluído, parado ou com falha): apaga da pasta do trabalho as dependências e
   * caches criados pela conferência (npm ci, testes, build). Só pastas que o git NÃO versiona; o resto fica intacto.
   * Devolve quantos MB foram liberados.
   */
  async limparLixoDeExecucao(worktree: string): Promise<{ removidos: string[]; mb: number }> {
    const removidos: string[] = [];
    let bytes = 0;
    if (!fs.existsSync(worktree)) return { removidos, mb: 0 };
    const arquivosVersionados = (await this.git(worktree, ['ls-files', '-z'])).stdout.split('\0').filter(Boolean);
    const temVersionado = (rel: string) => arquivosVersionados.some((f) => f.startsWith(`${rel}/`));
    const tamanho = (p: string): number => {
      let n = 0;
      const pilha = [p];
      while (pilha.length) {
        const atual = pilha.pop()!;
        let st: fs.Stats;
        try {
          st = fs.lstatSync(atual);
        } catch {
          continue;
        }
        if (st.isDirectory()) for (const e of fs.readdirSync(atual)) pilha.push(path.join(atual, e));
        else n += st.size;
      }
      return n;
    };
    const walk = (dir: string, depth: number) => {
      if (depth > 6) return;
      let entradas: fs.Dirent[];
      try {
        entradas = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entradas) {
        if (!e.isDirectory() || e.isSymbolicLink() || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        const rel = path.relative(worktree, p);
        if (WorkspaceService.LIXO_DE_EXECUCAO.includes(e.name)) {
          // Pasta que o projeto versiona (ex.: um .cache/ de propósito): fica — só sai o que o git não guarda.
          if (temVersionado(rel)) continue;
          bytes += tamanho(p);
          fs.rmSync(p, { recursive: true, force: true });
          removidos.push(rel);
        } else if (depth === 0 && [SESSION_CONTEXT_DIR, 'out', '.nivoo'].includes(e.name)) continue;
        else walk(p, depth + 1);
      }
    };
    walk(worktree, 0);
    return { removidos, mb: Math.round(bytes / 1024 / 1024) };
  }

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
  /**
   * Incorpora o trabalho verificado à pasta principal como UM commit (squash), com mensagem legível — o
   * histórico do projeto (e do repositório Git, quando ligado) fica limpo, sem os checkpoints internos.
   * Só acontece se a pasta principal não mudou desde a verificação (main contida na branch do job);
   * senão devolve ok=false e a conclusão reintegra e reverifica.
   */
  async integrateIntoMain(dirKey: string, jobId: string, message: string): Promise<{ ok: boolean; commit: string | null; mudou?: boolean }> {
    const repo = this.projectDirs(dirKey).repo;
    const branch = this.jobBranch(jobId);
    if ((await this.git(repo, ['merge-base', '--is-ancestor', 'main', branch])).exitCode !== 0) return { ok: false, commit: null };
    const sq = await this.git(repo, ['merge', '--squash', '-q', branch]);
    if (sq.exitCode !== 0) {
      await this.git(repo, ['reset', '--hard', '-q', 'HEAD']);
      return { ok: false, commit: null };
    }
    const mudou = (await this.git(repo, ['diff', '--cached', '--quiet'])).exitCode !== 0;
    if (mudou) await this.gitOk(repo, ['commit', '-q', '-m', message]);
    const head = await this.git(repo, ['rev-parse', 'HEAD']);
    return { ok: true, commit: head.exitCode === 0 ? head.stdout.trim() : null, mudou };
  }

  /** Arquivos da pasta principal (main) do projeto. */
  /** Arquivos que um commit da pasta principal criou (A), alterou (M), apagou (D) ou renomeou (R). */
  async arquivosDoCommit(dirKey: string, commit: string): Promise<Array<{ status: string; path: string; de?: string }>> {
    if (!/^[0-9a-f]{7,40}$/.test(commit)) return [];
    // -z: nomes com acento ou espaço vêm como são (sem aspas nem \303\263).
    const r = await this.git(this.projectDirs(dirKey).repo, ['diff-tree', '-z', '--no-commit-id', '--name-status', '-r', '-M', '--root', commit]);
    if (r.exitCode !== 0) return [];
    const campos = r.stdout.split('\0');
    const out: Array<{ status: string; path: string; de?: string }> = [];
    for (let i = 0; i < campos.length; ) {
      const st = campos[i++];
      if (!st) continue;
      if (st.startsWith('R') || st.startsWith('C')) {
        const de = campos[i++];
        const para = campos[i++];
        out.push(st.startsWith('R') ? { status: 'R', path: para, de } : { status: 'A', path: para });
      } else out.push({ status: st[0], path: campos[i++] });
    }
    return out.filter((f) => f.path && !f.path.startsWith('.nivoo/'));
  }

  async listMainFiles(dirKey: string): Promise<Array<{ path: string; size: number }>> {
    const repo = this.projectDirs(dirKey).repo;
    const r = await this.git(repo, ['ls-tree', '-r', '-l', '-z', 'refs/heads/main']);
    return r.stdout
      .split('\0')
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
    // Bytes exatos (vídeo, imagem): ler a saída do git como texto corrompia todo arquivo binário.
    try {
      const { stdout } = await execFileAsync('git', ['cat-file', 'blob', `main:${file}`], {
        cwd: repo, env: minimalEnv({ GIT_TERMINAL_PROMPT: '0' }), timeout: 120_000, maxBuffer: 1024 * 1024 * 1024, encoding: 'buffer',
      });
      return stdout as Buffer;
    } catch {
      return null;
    }
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
