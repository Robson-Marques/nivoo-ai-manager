import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { optString, reqString } from '../common/validate';
import { deleteGitAccount, getGitAccount, listGitAccounts, normalizeHost, publicAccount, saveGitAccount, updateGitAccount } from './git-accounts';
import { listarNamespaces, listarRepos } from './git-hosting';
import { GitService } from './git.service';

/** Usuário padrão do login por token em cada tipo de servidor. */
const USUARIO_TOKEN = { github: 'x-access-token', gitlab: 'oauth2' } as const;

@Controller()
export class GitController {
  constructor(private readonly git: GitService) {}

  // ---------- Contas Git ----------
  /** Repositórios da conta (para escolher em vez de digitar o endereço). */
  @Get('git/accounts/:id/repos')
  repos(@Param('id', ParseUUIDPipe) id: string, @Query('busca') busca?: string) {
    return listarRepos(getGitAccount(id), String(busca ?? '').slice(0, 100));
  }

  /** Onde a conta pode criar repositórios: o usuário e os grupos/organizações. */
  @Get('git/accounts/:id/namespaces')
  namespaces(@Param('id', ParseUUIDPipe) id: string) {
    return listarNamespaces(getGitAccount(id));
  }

  @Get('git/accounts')
  accounts() {
    return listGitAccounts().map(publicAccount);
  }

  /** Cadastra uma conta (GitHub ou GitLab próprio). Por padrão confere o token no servidor antes de salvar. */
  @Post('git/accounts')
  async addAccount(@Body() body: any) {
    const tipo = body?.tipo === 'github' ? 'github' : body?.tipo === 'gitlab' ? 'gitlab' : null;
    if (!tipo) throw new BadRequestException('tipo deve ser github ou gitlab');
    const host = normalizeHost(body?.host ?? (tipo === 'github' ? 'https://github.com' : ''));
    const token = reqString(body, 'token', 500).trim();
    if (/\s/.test(token) || token.length < 8) throw new BadRequestException('Token inválido');
    const usuario = optString(body, 'usuario', 100) ?? USUARIO_TOKEN[tipo];
    if (body?.verificar !== false) await GitController.conferirToken(tipo, host, token);
    const conta = saveGitAccount({
      nome: optString(body, 'nome', 100) ?? `${tipo === 'github' ? 'GitHub' : 'GitLab'} (${new URL(host).host})`,
      tipo,
      host,
      usuario,
      token,
      autorNome: optString(body, 'autorNome', 100),
      autorEmail: optString(body, 'autorEmail', 200),
    });
    return publicAccount(conta);
  }

  /** Confere o token na API do servidor (GitHub: /user; GitLab: /api/v4/user). */
  static async conferirToken(tipo: 'github' | 'gitlab', host: string, token: string): Promise<string> {
    const url = tipo === 'github' ? (host === 'https://github.com' ? 'https://api.github.com/user' : `${host}/api/v3/user`) : `${host}/api/v4/user`;
    const headers: Record<string, string> = tipo === 'github' ? { Authorization: `Bearer ${token}`, 'User-Agent': 'nivoo-ai-manager' } : { 'PRIVATE-TOKEN': token };
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    } catch (e: any) {
      throw new BadRequestException(`Não foi possível falar com ${host} (${e?.cause?.code ?? e?.message ?? 'erro de rede'}). Confira o endereço.`);
    }
    if (res.status === 401 || res.status === 403) throw new BadRequestException('O servidor recusou o token (inválido, expirado ou sem permissão).');
    if (!res.ok) throw new BadRequestException(`O servidor respondeu ${res.status} ao conferir o token. Confira o endereço e o tipo (GitHub/GitLab).`);
    const u: any = await res.json().catch(() => ({}));
    return String(u.login ?? u.username ?? '');
  }

  /** Renomear (`{ nome }`) e/ou trocar o token (`{ token }`, conferido no servidor antes de salvar). */
  @Patch('git/accounts/:id')
  async updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const nome = optString(body, 'nome', 100)?.trim();
    const token = optString(body, 'token', 500)?.trim();
    if (!nome && !token) throw new BadRequestException('Informe o nome e/ou o token');
    if (token) {
      if (/\s/.test(token) || token.length < 8) throw new BadRequestException('Token inválido');
      const c = getGitAccount(id);
      if (body?.verificar !== false) await GitController.conferirToken(c.tipo, c.host, token);
    }
    return publicAccount(updateGitAccount(id, { nome, token }));
  }

  /** Confere agora se o token ainda vale (botão "testar"). */
  @Post('git/accounts/:id/testar')
  async testAccount(@Param('id', ParseUUIDPipe) id: string) {
    const c = getGitAccount(id);
    const usuario = await GitController.conferirToken(c.tipo, c.host, c.token);
    return { ok: true, usuario };
  }

  @Delete('git/accounts/:id')
  removeAccount(@Param('id', ParseUUIDPipe) id: string) {
    deleteGitAccount(id);
    return { ok: true };
  }

  // ---------- Git do projeto ----------
  @Get('projects/:pid/git')
  status(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.git.status(pid);
  }

  @Post('projects/:pid/git/link')
  link(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.git.link(pid, body);
  }

  /** Cria um repositório novo na conta escolhida, liga o projeto a ele e envia tudo. */
  @Post('projects/:pid/git/create')
  createRemote(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.git.createRemote(pid, body);
  }

  @Delete('projects/:pid/git')
  unlink(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.git.unlink(pid);
  }

  @Patch('projects/:pid/git')
  settings(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    if (typeof body?.autoEnvio !== 'boolean') throw new BadRequestException('autoEnvio deve ser true ou false');
    return this.git.setAutoPush(pid, body.autoEnvio);
  }

  @Post('projects/:pid/git/pull')
  pull(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.git.pull(pid);
  }

  @Post('projects/:pid/git/push')
  push(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.git.push(pid, body);
  }
}
