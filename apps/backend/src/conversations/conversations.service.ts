import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { optString, reqString } from '../common/validate';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { caminhoDoProjeto, resolveMidiaOuTrabalho } from '../common/path-guard';
import { WorkspaceService } from '../storage/workspace.service';
import { arquivoDaMidia, AUDIO_EXT } from '../projects/midia';
import { Anexo, gravarAnexos, lerAnexo, MAX_ANEXO_BYTES, MAX_ANEXOS, prepararAnexos } from './attachments';

const TITULO_PADRAO = 'Nova conversa';
const MAX_TEXTO_MENSAGEM = 20_000;

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

  /** Mídia (vídeo/áudio) que a mensagem anexa: `[{ nome, caminho: "midia/entrada/<id>" }]`. Confere que cada arquivo
   * existe na mídia do projeto (sem copiar nada) e devolve os anexos prontos para guardar na mensagem. */
  private async prepararMidiaAnexada(projectId: string, raw: unknown): Promise<Anexo[]> {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('midia deve ser uma lista');
    if (raw.length > MAX_ANEXOS) throw new BadRequestException(`No máximo ${MAX_ANEXOS} anexos por mensagem`);
    if (!raw.length) return [];
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { dirKey: true } });
    const midiaDir = this.workspace.projectDirs(p.dirKey).midia;
    return raw.map((r: any) => {
      const caminho = String(r?.caminho ?? '');
      const abs = arquivoDaMidia(midiaDir, caminho);
      if (!abs) throw new BadRequestException(`Mídia anexada não encontrada: ${caminho}`);
      const nome = path.basename(String(r?.nome ?? caminho)).replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 150) || path.basename(caminho);
      return { nome, tipo: AUDIO_EXT.test(caminho) ? 'audio' : 'video', bytes: fs.statSync(abs).size, caminho } as Anexo;
    });
  }

  private async conversation(projectId: string, conversationId: string) {
    const c = await this.prisma.conversation.findFirst({ where: { id: conversationId, projectId } });
    if (!c) throw new NotFoundException('Conversa não encontrada neste projeto');
    return c;
  }

  /** Conversas ativas do projeto, mais recentes primeiro (as arquivadas ficam em GET /arquivados). */
  list(projectId: string) {
    return this.prisma.conversation.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  async create(projectId: string, body: any) {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Projeto não encontrado');
    // "+" do menu: se já há uma conversa nova ainda vazia, abre ela (sem acumular várias "Nova conversa" em branco).
    if (body?.reaproveitarVazia === true) {
      const vazia = await this.prisma.conversation.findFirst({ where: { projectId, archivedAt: null, title: TITULO_PADRAO, messages: { none: {} } }, orderBy: { updatedAt: 'desc' } });
      if (vazia) return this.prisma.conversation.update({ where: { id: vazia.id }, data: { updatedAt: new Date() } });
    }
    return this.prisma.conversation.create({ data: { projectId, title: optString(body, 'title', 200) ?? TITULO_PADRAO } });
  }

  /** Tudo o que está arquivado, num lugar só (botão "Arquivados" no rodapé do menu): projetos e conversas. */
  async arquivados() {
    const [projetos, conversas] = await Promise.all([
      this.prisma.project.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: 'desc' }, select: { id: true, name: true, archivedAt: true, area: { select: { name: true } } } }),
      this.prisma.conversation.findMany({
        where: { archivedAt: { not: null } },
        orderBy: { archivedAt: 'desc' },
        take: 500,
        select: { id: true, title: true, archivedAt: true, project: { select: { id: true, name: true, archivedAt: true } } },
      }),
    ]);
    return { projetos, conversas };
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
   * Move o histórico de uma conversa entre projetos, sem mover a memória ou trabalhos
   * já executados do projeto original. Anexos locais são copiados antes do commit.
   */
  async move(projectId: string, conversationId: string, targetProjectId: string) {
    if (!targetProjectId || targetProjectId === projectId) throw new BadRequestException('Escolha outro projeto de destino');
    const [origin, target] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { dirKey: true } }),
      this.prisma.project.findUnique({ where: { id: targetProjectId, archivedAt: null }, select: { dirKey: true } }),
    ]);
    if (!origin) throw new NotFoundException('Projeto de origem não encontrado');
    if (!target) throw new NotFoundException('Projeto de destino não encontrado ou arquivado');
    const previous = path.join(this.workspace.projectDirs(origin.dirKey).root, 'anexos', conversationId);
    const next = path.join(this.workspace.projectDirs(target.dirKey).root, 'anexos', conversationId);
    if (fs.existsSync(next)) throw new ConflictException('Já existe uma pasta de anexos desta conversa no destino');
    const conversation = await this.conversation(projectId, conversationId);
    if (conversation.archivedAt) throw new ConflictException('Desarquive a conversa antes de movê-la');
    const messages = await this.prisma.conversationMessage.findMany({
      where: { conversationId }, select: { id: true, status: true, jobId: true, attachments: true },
    });
    if (messages.some(m => m.status === 'PENDENTE')) throw new ConflictException('Aguarde a conclusão da resposta antes de mover a conversa');
    if (messages.some(m => m.jobId)) throw new ConflictException('Esta conversa possui trabalhos aprovados vinculados ao projeto original e ainda não pode ser movida com segurança');
    // Mídias do projeto são referências externas à pasta de anexos. Só mover
    // automaticamente quando os arquivos puderem ser preservados no destino.
    const media = new Set<string>();
    for (const message of messages) {
      for (const a of (Array.isArray(message.attachments) ? message.attachments : []) as Anexo[]) {
        if (a.caminho) media.add(a.caminho);
      }
    }
    const sourceMedia = this.workspace.projectDirs(origin.dirKey).midia;
    const targetMedia = this.workspace.projectDirs(target.dirKey).midia;
    const copies: Array<{ from: string; to: string }> = [];
    for (const relative of media) {
      const from = arquivoDaMidia(sourceMedia, relative);
      if (!from) throw new ConflictException('Mídia da conversa não encontrada no projeto original: ' + relative);
      const to = path.resolve(targetMedia, relative);
      if (!to.startsWith(path.resolve(targetMedia) + path.sep)) throw new BadRequestException('Caminho de mídia inválido');
      if (fs.existsSync(to)) throw new ConflictException('Já existe uma mídia com o mesmo caminho no destino: ' + relative);
      copies.push({ from, to });
    }
    const copiedMedia: string[] = [];
    let copiedAttachments = false;
    try {
      if (fs.existsSync(previous)) {
        fs.mkdirSync(path.dirname(next), { recursive: true });
        fs.cpSync(previous, next, { recursive: true, errorOnExist: true, force: false });
        copiedAttachments = true;
      }
      for (const file of copies) {
        fs.mkdirSync(path.dirname(file.to), { recursive: true });
        fs.copyFileSync(file.from, file.to, fs.constants.COPYFILE_EXCL);
        copiedMedia.push(file.to);
      }
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
        const current = await tx.conversation.findFirst({ where: { id: conversationId, projectId } });
        if (!current) throw new ConflictException('Esta conversa já foi movida ou excluída');
        const pending = await tx.conversationMessage.count({ where: { conversationId, status: 'PENDENTE' } });
        if (pending) throw new ConflictException('A IA começou uma resposta; tente novamente depois');
        const linked = await tx.conversationMessage.count({ where: { conversationId, jobId: { not: null } } });
        if (linked) throw new ConflictException('A conversa tem trabalhos vinculados ao projeto original');
        await tx.conversation.update({ where: { id: conversationId }, data: { projectId: targetProjectId } });
      });
    } catch (e) {
      if (copiedAttachments) fs.rmSync(next, { recursive: true, force: true });
      for (const mediaPath of copiedMedia) fs.rmSync(mediaPath, { force: true });
      throw e;
    }
    // Só remove os anexos de origem depois da transação: mover não apaga mensagens.
    if (copiedAttachments) {
      try { fs.rmSync(previous, { recursive: true, force: true }); } catch { /* cópia de origem pode permanecer */ }
    }
    return { id: conversationId, projectId: targetProjectId };
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
    // Mensagem comprida vira um anexo de texto automaticamente. Assim o banco mantém um resumo curto, mas a IA
    // recebe o pedido integral em contexto/anexos/, inclusive quando o envio não veio pela interface web.
    const textoOriginal = typeof body?.content === 'string' ? body.content : null;
    let conteudoRecebido: unknown = body?.content;
    if (textoOriginal && textoOriginal.length > MAX_TEXTO_MENSAGEM) {
      if (anexos.length >= MAX_ANEXOS) throw new BadRequestException(`O texto passa de ${MAX_TEXTO_MENSAGEM} caracteres e precisa virar anexo, mas a mensagem já tem ${MAX_ANEXOS} anexos`);
      const bytes = Buffer.from(textoOriginal, 'utf8');
      if (bytes.length > MAX_ANEXO_BYTES) throw new BadRequestException('O texto passa de 10 MB e é grande demais para ser anexado à mensagem');
      const usados = new Set(anexos.map((a) => a.nome.toLowerCase()));
      let nome = 'mensagem-completa.txt';
      let n = 2;
      while (usados.has(nome.toLowerCase())) nome = `mensagem-completa-${n++}.txt`;
      anexos.push({ nome, tipo: 'texto', bytes: bytes.length, conteudo: bytes });
      conteudoRecebido = `O texto completo desta mensagem está no anexo "${nome}". Leia o arquivo integralmente antes de responder.`;
    }
    // Mídia anexada à mensagem (vídeo/áudio já enviados para midia/entrada): vão com a mensagem, aparecem no balão
    // e a IA os referencia pelo caminho — sem recópia (o arquivo já está na mídia do projeto).
    const midia = await this.prepararMidiaAnexada(projectId, body?.midia);
    const temAnexo = anexos.length > 0 || midia.length > 0;
    const corpo = { content: conteudoRecebido };
    const content = temAnexo ? (optString(corpo, 'content', MAX_TEXTO_MENSAGEM) ?? '').trim() : reqString(corpo, 'content', MAX_TEXTO_MENSAGEM);
    const raiz = anexos.length ? await this.raizDoProjeto(projectId) : '';
    await this.prisma.$transaction(async (tx) => {
      // Trava a conversa: duas mensagens enviadas juntas (Enter duas vezes) não passam as duas.
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const pendente = await tx.conversationMessage.findFirst({ where: { conversationId, status: 'PENDENTE' } });
      if (pendente) throw new ConflictException('A IA ainda está respondendo a mensagem anterior');
      const minha = await tx.conversationMessage.create({ data: { conversationId, role: 'USUARIO', content } });
      if (temAnexo) {
        const gravados = anexos.length ? gravarAnexos(raiz, conversationId, minha.id, anexos) : [];
        const todos = [...gravados, ...midia];
        await tx.conversationMessage.update({ where: { id: minha.id }, data: { attachments: todos as unknown as Prisma.InputJsonValue } });
      }
      const resposta = await tx.conversationMessage.create({ data: { conversationId, role: 'ASSISTENTE', content: '', status: 'PENDENTE' } });
      await tx.queueTask.create({ data: { type: 'PLAN_MESSAGE', messageId: resposta.id } });
      // Conversa nova ganha como título o começo da primeira mensagem (como no ChatGPT).
      const primeira = (await tx.conversationMessage.count({ where: { conversationId, role: 'USUARIO' } })) === 1;
      const inicio = textoOriginal?.trim() || content || [...anexos, ...midia].map((a) => a.de ?? a.nome).join(', ');
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
    const dirs = this.workspace.projectDirs(projeto.dirKey);
    const raiz = dirs.root;
    const worktree = await this.workspace.ensureJobWorktree(projeto.dirKey, jobId);
    const noGit: string[] = [];
    for (const p of pedidos as Array<{ anexo: string; para: string }>) {
      const [mensagem, nome] = String(p.anexo ?? '').replace(/^contexto\/anexos\//, '').split('/');
      const msg = mensagem ? await this.prisma.conversationMessage.findFirst({ where: { id: mensagem, conversationId } }) : null;
      const conteudo = msg && nome ? lerAnexo(raiz, conversationId, msg.id, nome) : null;
      const para = caminhoDoProjeto(p.para);
      if (!conteudo || !para) continue; // caminho vazio, fora do projeto ou protegido: não copia
      // "midia/..." vai para a MÍDIA durável (fora do git); o resto, para a pasta de trabalho (worktree).
      const destino = resolveMidiaOuTrabalho(dirs.midia, worktree, para);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, conteudo);
      if (destino.startsWith(worktree)) noGit.push(path.relative(worktree, destino));
    }
    if (noGit.length) await this.workspace.commitCheckpoint(worktree, `anexos da conversa colocados no projeto: ${noGit.join(', ')}`);
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
