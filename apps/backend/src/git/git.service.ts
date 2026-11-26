import { acima, maiorEtiqueta, proximaNoPadrao, versaoDeclarada } from './versao';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess, RunResult } from '../common/exec';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { getGitAccount, GitAccount, listGitAccounts, normalizeHost } from './git-accounts';
import { criarRepo } from './git-hosting';

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
  accountFor(url: string, accountId?: string | null, confiar = false): GitAccount | null {
    if (accountId) {
      const c = getGitAccount(accountId);
      if (!confiar && !url.startsWith('/') && !url.startsWith('file://') && normalizeHost(new URL(url).origin) !== c.host) {
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
    if (/Authentication failed|could not read Username|returned error: 40[13]|\b40[13]\b(?! *[a-f0-9])|Invalid username or password|access denied/i.test(msg)) {
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
    return { p, repo: this.workspace.projectDirs(p.dirKey).repo, conta: this.accountFor(p.gitUrl, p.gitAccountId, true), branch: p.gitBranch };
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
  async link(projectId: string, body: any, criadoPelaConta = false) {
    const p = await this.project(projectId);
    const url = normalizeRepoUrl(body?.url);
    const branch = checkBranch(body?.branch);
    // Repositório que a própria conta acabou de criar: o servidor pode devolver outro endereço público
    // (external_url do GitLab), então não exige o mesmo host da conta.
    const conta = this.accountFor(url, body?.accountId ?? null, criadoPelaConta);
    const repo = this.workspace.projectDirs(p.dirKey).repo;
    const tem = (await this.git(repo, ['remote'], null)).stdout.split('\n').includes('origin');
    await this.ok(repo, ['remote', tem ? 'set-url' : 'add', 'origin', url], null);
    await this.identidade(repo, conta);
    // Ligado ao Git = versionamento padrão (commit + tag + push a cada trabalho concluído).
    await this.prisma.project.update({ where: { id: projectId }, data: { gitUrl: url, gitBranch: branch, gitAccountId: conta?.id ?? null, gitAutoPush: true } });
    return this.status(projectId);
  }

  /**
   * Cria um repositório novo na conta escolhida (GitHub ou GitLab), liga o projeto a ele e envia a pasta
   * principal. Se o projeto já estava ligado a outro repositório, passa a usar o novo (mudança de servidor,
   * ex.: do GitHub para o GitLab): todo o histórico vai junto; o repositório antigo não é alterado.
   */
  async createRemote(projectId: string, body: any) {
    const p = await this.project(projectId);
    if (!body?.accountId) throw new BadRequestException('Escolha a conta Git onde criar o repositório');
    const conta = getGitAccount(String(body.accountId));
    const tipoNamespace = body?.tipoNamespace === 'grupo' ? 'grupo' : 'usuario';
    const criado = await criarRepo(conta, {
      namespace: body?.namespace ? String(body.namespace) : undefined,
      tipoNamespace,
      nome: body?.nome ?? p.name,
      privado: body?.privado !== false,
      descricao: p.description ?? undefined,
    });
    await this.link(projectId, { url: criado.url, branch: 'main', accountId: conta.id }, true);
    const envio = await this.push(projectId).catch((e) => ({ erroEnvio: e?.message ?? String(e) }));
    if (body?.autoEnvio !== false) await this.prisma.project.update({ where: { id: projectId }, data: { gitAutoPush: true } });
    return { criado, ...('erroEnvio' in envio ? envio : {}), ...(await this.status(projectId)) };
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
    // Endereço e conta gravados juntos no vínculo (já conferidos ali, ou repositório criado pela própria conta).
    const conta = this.accountFor(p.gitUrl, p.gitAccountId, true);
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
    // A rede (fetch) fica fora da trava: sob ela só o merge local, rápido.
    await this.ok(repo, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], conta);
    const remoto = `refs/remotes/origin/${branch}`;
    const resultado = await this.comTrava(projectId, async () => {
      if ((await this.git(repo, ['merge-base', '--is-ancestor', remoto, 'refs/heads/main'], null)).exitCode === 0) return 'ja-atualizado';
      const ff = await this.git(repo, ['merge', '--ff-only', '-q', remoto], null);
      if (ff.exitCode !== 0) {
        const m = await this.git(repo, ['merge', '--no-edit', '-q', '-m', `Atualiza do repositório (${branch})`, remoto], null);
        if (m.exitCode !== 0) {
          await this.git(repo, ['merge', '--abort'], null);
          throw new ConflictException('As mudanças do repositório conflitam com as daqui (mesmos arquivos alterados dos dois lados). Nada foi alterado. Resolva no repositório e tente de novo.');
        }
      }
      return 'atualizado';
    });
    if (resultado === 'atualizado') await this.prisma.project.update({ where: { id: p.id }, data: { gitLastSyncAt: new Date() } });
    return { resultado, ...(await this.status(projectId)) };
  }

  /** Nome de tag aceito: letras, números, ponto, hífen e sublinhado; nunca o nome de uma branch. */
  private async tagValida(repo: string, tag: string): Promise<void> {
    const ok = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(tag) && !/\.\.|\.lock$|\.$/.test(tag) && tag !== 'HEAD';
    if (!ok || (await this.git(repo, ['check-ref-format', `refs/tags/${tag}`], null)).exitCode !== 0) throw new BadRequestException('Nome de tag inválido');
    if ((await this.git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${tag}`], null)).exitCode === 0) throw new BadRequestException(`"${tag}" é nome de branch; escolha outro nome de tag`);
  }

  /**
   * Envia a pasta principal para a branch do repositório; com `tag`, cria a tag e envia as duas juntas
   * (atômico: ou vão branch e tag, ou nada). Não usa a trava: só lê a pasta principal, não a altera.
   */
  async push(projectId: string, body: any = {}) {
    const { p, repo, conta, branch } = await this.linked(projectId);
    const tag = body?.tag ? String(body.tag).trim() : '';
    if (tag) await this.tagValida(repo, tag);
    const commit = (await this.ok(repo, ['rev-parse', '--verify', 'refs/heads/main^{commit}'], null)).stdout.trim();
    if (tag) {
      const t = await this.git(repo, ['tag', '-a', '-m', String(body?.mensagem ?? `Versão ${tag}`).slice(0, 500), '--', tag, commit], null);
      if (t.exitCode !== 0) throw new ConflictException(/already exists/i.test(t.stderr) ? `A tag ${tag} já existe` : GitService.erro(t, null));
    }
    const refs = [`${commit}:refs/heads/${branch}`, ...(tag ? [`refs/tags/${tag}`] : [])];
    const r = await this.git(repo, ['push', '--quiet', ...(tag ? ['--atomic'] : []), 'origin', ...refs], conta, 15 * 60_000);
    if (r.exitCode !== 0) {
      if (tag) await this.git(repo, ['tag', '-d', '--', tag], null); // nada foi enviado: a tag local sai também
      const txt = `${r.stderr}\n${r.stdout}`;
      if (/\(fetch first\)|non-fast-forward/i.test(txt)) {
        throw new ConflictException('O repositório tem mudanças que ainda não estão aqui. Use "Atualizar do Git" primeiro e envie de novo.');
      }
      if (/remote rejected|declined|protected branch/i.test(txt)) {
        throw new BadRequestException(`O servidor Git recusou o envio (branch protegida ou regra do repositório): ${txt.replace(/https?:\/\/[^@\s]*@/g, 'https://').trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
      }
      if (tag && /already exists/i.test(txt)) throw new ConflictException(`A tag ${tag} já existe no repositório`);
      throw new BadRequestException(`Não foi possível enviar: ${GitService.erro(r, conta)}`);
    }
    await this.prisma.project.update({ where: { id: p.id }, data: { gitLastSyncAt: new Date() } });
    return { resultado: 'enviado', tag: tag || null, ...(await this.status(projectId)) };
  }

  /**
   * Próxima versão: a declarada no projeto (package.json…) quando ainda não tem etiqueta; senão segue as tags X.Y.Z
   * do repositório (remoto incluído) e sobe o último número; sem nenhuma, v0.1.0.
   */
  async proximaVersao(projectId: string): Promise<string> {
    const { repo, conta } = await this.linked(projectId);
    await this.git(repo, ['fetch', '--quiet', '--tags', 'origin'], conta); // repositório vazio: sem tags, segue
    const tags = (await this.git(repo, ['tag', '-l'], null)).stdout.split('\n').map((t) => t.trim()).filter(Boolean);
    const maior = maiorEtiqueta(tags);
    const prefixo = maior?.prefixo ?? 'v';
    // A versão que o PROJETO declara (package.json, pyproject.toml, VERSION) manda: se o trabalho subiu para 0.4.0, a
    // etiqueta é v0.4.0 — antes saía "v0.1.0" (ou a anterior + 1), diferente do número dentro do projeto.
    const declarada = (await versaoDeclarada(repo))?.versao ?? null;
    if (declarada && acima(declarada, maior?.versao ?? null)) {
      const t = `${prefixo}${declarada.join('.')}`;
      if (!tags.includes(t)) return t;
    }
    if (!maior) return 'v0.1.0';
    // Padrão de versão do usuário: cada casa de 0 a 99 (0.11.99 → 0.12.0; 0.99.99 → 1.0.0).
    let nova = proximaNoPadrao(maior.versao);
    while (tags.includes(`${prefixo}${nova.join('.')}`)) nova = proximaNoPadrao(nova);
    return `${prefixo}${nova.join('.')}`;
  }

  /**
   * Versionamento padrão de projeto ligado ao Git, ao fim de cada trabalho: o commit já está na pasta principal;
   * cria a tag da próxima versão e envia (push). Se o repositório andou, atualiza (pull) e envia de novo.
   */
  /** Publish a durable job version. Never delete or allocate a replacement
   * tag after an uncertain network result. A replay uses the same target. */
  async publishExactVersion(projectId:string,tag:string,commit:string,message:string):Promise<void>{
    const {p,repo,conta,branch}=await this.linked(projectId);
    await this.tagValida(repo,tag);
    if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))throw new BadRequestException('Commit de publicação inválido.');
    const tagRef='refs/tags/'+tag,branchRef='refs/heads/'+branch;
    const remote=async()=>{
      const r=await this.ok(repo,['ls-remote','origin',branchRef,tagRef,tagRef+'^{}'],conta);
      return new Map(r.stdout.trim().split('\n').filter(Boolean).map(line=>{const [oid,ref]=line.split(/\s+/);return [ref,oid] as const;}));
    };
    const checkBranch=async(oid:string|undefined)=>{
      if(!oid)return 'absent';
      await this.ok(repo,['fetch','--quiet','--no-tags','origin',branchRef],conta);
      const fetched=(await this.ok(repo,['rev-parse','FETCH_HEAD'],null)).stdout.trim();
      if((await this.git(repo,['merge-base','--is-ancestor',commit,fetched],null)).exitCode===0)return 'contains';
      if((await this.git(repo,['merge-base','--is-ancestor',fetched,commit],null)).exitCode===0)return 'behind';
      return 'diverged';
    };
    const refs=await remote(),tagged=refs.get(tagRef+'^{}')??refs.get(tagRef);
    if(tagged&&tagged!==commit)throw new ConflictException('A versão '+tag+' aponta para outro commit; publicação original preservada.');
    const relation=await checkBranch(refs.get(branchRef));
    if(tagged===commit&&relation==='contains'){await this.prisma.project.update({where:{id:p.id},data:{gitLastSyncAt:new Date()}});return;}
    if(relation==='diverged')throw new ConflictException('A branch remota divergiu do commit verificado. Não enviar nem alterar a versão automaticamente.');
    const local=await this.git(repo,['rev-parse','--verify',tagRef+'^{commit}'],null);
    if(local.exitCode===0&&local.stdout.trim()!==commit)throw new ConflictException('Tag local '+tag+' aponta para outro commit.');
    if(local.exitCode!==0){
      if(tagged===commit){await this.ok(repo,['fetch','--quiet','origin',tagRef+':'+tagRef],conta);}
      else await this.ok(repo,['tag','-a','-m',message.slice(0,500),'--',tag,commit],null);
    }
    const pushRefs=[...(relation==='contains'?[]:[commit+':'+branchRef]),...(tagged===commit?[]:[tagRef])];
    if(pushRefs.length)await this.ok(repo,['push','--quiet','--atomic','origin',...pushRefs],conta,15*60_000);
    const after=await remote();
    if((after.get(tagRef+'^{}')??after.get(tagRef))!==commit||await checkBranch(after.get(branchRef))!=='contains')throw new ConflictException('Envio sem confirmação integral; mantenha a mesma versão para reconciliar.');
    await this.prisma.project.update({where:{id:p.id},data:{gitLastSyncAt:new Date()}});
  }

  async versionar(projectId: string, mensagem: string): Promise<{ tag: string; atualizou: boolean }> {
    let atualizou = false;
    for (let tentativa = 0; ; tentativa++) {
      const tag = await this.proximaVersao(projectId);
      try {
        await this.push(projectId, { tag, mensagem });
        return { tag, atualizou };
      } catch (e: any) {
        const msg = String(e?.message ?? '');
        if (!(e instanceof ConflictException) || tentativa >= 3) throw e;
        if (/já existe/.test(msg)) continue; // outro trabalho pegou esse número ao mesmo tempo: o próximo
        if (!/mudanças que ainda não estão aqui/.test(msg) || atualizou) throw e;
        await this.pull(projectId);
        atualizou = true;
      }
    }
  }
}
