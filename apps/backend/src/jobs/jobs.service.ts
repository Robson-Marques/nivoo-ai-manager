import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CriterionKind, Prisma } from '@prisma/client';
import { sha256 } from '../common/hash';
import { appConfig } from '../config';
import { BlockedReason } from '../common/status';
import { oneOf, optNumber, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { QueueService } from '../queue/queue.service';
import { evaluatePolicy } from '../security/policy';
import { LogService } from './log.service';
import { RULE_REVIEW_CRITERION, RULE_REVIEW_STEP, ruleReviewStep } from './rule-review';
import { OrchestratorService } from './orchestrator.service';

const CRITERION_KINDS = ['COMMAND', 'FILE_EXISTS', 'ARTIFACT_PRESENT', 'METRIC_THRESHOLD', 'MANUAL_APPROVAL'] as const;

export interface StepInput {
  key: string;
  title: string;
  instructions: string;
  provider?: string;
  dependsOn: string[];
  verifyCommand?: string;
  requiresApproval: boolean;
  providerOptions: Prisma.InputJsonValue;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly queue: QueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly logs: LogService,
  ) {}

  private parseSteps(raw: unknown, defaultProvider: string, existingKeys: string[] = []): StepInput[] {
    if (!Array.isArray(raw)) throw new BadRequestException('steps deve ser uma lista');
    const steps: StepInput[] = raw.map((s: any) => {
      const key = reqString(s, 'key', 60);
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(key)) throw new BadRequestException(`Chave de etapa inválida: ${key}`);
      if (key === RULE_REVIEW_STEP) throw new BadRequestException(`A etapa ${RULE_REVIEW_STEP} é criada pelo sistema`);
      const instructions = reqString(s, 'instructions', 100000);
      const verifyCommand = optString(s, 'verifyCommand', 5000);
      const provider = optString(s, 'provider', 60);
      if (provider && !this.registry.has(provider)) throw new BadRequestException(`Conector desconhecido: ${provider}`);
      // Etapas executadas por IA precisam de verificação determinística: o agente não encerra a etapa sozinho.
      if (this.registry.get(provider ?? defaultProvider).kind !== 'executor' && !verifyCommand) {
        throw new BadRequestException(`Etapa ${key} usa conector de IA e exige verifyCommand (verificação determinística)`);
      }
      const opts = s.providerOptions ?? {};
      const providerOptions: Record<string, unknown> = {};
      if (opts.model !== undefined) providerOptions.model = String(opts.model).slice(0, 100);
      if (opts.maxTurns !== undefined) {
        const n = Number(opts.maxTurns);
        if (!Number.isInteger(n) || n < 1 || n > 500) throw new BadRequestException(`Etapa ${key}: maxTurns deve ser inteiro entre 1 e 500`);
        providerOptions.maxTurns = n;
      }
      // Etapa de vídeo (Veo): a descrição do vídeo é a instrução; o sistema confere que o arquivo saiu.
      let verificacao = verifyCommand;
      if ((provider ?? defaultProvider) === 'gemini-video') {
        Object.assign(providerOptions, opcoesDeVideo(key, opts));
        verificacao = verifyCommand ?? `test -s '${providerOptions.arquivo}'`;
      }
      const pol = evaluatePolicy(`${instructions}\n${verificacao ?? ''}`);
      return {
        key,
        title: optString(s, 'title', 300) ?? key,
        instructions,
        provider,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
        verifyCommand: verificacao,
        requiresApproval: s.requiresApproval === true || pol.requiresApproval,
        providerOptions: providerOptions as Prisma.InputJsonValue,
      };
    });
    const keys = new Set(existingKeys);
    for (const s of steps) {
      if (keys.has(s.key)) throw new BadRequestException(`Etapa duplicada: ${s.key}`);
      keys.add(s.key);
    }
    for (const s of steps) {
      for (const d of s.dependsOn) if (!keys.has(d)) throw new BadRequestException(`Etapa ${s.key} depende de etapa inexistente: ${d}`);
    }
    return steps;
  }

  private assertAcyclic(all: Array<{ key: string; dependsOn: string[] }>): void {
    const map = new Map(all.map((s) => [s.key, s.dependsOn]));
    const state = new Map<string, number>();
    const visit = (k: string) => {
      if (state.get(k) === 2) return;
      if (state.get(k) === 1) throw new BadRequestException(`Dependência cíclica envolvendo ${k}`);
      state.set(k, 1);
      for (const d of map.get(k) ?? []) visit(d);
      state.set(k, 2);
    };
    for (const k of map.keys()) visit(k);
  }

  private parseCriteria(raw: unknown, existingKeys: string[] = []) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('criteria deve ser uma lista');
    const keys = new Set(existingKeys);
    return raw.map((c: any) => {
      const key = reqString(c, 'key', 60);
      if (keys.has(key)) throw new BadRequestException(`Critério duplicado: ${key}`);
      keys.add(key);
      const kind = oneOf(c, 'kind', CRITERION_KINDS) as CriterionKind;
      const config = (c.config ?? {}) as Record<string, unknown>;
      if (kind === 'COMMAND') {
        reqString(config, 'command');
        const pol = evaluatePolicy(String(config.command));
        if (!pol.allowed) throw new BadRequestException(`Comando do critério ${key} não permitido: ${pol.reasons.join('; ')}`);
      }
      if (kind === 'FILE_EXISTS') reqString(config, 'path');
      if (kind === 'ARTIFACT_PRESENT' && !config.name && !config.pattern) throw new BadRequestException(`Critério ${key}: informe name ou pattern`);
      if (kind === 'METRIC_THRESHOLD') {
        reqString(config, 'path');
        if (!['>', '>=', '<', '<=', '==', '!='].includes(String(config.op ?? '>='))) throw new BadRequestException(`Critério ${key}: operador inválido`);
        if (!Number.isFinite(Number(config.value))) throw new BadRequestException(`Critério ${key}: value numérico obrigatório`);
      }
      return { key, description: reqString(c, 'description', 2000), kind, config: config as Prisma.InputJsonValue };
    });
  }

  /**
   * Valida um plano proposto pela IA da conversa SEM criar nada: mesmas regras de um job criado à mão
   * (etapas de IA com verificação, sem ciclos, política, critérios válidos). Devolve o plano normalizado.
   */
  validatePlan(plan: any) {
    if (!plan || typeof plan !== 'object') throw new BadRequestException('Plano vazio');
    const title = reqString(plan, 'title', 300);
    const objective = reqString(plan, 'objective', 50000);
    const defaultProvider = optString(plan, 'defaultProvider', 60) ?? 'claude-code-cli';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new BadRequestException('O plano precisa de pelo menos uma etapa');
    const steps = this.parseSteps(plan.steps, defaultProvider);
    this.assertAcyclic(steps);
    const criteria = this.parseCriteria(plan.criteria ?? []);
    if (criteria.length === 0) throw new BadRequestException('O plano precisa de critérios de aceitação verificáveis');
    const limits = plan.limits && typeof plan.limits === 'object' ? plan.limits : {};
    return { title, objective, defaultProvider, steps: plan.steps, criteria: plan.criteria, limits };
  }

  async create(projectId: string, body: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const title = reqString(body, 'title', 300);
    const objective = reqString(body, 'objective', 50000);
    const defaultProvider = optString(body, 'defaultProvider', 60) ?? 'local-shell';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    const steps = this.parseSteps(body.steps ?? [], defaultProvider);
    this.assertAcyclic(steps);
    const criteria = this.parseCriteria(body.criteria);
    // A trava: trabalho feito por IA termina com a conferência independente das regras do projeto.
    // (Só pode ser dispensada pela API, explicitamente — a conversa nunca dispensa.)
    const aiProviders = [...new Set(steps.map((s) => s.provider ?? defaultProvider))].filter((id) => this.registry.get(id).kind !== 'executor');
    if (aiProviders.length && body.conferencia !== false) {
      const reviewer = aiProviders.includes(project.provider) ? project.provider : aiProviders[0];
      steps.push({ ...ruleReviewStep(steps.map((s) => s.key), reviewer), requiresApproval: false, providerOptions: {} });
      if (!criteria.some((c) => c.key === RULE_REVIEW_CRITERION.key)) criteria.push(RULE_REVIEW_CRITERION);
    }
    // Trabalho vindo da conversa ("Fazer"): vai até o fim — sem limite de sessões nem de tempo. Para de
    // verdade só se ficar sem nenhum avanço (repetição) ou estourar o limite de gasto do PROJETO.
    const limits = body.semLimites === true ? { maxSessionsPerStep: 0, maxDurationSec: 0, maxCostUsd: 0, maxAttemptsPerStep: 10, ...(body.limits ?? {}) } : (body.limits ?? {});
    const job = await this.prisma.job.create({
      data: {
        projectId,
        title,
        defaultProvider,
        maxAttemptsPerStep: optNumber(limits, 'maxAttemptsPerStep', 1, 100),
        // 0 = sem limite (sessões e tempo).
        maxDurationSec: limits.maxDurationSec === 0 ? 0 : optNumber(limits, 'maxDurationSec', 10, 7 * 24 * 3600),
        maxCostUsd: optNumber(limits, 'maxCostUsd', 0, 10000),
        stepTimeoutSec: optNumber(limits, 'stepTimeoutSec', 1, 24 * 3600),
        repetitionWindow: optNumber(limits, 'repetitionWindow', 2, 20),
        maxSessionsPerStep: limits.maxSessionsPerStep === 0 ? 0 : optNumber(limits, 'maxSessionsPerStep', 1, 100),
        gitBranch: null,
        objectives: {
          create: { version: 1, text: objective, sha256: sha256(objective), author: optString(body, 'author', 100) ?? 'operador' },
        },
        steps: { create: steps.map((s, i) => ({ ...s, order: i })) },
        criteria: { create: criteria },
      },
    });
    await this.prisma.job.update({ where: { id: job.id }, data: { gitBranch: `job/${job.id}` } });
    await this.logs.log(job.id, `Job criado com ${steps.length} etapa(s) e ${criteria.length} critério(s). Objetivo v1 sha256=${sha256(objective).slice(0, 12)}`);
    if (criteria.length === 0) {
      await this.logs.log(job.id, 'ATENÇÃO: job sem critérios de aceitação — a conclusão será bloqueada até que critérios sejam adicionados.', { level: 'WARN' });
    }
    return this.get(projectId, job.id);
  }

  async list(projectId: string) {
    return this.prisma.job.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { steps: { select: { key: true, status: true } } },
    });
  }

  async listAll(status?: string) {
    return this.prisma.job.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { project: { select: { id: true, name: true, slug: true } }, steps: { select: { key: true, status: true } } },
    });
  }

  async get(projectId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: {
        objectives: { orderBy: { version: 'asc' } },
        criteria: { orderBy: [{ createdAt: 'asc' }, { key: 'asc' }], include: { checks: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        steps: { orderBy: { order: 'asc' } },
        attempts: { orderBy: { startedAt: 'asc' } },
        checkpoints: { orderBy: { seq: 'asc' } },
        artifacts: { orderBy: { createdAt: 'asc' } },
        approvals: { orderBy: { requestedAt: 'asc' } },
        project: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!job) throw new NotFoundException('Job não encontrado neste projeto');
    return job;
  }

  /** Busca por id global (usado em rotas /jobs/:id); retorna o projectId para checagens de isolamento. */
  async projectOf(jobId: string): Promise<string> {
    const j = await this.prisma.job.findUnique({ where: { id: jobId }, select: { projectId: true } });
    if (!j) throw new NotFoundException('Job não encontrado');
    return j.projectId;
  }

  async newObjectiveVersion(projectId: string, jobId: string, body: any) {
    const text = reqString(body, 'text', 50000);
    const reason = reqString(body, 'reason', 2000);
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído: objetivo não pode ser alterado');
    const version = job.objectiveVersion + 1;
    await this.prisma.$transaction([
      this.prisma.jobObjectiveVersion.create({
        data: { jobId, version, text, sha256: sha256(text), author: optString(body, 'author', 100) ?? 'operador', reason },
      }),
      this.prisma.job.update({ where: { id: jobId }, data: { objectiveVersion: version } }),
    ]);
    await this.logs.log(jobId, `Objetivo atualizado para v${version}: ${reason}`);
    return this.get(projectId, jobId);
  }

  async addSteps(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído');
    const steps = this.parseSteps(body.steps ?? [], job.defaultProvider, job.steps.map((s) => s.key));
    this.assertAcyclic([...job.steps, ...steps]);
    const base = job.steps.length;
    await this.prisma.step.createMany({ data: steps.map((s, i) => ({ ...s, jobId, order: base + i })) });
    // A conferência das regras continua sendo a última etapa e passa a cobrir as etapas novas.
    const review = job.steps.find((s) => s.key === RULE_REVIEW_STEP);
    if (review) {
      await this.prisma.step.update({
        where: { id: review.id },
        data: { dependsOn: [...review.dependsOn, ...steps.map((s) => s.key)], order: base + steps.length, status: 'PENDENTE', statusDetail: 'novas etapas: conferir de novo' },
      });
    }
    await this.logs.log(jobId, `Etapas adicionadas: ${steps.map((s) => s.key).join(', ')}`);
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  async addCriteria(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído');
    const criteria = this.parseCriteria(body.criteria ?? [], job.criteria.map((c) => c.key));
    await this.prisma.acceptanceCriterion.createMany({ data: criteria.map((c) => ({ ...c, jobId })) });
    await this.logs.log(jobId, `Critérios adicionados: ${criteria.map((c) => c.key).join(', ')}`);
    return this.get(projectId, jobId);
  }

  async updateLimits(projectId: string, jobId: string, body: any) {
    await this.get(projectId, jobId);
    const data = {
      maxAttemptsPerStep: optNumber(body, 'maxAttemptsPerStep', 1, 100),
      maxDurationSec: optNumber(body, 'maxDurationSec', 10, 7 * 24 * 3600),
      maxCostUsd: optNumber(body, 'maxCostUsd', 0, 10000),
      stepTimeoutSec: optNumber(body, 'stepTimeoutSec', 1, 24 * 3600),
      repetitionWindow: optNumber(body, 'repetitionWindow', 2, 20),
      maxSessionsPerStep: optNumber(body, 'maxSessionsPerStep', 1, 100),
    };
    await this.prisma.job.update({ where: { id: jobId }, data });
    await this.logs.log(jobId, `Limites atualizados: ${JSON.stringify(data)}`);
    return this.get(projectId, jobId);
  }

  async start(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'PENDENTE') throw new ConflictException(`Job em ${job.status}; use retomar`);
    await this.prisma.job.update({ where: { id: jobId }, data: { status: 'EXECUTANDO', startedAt: new Date(), statusDetail: null } });
    await this.logs.log(jobId, 'Job iniciado');
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  async interrupt(projectId: string, jobId: string, by = 'operador') {
    await this.get(projectId, jobId);
    const changed = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const r = await tx.job.updateMany({
        where: { id: jobId, status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO'] } },
        data: { status: 'BLOQUEADO', blockedReason: BlockedReason.INTERROMPIDO, statusDetail: `interrompido por ${by}` },
      });
      if (r.count) await this.queue.cancelForJob(tx, jobId);
      return r.count;
    });
    if (!changed) throw new ConflictException('Job não está em execução');
    await this.logs.log(jobId, `Job interrompido por ${by}. Estado preservado; use retomar para continuar.`, { level: 'WARN' });
    return this.get(projectId, jobId);
  }

  async resume(projectId: string, jobId: string, by = 'operador') {
    const job = await this.get(projectId, jobId);
    if (!['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(job.status)) {
      throw new ConflictException(`Job em ${job.status} não pode ser retomado`);
    }
    // Uma sessão ainda em andamento (worker vivo encerrando o processo após a interrupção) impede a
    // retomada: senão duas sessões trabalhariam ao mesmo tempo no mesmo workspace.
    const vivos = await this.prisma.attempt.findMany({ where: { jobId, status: 'EXECUTANDO' } });
    const limite = new Date(Date.now() - 2 * appConfig().leaseMs);
    for (const a of vivos) {
      const hb = await this.prisma.workerHeartbeat.findUnique({ where: { id: a.workerId } });
      if (hb && hb.lastSeenAt > limite) {
        throw new ConflictException(`A sessão #${a.number} ainda está sendo encerrada pelo worker ${a.workerId}. Aguarde alguns segundos e retome de novo.`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      for (const s of job.steps) {
        const ultima = await tx.attempt.aggregate({ where: { stepId: s.id }, _max: { number: true } });
        const recomeco = { resumeFromAttempt: ultima._max.number ?? 0 }; // limites contam a partir da retomada
        if (s.status === 'EXECUTANDO') {
          // Worker morreu (sem sinal): a tentativa órfã é encerrada; a etapa volta para PENDENTE.
          await tx.attempt.updateMany({
            where: { stepId: s.id, status: 'EXECUTANDO' },
            data: { status: 'INTERROMPIDA', endedAt: new Date(), error: 'tentativa órfã encerrada na retomada (worker sem sinal)' },
          });
          await tx.step.update({ where: { id: s.id }, data: { status: 'PENDENTE', statusDetail: 'retomada', ...recomeco } });
        } else if (['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(s.status)) {
          await tx.step.update({ where: { id: s.id }, data: { status: 'PENDENTE', statusDetail: 'retomada', ...recomeco } });
        }
      }
      await tx.job.update({
        where: { id: jobId },
        data: { status: 'EXECUTANDO', blockedReason: null, statusDetail: `retomado por ${by}`, finishedAt: null, startedAt: job.startedAt ?? new Date() },
      });
    });
    await this.logs.log(jobId, `Job retomado por ${by} a partir do último checkpoint`);
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  /** Solicita nova verificação de critérios (nunca marca conclusão diretamente). */
  async requestEvaluation(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') return job;
    if (job.steps.some((s) => s.status !== 'CONCLUIDO')) {
      throw new ConflictException('Há etapas não concluídas; retome o job em vez de reavaliar');
    }
    if (!['BLOQUEADO', 'AGUARDANDO_APROVACAO', 'EXECUTANDO'].includes(job.status)) {
      throw new ConflictException(`Job em ${job.status} não pode ser reavaliado`);
    }
    if (job.status === 'BLOQUEADO') {
      await this.prisma.job.update({ where: { id: jobId }, data: { status: 'EXECUTANDO', blockedReason: null } });
    }
    await this.queue.enqueue(this.prisma, 'EVALUATE_JOB', jobId, null);
    await this.logs.log(jobId, 'Reavaliação de critérios solicitada');
    return this.get(projectId, jobId);
  }

  /** Estado real do job: o que está pronto, o que falta. */
  async report(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    const pendingSteps = job.steps.filter((s) => s.status !== 'CONCLUIDO').map((s) => ({ key: s.key, status: s.status, detalhe: s.statusDetail }));
    const pendingCriteria = job.criteria.filter((c) => c.status !== 'APROVADO').map((c) => ({ key: c.key, status: c.status, descricao: c.description }));
    const pendingApprovals = job.approvals.filter((a) => a.status === 'PENDENTE').map((a) => ({ id: a.id, descricao: a.description }));
    return {
      jobId,
      status: job.status,
      motivo: job.blockedReason,
      detalhe: job.statusDetail,
      concluido: job.status === 'CONCLUIDO',
      objetivo: job.objectives[job.objectives.length - 1],
      etapasPendentes: pendingSteps,
      criteriosPendentes: pendingCriteria,
      aprovacoesPendentes: pendingApprovals,
      semCriterios: job.criteria.length === 0,
      custoUsd: job.costSpentUsd,
      tempoAtivoSeg: job.activeSeconds,
      tentativas: job.attempts.length,
    };
  }
}

const CAMINHO_SEGURO = /^(?!\/)(?!.*\.\.)[\w\-./ ]{1,200}$/;

/** Opções de uma etapa de vídeo vindas do plano, validadas (nada de caminho fora do projeto). */
export function opcoesDeVideo(key: string, o: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const arquivo = String(o.arquivo ?? `videos/${key}.mp4`).trim();
  if (!CAMINHO_SEGURO.test(arquivo) || !/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
  out.arquivo = arquivo;
  if (o.duracaoSeg !== undefined) {
    const n = Number(o.duracaoSeg);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw new BadRequestException(`Etapa ${key}: duracaoSeg deve ser inteiro entre 1 e 60`);
    out.duracaoSeg = n;
  }
  if (o.proporcao !== undefined) {
    if (!/^\d{1,2}:\d{1,2}$/.test(String(o.proporcao))) throw new BadRequestException(`Etapa ${key}: proporcao deve ser como 16:9 ou 9:16`);
    out.proporcao = String(o.proporcao);
  }
  if (o.resolucao !== undefined) {
    if (!/^\d{3,4}p$|^4k$/i.test(String(o.resolucao))) throw new BadRequestException(`Etapa ${key}: resolucao deve ser como 720p ou 1080p`);
    out.resolucao = String(o.resolucao);
  }
  if (o.negativo !== undefined) out.negativo = String(o.negativo).slice(0, 1000);
  if (o.imagem !== undefined) {
    const img = String(o.imagem).trim();
    if (!CAMINHO_SEGURO.test(img) || !/\.(png|jpe?g|webp)$/i.test(img)) throw new BadRequestException(`Etapa ${key}: "imagem" deve ser um caminho de imagem do projeto (png, jpg, webp)`);
    out.imagem = img;
  }
  if (o.conexao !== undefined) out.conexao = String(o.conexao).slice(0, 60);
  return out;
}
