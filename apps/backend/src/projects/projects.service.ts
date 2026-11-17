import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { aiConnectionIds, listarConexoes, tipoDe } from '../accounts/connections';
import { apagarVariaveisDaConferencia, gravarReferenciaDaConferencia, gravarVariavelDaConferencia, nomesDasVariaveisDaConferencia, referenciasDaConferencia } from '../accounts/secrets';
import { listGitAccounts } from '../git/git-accounts';
import { apagarVideoEnviado, arquivoDaMidia, gravarVideoEnviado, listarVideos } from './midia';
import { Readable } from 'node:stream';
import { moverTrabalhoParaIa } from './mover-trabalho';
import { appConfig } from '../config';
import { resolveInside } from '../common/path-guard';
import { DEFAULT_AREA, findTemplate } from '../areas/area-templates';
import { AreasService } from '../areas/areas.service';
import { sha256 } from '../common/hash';
import { knowledgePath, parseKnowledgeUpload, toTextFiles } from '../common/knowledge-upload';
import { optNumber, optString, reqString, slugify } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { checkModelName } from '../providers/model-catalog.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { WorkspaceService } from '../storage/workspace.service';
import { BlockedReason } from '../common/status';
import { ConversationsService } from '../conversations/conversations.service';
import { QueueService } from '../queue/queue.service';
import { checkBranch, GitService, normalizeRepoUrl } from '../git/git.service';

/** IAs que conversam e trabalham num projeto: agentes que leem e editam arquivos (o executor local não é IA). */


/**
 * Projeto = pasta de trabalho + "fine-tune do projeto": base escolhida, regras próprias (versionadas),
 * conhecimento enviado pelo usuário, memória automática da conversa e a IA que trabalha nele.
 */
