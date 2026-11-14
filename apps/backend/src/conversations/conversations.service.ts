import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { optString, reqString } from '../common/validate';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

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
  ) {}

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
   * Recusado enquanto a IA ainda está respondendo nela.
   */
  async remove(projectId: string, conversationId: string) {
    await this.conversation(projectId, conversationId);
    if (await this.prisma.conversationMessage.count({ where: { conversationId, status: 'PENDENTE' } })) {
      throw new ConflictException('A IA ainda está respondendo nesta conversa; aguarde e tente de novo');
    }
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { excluida: conversationId };
  }

  /** Grava a mensagem e enfileira a resposta da IA (processada pelo worker, mesmo com o navegador fechado). */
  async send(projectId: string, conversationId: string, body: any) {
    const conversa = await this.conversation(projectId, conversationId);
    if (conversa.archivedAt) throw new ConflictException('Conversa arquivada: desarquive para continuar');
    const content = reqString(body, 'content', 20000);
    const pendente = await this.prisma.conversationMessage.findFirst({ where: { conversationId, status: 'PENDENTE' } });
    if (pendente) throw new ConflictException('A IA ainda está respondendo a mensagem anterior');
    await this.prisma.$transaction(async (tx) => {
      await tx.conversationMessage.create({ data: { conversationId, role: 'USUARIO', content } });
      const resposta = await tx.conversationMessage.create({ data: { conversationId, role: 'ASSISTENTE', content: '', status: 'PENDENTE' } });
      await tx.queueTask.create({ data: { type: 'PLAN_MESSAGE', messageId: resposta.id } });
      // Conversa nova ganha como título o começo da primeira mensagem (como no ChatGPT).
      const primeira = (await tx.conversationMessage.count({ where: { conversationId, role: 'USUARIO' } })) === 1;
      const titulo = primeira && conversa.title === TITULO_PADRAO ? content.replace(/\s+/g, ' ').trim().slice(0, 60) : undefined;
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(), ...(titulo ? { title: titulo } : {}) } });
    });
    return this.get(projectId, conversationId);
  }

  /** Aprova o plano proposto: cria o job (validado) e, por padrão, inicia. */
  async approve(projectId: string, conversationId: string, messageId: string, body: any) {
    await this.conversation(projectId, conversationId);
    const decidedBy = reqString(body, 'decidedBy', 100);
    const msg = await this.prisma.conversationMessage.findFirst({ where: { id: messageId, conversationId } });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');
    if (msg.kind !== 'plano' || msg.status !== 'PRONTA' || !msg.plan) throw new BadRequestException('Esta mensagem não contém um plano para aprovar');
    if (msg.jobId) throw new ConflictException('Este plano já foi aprovado');
    const plan = this.jobs.validatePlan(msg.plan);
    const job = await this.jobs.create(projectId, { ...plan, author: decidedBy });
    await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { jobId: job.id, approvedBy: decidedBy, approvedAt: new Date() } });
    if (body?.start !== false) await this.jobs.start(projectId, job.id);
    await this.prisma.conversationMessage.create({
      data: { conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: `Plano aprovado por ${decidedBy}. Job "${plan.title}" criado${body?.start !== false ? ' e iniciado' : ''}.`, jobId: job.id },
    });
    return this.get(projectId, conversationId);
  }
}

export type PlanJson = Prisma.InputJsonValue;
