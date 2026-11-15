import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { optString, reqString } from '../common/validate';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { caminhoDoProjeto, resolveInside } from '../common/path-guard';
import { WorkspaceService } from '../storage/workspace.service';
import { Anexo, gravarAnexos, lerAnexo, prepararAnexos } from './attachments';

const TITULO_PADRAO = 'Nova conversa';

/**
 * Conversa do projeto (o projeto pode ter várias; cada uma começa limpa, mas todas compartilham a
 * memória, as regras, o conhecimento e os arquivos do projeto): você escreve; a IA (no worker) lê o projeto e responde ou propõe um plano.
 * Um plano só vira job com aprovação explícita, e passa pelas mesmas validações de um job manual.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly jobs: JobsService,
    private readonly workspace: WorkspaceService,
  ) {}

  private async raizDoProjeto(projectId: string): Promise<string> {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { dirKey: true } });
    return this.workspace.projectDirs(p.dirKey).root;
  }

  private async conversation(projectId: string, conversationId: string) {
    const c = await this.prisma.conversation.findFirst({ where: { id: conversationId, projectId } });
    if (!c) throw new NotFoundException('Conversa não encontrada neste projeto');
    return c;
  }

  /** Conversas do projeto, mais recentes primeiro (arquivadas só com `arquivadas=1`). */
  list(projectId: string, archived = false) {
    return this.prisma.conversation.findMany({
      where: { projectId, archivedAt: archived ? { not: null } : null },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  async create(projectId: string, body: any) {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Projeto não encontrado');
    return this.prisma.conversation.create({ data: { projectId, title: optString(body, 'title', 200) ?? TITULO_PADRAO } });
  }

  async get(projectId: string, conversationId: string) {
    await this.conversation(projectId, conversationId);
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /** Renomear e arquivar/desarquivar. */
  async update(projectId: string, conversationId: string, body: any) {
    await this.conversation(projectId, conversationId);
    const data: Prisma.ConversationUpdateInput = {};
    const title = optString(body, 'title', 200);
    if (title) data.title = title;
    if (typeof body?.archived === 'boolean') data.archivedAt = body.archived ? new Date() : null;
    return this.prisma.conversation.update({ where: { id: conversationId }, data });
  }

  /**
   * Exclui a conversa (mensagens). O que ela gerou para o projeto continua: memória, arquivos e trabalhos.
   * Uma resposta em andamento é parada antes.
   */
  async remove(projectId: string, conversationId: string) {
    await this.conversation(projectId, conversationId);
    await ConversationsService.cancelPending(this.prisma, { conversationId }); // para a resposta em andamento
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    fs.rmSync(path.join(await this.raizDoProjeto(projectId), 'anexos', conversationId), { recursive: true, force: true });
    return { excluida: conversationId };
  }

  /**
   * Para a resposta em andamento ("Pensando…"): a mensagem vira "cancelada" e a tarefa sai da fila; se a
   * IA já estava rodando, o worker perde o lease e encerra a sessão.
   */
  async cancel(projectId: string, conversationId: string) {
    await this.conversation(projectId, conversationId);
    await ConversationsService.cancelPending(this.prisma, { conversationId });
    return this.get(projectId, conversationId);
  }

  static async cancelPending(prisma: PrismaService, where: { conversationId?: string; projectId?: string }): Promise<number> {
    const msgs = await prisma.conversationMessage.findMany({
      where: { status: 'PENDENTE', ...(where.conversationId ? { conversationId: where.conversationId } : { conversation: { projectId: where.projectId } }) },
      select: { id: true },
    });
    if (!msgs.length) return 0;
    const ids = msgs.map((m) => m.id);
    await prisma.$transaction([
      prisma.queueTask.updateMany({ where: { messageId: { in: ids }, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', lockedUntil: null } }),
      prisma.conversationMessage.updateMany({ where: { id: { in: ids }, status: 'PENDENTE' }, data: { status: 'ERRO', kind: 'erro', content: 'Resposta cancelada.' } }),
    ]);
    return ids.length;
  }

  /** Grava a mensagem e enfileira a resposta da IA (processada pelo worker, mesmo com o navegador fechado). */
  async send(projectId: string, conversationId: string, body: any) {
    const conversa = await this.conversation(projectId, conversationId);
    if (conversa.archivedAt) throw new ConflictException('Conversa arquivada: desarquive para continuar');
    // Anexos (imagens, documentos, texto) podem ir sozinhos, sem texto.
    const anexos = await prepararAnexos(body?.anexos);
    const content = anexos.length ? (optString(body, 'content', 20000) ?? '').trim() : reqString(body, 'content', 20000);
    const raiz = anexos.length ? await this.raizDoProjeto(projectId) : '';
    await this.prisma.$transaction(async (tx) => {
      // Trava a conversa: duas mensagens enviadas juntas (Enter duas vezes) não passam as duas.
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const pendente = await tx.conversationMessage.findFirst({ where: { conversationId, status: 'PENDENTE' } });
      if (pendente) throw new ConflictException('A IA ainda está respondendo a mensagem anterior');
      const minha = await tx.conversationMessage.create({ data: { conversationId, role: 'USUARIO', content } });
      if (anexos.length) {
        const gravados = gravarAnexos(raiz, conversationId, minha.id, anexos);
        await tx.conversationMessage.update({ where: { id: minha.id }, data: { attachments: gravados as unknown as Prisma.InputJsonValue } });
      }
      const resposta = await tx.conversationMessage.create({ data: { conversationId, role: 'ASSISTENTE', content: '', status: 'PENDENTE' } });
      await tx.queueTask.create({ data: { type: 'PLAN_MESSAGE', messageId: resposta.id } });
      // Conversa nova ganha como título o começo da primeira mensagem (como no ChatGPT).
      const primeira = (await tx.conversationMessage.count({ where: { conversationId, role: 'USUARIO' } })) === 1;
      const inicio = content || anexos.map((a) => a.de ?? a.nome).join(', ');
      const titulo = primeira && conversa.title === TITULO_PADRAO ? inicio.replace(/\s+/g, ' ').trim().slice(0, 60) : undefined;
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(), ...(titulo ? { title: titulo } : {}) } });
    });
    return this.get(projectId, conversationId);
  }

  /**
   * Anexos que o plano pede para colocar no projeto (ex.: o logo enviado no chat em public/logo.png): copiados
   * para a pasta do trabalho antes de ele começar, num commit; entram na pasta principal junto com o trabalho
   * (depois da conferência). A IA não consegue gravar imagem sozinha, por isso o sistema copia.
   */
  private async copiarAnexosParaOProjeto(projectId: string, conversationId: string, jobId: string, pedidos: unknown) {
    if (!Array.isArray(pedidos) || !pedidos.length) return;
    const projeto = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { dirKey: true } });
    const raiz = this.workspace.projectDirs(projeto.dirKey).root;
    const worktree = await this.workspace.ensureJobWorktree(projeto.dirKey, jobId);
    const copiados: string[] = [];
    for (const p of pedidos as Array<{ anexo: string; para: string }>) {
      const [mensagem, nome] = String(p.anexo ?? '').replace(/^contexto\/anexos\//, '').split('/');
      const msg = mensagem ? await this.prisma.conversationMessage.findFirst({ where: { id: mensagem, conversationId } }) : null;
      const conteudo = msg && nome ? lerAnexo(raiz, conversationId, msg.id, nome) : null;
      const para = caminhoDoProjeto(p.para);
      if (!conteudo || !para) continue; // caminho vazio, fora do projeto ou protegido: não copia
      const destino = resolveInside(worktree, para);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, conteudo);
      copiados.push(path.relative(worktree, destino));
    }
    if (copiados.length) await this.workspace.commitCheckpoint(worktree, `anexos da conversa colocados no projeto: ${copiados.join(', ')}`);
  }

  /** Arquivo anexado a uma mensagem (para mostrar no chat). */
  async attachment(projectId: string, conversationId: string, messageId: string, nome: string): Promise<{ nome: string; conteudo: Buffer }> {
    await this.conversation(projectId, conversationId);
    const msg = await this.prisma.conversationMessage.findFirst({ where: { id: messageId, conversationId } });
    const anexo = ((msg?.attachments ?? []) as unknown as Anexo[]).find((a) => a.nome === nome);
    const conteudo = anexo ? lerAnexo(await this.raizDoProjeto(projectId), conversationId, messageId, nome) : null;
    if (!conteudo) throw new NotFoundException('Anexo não encontrado');
    return { nome, conteudo };
  }

  /** Aprova o plano proposto: cria o job (validado) e, por padrão, inicia. */
  async approve(projectId: string, conversationId: string, messageId: string, body: any) {
    await this.conversation(projectId, conversationId);
    const decidedBy = reqString(body, 'decidedBy', 100);
    const msg = await this.prisma.conversationMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');
    if (msg.kind !== 'plano' || msg.status !== 'PRONTA' || !msg.plan) throw new BadRequestException('Esta mensagem não contém um plano para aprovar');
    if (msg.jobId || msg.approvedAt) throw new ConflictException('Este plano já foi aprovado');
    const plan = this.jobs.validatePlan(msg.plan);
    // Reserva o plano antes de criar o job: dois cliques em "Fazer" nunca criam dois trabalhos.
    const reserva = await this.prisma.conversationMessage.updateMany({ where: { id: msg.id, jobId: null, approvedAt: null }, data: { approvedAt: new Date(), approvedBy: decidedBy } });
    if (!reserva.count) throw new ConflictException('Este plano já foi aprovado');
    let job: Awaited<ReturnType<JobsService['create']>>;
    try {
      // O plano aprovado na conversa trabalha até terminar (limites do plano da IA não se aplicam).
      job = await this.jobs.create(projectId, { ...plan, limits: undefined, semLimites: true, author: decidedBy });
    } catch (e) {
      await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { approvedAt: null, approvedBy: null } });
      throw e;
    }
    await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { jobId: job.id } });
    await this.copiarAnexosParaOProjeto(projectId, conversationId, job.id, (msg.plan as any)?.anexosNoProjeto);
    if (body?.start !== false) await this.jobs.start(projectId, job.id);
    await this.prisma.conversationMessage.create({
      data: { conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: `Plano aprovado por ${decidedBy}. Job "${plan.title}" criado${body?.start !== false ? ' e iniciado' : ''}.`, jobId: job.id },
    });
    return this.get(projectId, conversationId);
  }
}

export type PlanJson = Prisma.InputJsonValue;