import { escreverArquivosDaMemoria, gravarNoProjeto } from '../memory/camadas';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly areas: AreasService,
    private readonly registry: ProviderRegistry,
    private readonly queue: QueueService,
    private readonly git: GitService,
  ) {}

  async create(body: any) {
    const name = reqString(body, 'name', 200);
    const slug = slugify(optString(body, 'slug', 60) ?? name);
    if (!slug) throw new BadRequestException('Nome inválido');
    if (await this.prisma.project.findUnique({ where: { slug } })) throw new ConflictException(`Já existe um projeto com o nome "${name}"`);
    const area = await this.resolveArea(optString(body, 'base', 60) ?? DEFAULT_AREA);
    const provider = this.checkProvider(optString(body, 'provider', 60) ?? listarConexoes().find((c) => c.padrao)?.id ?? 'claude-code-cli');
    const dirKey = `areas/${area.slug}/projetos/${slug}`;
    // Projeto a partir de um repositório Git existente: clona primeiro; a branch escolhida vira a pasta principal.
    let git: { url: string; branch: string; accountId: string | null } | null = null;
    if (body?.git?.url) {
      const url = normalizeRepoUrl(body.git.url);
      const branch = checkBranch(body.git.branch);
      git = { url, branch, accountId: this.git.accountFor(url, body.git.accountId ?? null)?.id ?? null };
      const destino = this.workspace.projectDirs(dirKey).repo;
      if (fs.existsSync(destino)) throw new ConflictException('Já existe uma pasta para este projeto');
      await this.git.cloneInto(destino, git);
    }
    const dirs = await this.workspace.ensureProject(dirKey);
    await this.workspace.ensureKnowledge(dirs.knowledge);
    const description = optString(body, 'description', 20000) ?? '';
    const author = optString(body, 'author', 100) ?? 'usuario';
    const project = await this.prisma.project.create({ data: { name, slug, description, areaId: area.id, dirKey, workspacePath: dirs.root, provider, gitUrl: git?.url, gitBranch: git?.branch, gitAccountId: git?.accountId, gitAutoPush: !!git } });
    if (description) {
      await gravarNoProjeto(this.prisma, { projectId: project.id, category: 'ESPECIFICACAO', title: 'Sobre o projeto', content: description, author });
      await escreverArquivosDaMemoria(this.prisma, project.id);
    }
    const rules = optString(body, 'rules', 50000);
    if (rules) await this.newRules(project.id, { text: rules, reason: 'regras iniciais', author });
    return this.get(project.id);
  }

  /** Base existente (slug/id) ou base pronta ainda não criada (criada na primeira vez). */
  private async resolveArea(ref: string) {
    const existing = await this.prisma.area.findFirst({ where: { OR: [{ id: ref }, { slug: ref }] } });
    if (existing) return existing;
    const t = findTemplate(ref);
    if (!t) throw new NotFoundException('Modelo não encontrado');
    const created = await this.areas.create({ name: t.name, template: t.key, slug: t.key }).catch(async (e) => {
      if (e instanceof ConflictException) return this.prisma.area.findUniqueOrThrow({ where: { slug: t.key } });
      throw e;
    });
    return this.prisma.area.findUniqueOrThrow({ where: { id: created.id } });
  }

  private checkProvider(id: string): string {
    if (!tipoDe(id) || !this.registry.has(id)) throw new BadRequestException(`IA desconhecida: ${id}. Opções: ${aiConnectionIds().join(', ')}`);
    return id;
  }

  /** Projetos ativos (os arquivados ficam em GET /arquivados). */
  list() {
    return this.prisma.project.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { area: { select: { id: true, slug: true, name: true } } },
    });
  }

  async get(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id }, include: { area: { select: { id: true, slug: true, name: true } } } });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    const [rules, jobs, conversa] = await Promise.all([
      this.prisma.projectRule.findFirst({ where: { projectId: id }, orderBy: { version: 'desc' } }),
      this.prisma.job.aggregate({ where: { projectId: id }, _sum: { costSpentUsd: true } }),
      this.prisma.conversationMessage.aggregate({ where: { conversation: { projectId: id } }, _sum: { costUsd: true } }),
    ]);
    return {
      ...p,
      rules,
      knowledgeFiles: this.workspace.listKnowledge(this.workspace.projectDirs(p.dirKey).knowledge),
      custoGastoUsd: Number(jobs._sum.costSpentUsd ?? 0) + Number(conversa._sum.costUsd ?? 0),
    };
  }

  /** Ajustes simples: nome, descrição, IA e modelo do projeto, limite de gasto (null = sem limite) e arquivar. */
  async update(id: string, body: any) {
    await this.assertExists(id);
    const data: Record<string, unknown> = {};
    const name = optString(body, 'name', 200);
    if (name) data.name = name;
    const description = optString(body, 'description', 20000);
    if (description !== undefined) data.description = description;
    const provider = optString(body, 'provider', 60);
    if (provider) data.provider = this.checkProvider(provider);
    // Modelo da IA (por IA: trocar de IA e voltar mantém a escolha). null/"" = padrão da IA.
    if (body && 'model' in body) {
      const atual = await this.prisma.project.findUniqueOrThrow({ where: { id }, select: { provider: true, aiModels: true } });
      // "modeloDe": guardar o modelo de outro conector (ex.: gemini-video) sem trocar a IA do projeto.
      const de = optString(body, 'modeloDe', 60);
      if (de && !this.registry.has(de)) throw new BadRequestException(`Conector desconhecido: ${de}`);
      const ia = de ?? (data.provider as string | undefined) ?? atual.provider;
      const modelos = { ...((atual.aiModels ?? {}) as Record<string, string>) };
      if (body.model === null || body.model === '') delete modelos[ia];
      else modelos[ia] = checkModelName(body.model);
      data.aiModels = modelos;
    }
    // IAs reserva (em ordem): para onde o trabalho vai sozinho se a IA do projeto ficar sem crédito/limite.
    if (body && 'reserva' in body) {
      if (!Array.isArray(body.reserva)) throw new BadRequestException('reserva deve ser uma lista de conexões');
      const lista = [...new Set(body.reserva.map(String))] as string[];
      for (const id of lista) if (!tipoDe(id) || !this.registry.has(id)) throw new BadRequestException(`Conexão desconhecida: ${id}`);
      data.aiReserva = lista;
    }
    if (typeof body?.archived === 'boolean') data.archivedAt = body.archived ? new Date() : null;
    if (typeof body?.seguirSozinho === 'boolean') data.seguirSozinho = body.seguirSozinho;
    if (body && 'maxCostUsd' in body) data.maxCostUsd = body.maxCostUsd === null ? null : optNumber(body, 'maxCostUsd', 0, 1_000_000);
    await this.prisma.project.update({ where: { id }, data });
    if (data.provider) await moverTrabalhoParaIa(this.prisma, id, String(data.provider));
    return this.get(id);
  }

  /** Nova versão das regras do projeto (a anterior fica no histórico). */
  async newRules(id: string, body: any) {
    const p = await this.assertExists(id);
    const text = reqString(body, 'text', 50000);
    const version = p.rulesVersion + 1;
    await this.prisma.$transaction([
      this.prisma.projectRule.create({
        data: { projectId: id, version, text, sha256: sha256(text), author: optString(body, 'author', 100) ?? 'usuario', reason: optString(body, 'reason', 2000) ?? '' },
      }),
      this.prisma.project.update({ where: { id }, data: { rulesVersion: version } }),
    ]);
    return this.get(id);
  }

  rulesHistory(id: string) {
    return this.prisma.projectRule.findMany({ where: { projectId: id }, orderBy: { version: 'desc' } });
  }

  // ---------- Conhecimento do projeto (pasta própria, versionada; a IA recebe cópia de leitura) ----------
  async importKnowledge(id: string, body: any) {
    const p = await this.assertExists(id);
    const parsed = parseKnowledgeUpload(body);
    const { files, convertidos, recusados } = await toTextFiles(parsed.files);
    const ignorados = [...parsed.ignorados, ...recusados];
    const commit = !files.length ? null : await this.workspace.writeKnowledge(
      this.workspace.projectDirs(p.dirKey).knowledge,
      files,
      optString(body, 'author', 100) ?? 'usuario',
      optString(body, 'message', 200) ?? `envia ${files.length} arquivo(s)`,
    );
    return { importados: files.length, bytes: files.reduce((n, f) => n + f.content.length, 0), ignorados, convertidos, commit };
  }

  async knowledgeFile(id: string, rel: string) {
    const p = await this.assertExists(id);
    const c = this.workspace.readKnowledge(this.workspace.projectDirs(p.dirKey).knowledge, knowledgePath(rel));
    if (!c) throw new NotFoundException('Arquivo não encontrado no conhecimento do projeto');
    return c;
  }

  async deleteKnowledge(id: string, rel: string, author = 'usuario') {
    const p = await this.assertExists(id);
    const dir = this.workspace.projectDirs(p.dirKey).knowledge;
    const file = knowledgePath(rel);
    if (!this.workspace.readKnowledge(dir, file)) throw new NotFoundException('Arquivo não encontrado no conhecimento do projeto');
    return { path: file, commit: await this.workspace.writeKnowledge(dir, [{ path: file, content: null }], author, `remove ${file}`) };
  }

  // ---------- Pasta principal (o que os trabalhos concluídos produziram) ----------
  async files(id: string) {
    const p = await this.assertExists(id);
    return { arquivos: await this.workspace.listMainFiles(p.dirKey) };
  }

  async fileContent(id: string, file: string) {
    const p = await this.assertExists(id);
    const c = file ? await this.workspace.readMainFile(p.dirKey, String(file)) : null;
    if (!c) throw new NotFoundException('Arquivo não encontrado na pasta principal do projeto');
    return c;
  }

  /**
   * Exclui o projeto: banco (conversas, trabalhos, memória, regras), pasta do projeto e artefatos.
   * Antes, PARA tudo o que estiver rodando nele (trabalhos e respostas da IA) — excluir nunca fica preso.
   */
  /**
   * Variáveis da conferência: nomes de valores fixos (nunca os valores) + as que usam o token de uma conta Git
   * conectada (com o nome da conta, nunca o token). Também devolve as contas Git para a tela oferecer a escolha.
   */
  async variaveisDaConferencia(id: string) {
    await this.assertExists(id);
    const contas = listGitAccounts();
    const refs = referenciasDaConferencia(id);
    return {
      variaveis: nomesDasVariaveisDaConferencia(id),
      doGit: Object.entries(refs).map(([nome, contaId]) => {
        const c = contas.find((x) => x.id === contaId);
        return { nome, contaId, conta: c ? `${c.nome} (${c.host.replace(/^https?:\/\//, '')})` : 'conta removida' };
      }),
      contasGit: contas.map((c) => ({ id: c.id, nome: c.nome, host: c.host.replace(/^https?:\/\//, ''), tipo: c.tipo })),
    };
  }

  /**
   * Guarda uma variável da conferência: valor fixo (`valor`) OU o token de uma conta Git conectada (`contaId`).
   * O valor/token vai só para o cofre 600 (ou é lido da conta na hora), nunca para a IA. valor:null e sem contaId apaga.
   */
  async gravarVariavelDaConferencia(id: string, body: any) {
    await this.assertExists(id);
    const nome = reqString(body, 'nome', 100).trim();
    const contaId = body?.contaId ? String(body.contaId) : null;
    try {
      if (contaId) {
        if (!listGitAccounts().some((c) => c.id === contaId)) throw new Error('conta Git não encontrada');
        gravarReferenciaDaConferencia(id, nome, contaId);
        gravarVariavelDaConferencia(id, nome, null); // o nome não é as duas coisas ao mesmo tempo
      } else {
        const valor = body?.valor === null || body?.valor === undefined ? null : String(body.valor);
        if (valor !== null && (!valor || valor.length > 10000)) throw new BadRequestException('valor vazio ou grande demais');
        gravarVariavelDaConferencia(id, nome, valor && valor.trim() ? valor : null);
        gravarReferenciaDaConferencia(id, nome, null);
      }
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(e?.message ?? 'nome inválido');
    }
    return this.variaveisDaConferencia(id);
  }

  /** Pasta de mídia durável do projeto (vídeos enviados e editados), fora do git; criada se não existir. */
  private async midiaDir(id: string): Promise<string> {
    const p = await this.assertExists(id);
    const dir = this.workspace.projectDirs(p.dirKey).midia;
    fs.mkdirSync(path.join(dir, 'entrada'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'saida'), { recursive: true });
    return dir;
  }

  /** Vídeos do projeto: enviados (entrada) e editados (saida). */
  async videos(id: string) {
    return { videos: listarVideos(await this.midiaDir(id)) };
  }

  /** Guarda um vídeo enviado pelo app (streaming, arquivo grande). Fora do git e fora da sessão da IA. */
  async salvarVideo(id: string, nome: string, corpo: Readable) {
    return gravarVideoEnviado(await this.midiaDir(id), nome, corpo);
  }

  async apagarVideo(id: string, videoId: string) {
    if (!apagarVideoEnviado(await this.midiaDir(id), videoId)) throw new NotFoundException('Vídeo não encontrado');
    return this.videos(id);
  }

  /** Caminho em disco de um vídeo da mídia (midia/entrada|saida/<arquivo>), para transmitir no download. */
  async arquivoDeMidia(id: string, caminho: string): Promise<string> {
    const abs = arquivoDaMidia(await this.midiaDir(id), String(caminho ?? ''));
    if (!abs) throw new NotFoundException('Vídeo não encontrado na mídia do projeto');
    return abs;
  }

  async remove(id: string) {
    const p = await this.assertExists(id);
    await this.stopEverything(id);
    await this.prisma.$transaction([this.prisma.approval.deleteMany({ where: { projectId: id } }), this.prisma.project.delete({ where: { id } })]);
    fs.rmSync(this.workspace.projectDirs(p.dirKey).root, { recursive: true, force: true });
    fs.rmSync(resolveInside(appConfig().artifactsRoot, id), { recursive: true, force: true });
    apagarVariaveisDaConferencia(id);
    return { excluido: p.name };
  }

  /** Interrompe trabalhos ativos e cancela respostas pendentes; espera (até 20 s) as sessões encerrarem. */
  private async stopEverything(projectId: string) {
    const ativos = await this.prisma.job.findMany({
      where: { projectId, status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO'] } },
      select: { id: true },
    });
    for (const j of ativos) {
      await this.prisma.$transaction(async (tx) => {
        await tx.job.update({ where: { id: j.id }, data: { status: 'BLOQUEADO', blockedReason: BlockedReason.INTERROMPIDO, statusDetail: 'interrompido para excluir o projeto' } });
        await this.queue.cancelForJob(tx, j.id);
      });
    }
    await ConversationsService.cancelPending(this.prisma, { projectId });
    // Sem lease, o worker aborta a sessão em poucos segundos; espera para não apagar a pasta com a IA dentro.
    const fim = Date.now() + 20_000;
    while (Date.now() < fim && (await this.prisma.attempt.count({ where: { job: { projectId }, status: 'EXECUTANDO' } }))) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.prisma.attempt.updateMany({ where: { job: { projectId }, status: 'EXECUTANDO' }, data: { status: 'INTERROMPIDA', endedAt: new Date(), error: 'projeto excluído' } });
  }

  async assertExists(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    return p;
  }
}
