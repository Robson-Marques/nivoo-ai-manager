import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import { appConfig } from '../config';
import { resolveInside } from '../common/path-guard';
import { DEFAULT_AREA, findTemplate } from '../areas/area-templates';
import { AreasService } from '../areas/areas.service';
import { sha256 } from '../common/hash';
import { knowledgePath, parseKnowledgeUpload, withTextCopies } from '../common/knowledge-upload';
import { optNumber, optString, reqString, slugify } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { checkModelName } from '../providers/model-catalog.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { WorkspaceService } from '../storage/workspace.service';
import { BlockedReason } from '../common/status';
import { ConversationsService } from '../conversations/conversations.service';
import { QueueService } from '../queue/queue.service';

/** IAs que conversam e trabalham num projeto: agentes que leem e editam arquivos (o executor local não é IA). */
export const AI_PROVIDERS = ['claude-code-cli', 'claude-api', 'codex-cli', 'codex-api', 'gemini-cli', 'gemini-api'];

/**
 * Projeto = pasta de trabalho + "fine-tune do projeto": base escolhida, regras próprias (versionadas),
 * conhecimento enviado pelo usuário, memória automática da conversa e a IA que trabalha nele.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly areas: AreasService,
    private readonly registry: ProviderRegistry,
    private readonly queue: QueueService,
  ) {}

  async create(body: any) {
    const name = reqString(body, 'name', 200);
    const slug = slugify(optString(body, 'slug', 60) ?? name);
    if (!slug) throw new BadRequestException('Nome inválido');
    if (await this.prisma.project.findUnique({ where: { slug } })) throw new ConflictException(`Já existe um projeto com o nome "${name}"`);
    const area = await this.resolveArea(optString(body, 'base', 60) ?? DEFAULT_AREA);
    const provider = this.checkProvider(optString(body, 'provider', 60) ?? 'claude-code-cli');
    const dirKey = `areas/${area.slug}/projetos/${slug}`;
    const dirs = await this.workspace.ensureProject(dirKey);
    await this.workspace.ensureKnowledge(dirs.knowledge);
    const description = optString(body, 'description', 20000) ?? '';
    const author = optString(body, 'author', 100) ?? 'usuario';
    const project = await this.prisma.project.create({ data: { name, slug, description, areaId: area.id, dirKey, workspacePath: dirs.root, provider } });
    if (description) {
      await this.prisma.memoryEntry.create({ data: { projectId: project.id, category: 'ESPECIFICACAO', title: 'Sobre o projeto', content: description, author } });
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
    if (!AI_PROVIDERS.includes(id) || !this.registry.has(id)) throw new BadRequestException(`IA desconhecida: ${id}. Opções: ${AI_PROVIDERS.join(', ')}`);
    return id;
  }

  /** Projetos ativos (arquivados só com `arquivados=1`). */
  list(archived = false) {
    return this.prisma.project.findMany({
      where: { archivedAt: archived ? { not: null } : null },
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
      const ia = (data.provider as string | undefined) ?? atual.provider;
      const modelos = { ...((atual.aiModels ?? {}) as Record<string, string>) };
      if (body.model === null || body.model === '') delete modelos[ia];
      else modelos[ia] = checkModelName(body.model);
      data.aiModels = modelos;
    }
    if (typeof body?.archived === 'boolean') data.archivedAt = body.archived ? new Date() : null;
    if (body && 'maxCostUsd' in body) data.maxCostUsd = body.maxCostUsd === null ? null : optNumber(body, 'maxCostUsd', 0, 1_000_000);
    await this.prisma.project.update({ where: { id }, data });
    if (data.provider) await this.moveUnfinishedWork(id, String(data.provider));
    return this.get(id);
  }

  /**
   * Trocou a IA do projeto (ex.: acabou o crédito de uma): o trabalho ainda não terminado passa para a
   * nova IA e, se estava esperando a IA anterior voltar, continua já. Cada sessão reconstrói o contexto
   * do projeto (regras, conhecimento, memória, pasta, notas e checkpoints), então nada depende da IA anterior.
   */
  private async moveUnfinishedWork(projectId: string, provider: string) {
    const ai = AI_PROVIDERS;
    const jobs = await this.prisma.job.findMany({
      where: { projectId, status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO', 'BLOQUEADO', 'FALHOU'] } },
      select: { id: true, defaultProvider: true },
    });
    for (const j of jobs) {
      await this.prisma.$transaction([
        // Etapas da IA (explícitas, ou sem conector próprio num job cuja IA padrão era a do projeto);
        // etapas do executor local continuam no executor local.
        this.prisma.step.updateMany({
          where: { jobId: j.id, status: { not: 'CONCLUIDO' }, OR: [{ provider: { in: ai } }, ...(ai.includes(j.defaultProvider) ? [{ provider: null }] : [])] },
          data: { provider },
        }),
        ...(ai.includes(j.defaultProvider) ? [this.prisma.job.update({ where: { id: j.id }, data: { defaultProvider: provider } })] : []),
        // Quem esperava a IA anterior (limite/crédito) tenta de novo agora, com a nova.
        this.prisma.queueTask.updateMany({ where: { jobId: j.id, type: 'RUN_STEP', status: 'QUEUED' }, data: { runAt: new Date(), resourceWaits: 0 } }),
      ]);
    }
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
    const files = await withTextCopies(parsed.files);
    const ignorados = parsed.ignorados;
    const commit = await this.workspace.writeKnowledge(
      this.workspace.projectDirs(p.dirKey).knowledge,
      files,
      optString(body, 'author', 100) ?? 'usuario',
      optString(body, 'message', 200) ?? `envia ${files.length} arquivo(s)`,
    );
    return { importados: files.length, bytes: files.reduce((n, f) => n + f.content.length, 0), ignorados, commit };
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
  async remove(id: string) {
    const p = await this.assertExists(id);
    await this.stopEverything(id);
    await this.prisma.$transaction([this.prisma.approval.deleteMany({ where: { projectId: id } }), this.prisma.project.delete({ where: { id } })]);
    fs.rmSync(this.workspace.projectDirs(p.dirKey).root, { recursive: true, force: true });
    fs.rmSync(resolveInside(appConfig().artifactsRoot, id), { recursive: true, force: true });
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
