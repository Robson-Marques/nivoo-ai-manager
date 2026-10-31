import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CriterionKind, Prisma } from '@prisma/client';
import { sha256 } from '../common/hash';
import { BlockedReason } from '../common/status';
import { oneOf, optNumber, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { QueueService } from '../queue/queue.service';
import { evaluatePolicy } from '../security/policy';
import { LogService } from './log.service';
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
      const pol = evaluatePolicy(`${instructions}\n${verifyCommand ?? ''}`);
      if (pol.forbidden) throw new BadRequestException(`Etapa ${key} proibida pela política: ${pol.reasons.join('; ')}`);
      return {
        key,
        title: optString(s, 'title', 300) ?? key,
        instructions,
        provider,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
        verifyCommand,
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
    // Critérios permanentes do projeto (regressão): entram em todo job novo, sem opção de remover.
    const invariants = await this.prisma.projectInvariant.findMany({ where: { projectId, active: true }, orderBy: { createdAt: 'asc' } });
    for (const inv of invariants) {
      const key = `invariante:${inv.key}`;
      if (criteria.some((c) => c.key === key)) continue;
      criteria.push({ key, description: `[permanente do projeto] ${inv.description}`, kind: inv.kind, config: inv.config as Prisma.InputJsonValue });
    }
    const researchId = optString(body, 'researchId', 60);
    if (researchId) {
      const r = await this.prisma.research.findFirst({ where: { id: researchId, projectId } });
      if (!r) throw new BadRequestException('Pesquisa não pertence a este projeto');
    }
    const limits = body.limits ?? {};
    let experiment: Prisma.ExperimentUncheckedCreateWithoutJobInput | undefined;
    if (body.experiment) {
      if (!researchId) throw new BadRequestException('Experimento exige researchId');
      const e = body.experiment;
      const hypothesisId = optString(e, 'hypothesisId', 60);
      const datasetId = optString(e, 'datasetId', 60);
      if (hypothesisId && !(await this.prisma.hypothesis.findFirst({ where: { id: hypothesisId, researchId } }))) {
        throw new BadRequestException('Hipótese não pertence à pesquisa');
      }
      if (datasetId) {
        const ds = await this.prisma.dataset.findFirst({ where: { id: datasetId, projectId } });
        if (!ds) throw new BadRequestException('Dataset não pertence a este projeto');
        if (ds.role === 'RESERVADO' && !ds.released) {
          throw new BadRequestException('Conjunto de validação RESERVADO: uso bloqueado até liberação aprovada');
        }
      }
      experiment = {
        projectId,
        researchId,
        hypothesisId,
        datasetId,
        name: optString(e, 'name', 300) ?? title,
        parameters: (e.parameters ?? {}) as Prisma.InputJsonValue,
      };
    }
    const job = await this.prisma.job.create({
      data: {
        projectId,
        researchId,
        title,
        defaultProvider,
        maxAttemptsPerStep: optNumber(limits, 'maxAttemptsPerStep', 1, 100),
        maxDurationSec: optNumber(limits, 'maxDurationSec', 10, 7 * 24 * 3600),
        maxCostUsd: optNumber(limits, 'maxCostUsd', 0, 10000),
        stepTimeoutSec: optNumber(limits, 'stepTimeoutSec', 1, 24 * 3600),
        repetitionWindow: optNumber(limits, 'repetitionWindow', 2, 20),
        maxSessionsPerStep: optNumber(limits, 'maxSessionsPerStep', 1, 100),
        gitBranch: null,
        objectives: {
          create: { version: 1, text: objective, sha256: sha256(objective), author: optString(body, 'author', 100) ?? 'operador' },
        },
        steps: { create: steps.map((s, i) => ({ ...s, order: i })) },
        criteria: { create: criteria },
        experiment: experiment ? { create: experiment } : undefined,
      },
    });
    await this.prisma.job.update({ where: { id: job.id }, data: { gitBranch: `job/${job.id}` } });
    await this.logs.log(job.id, `Job criado com ${steps.length} etapa(s) e ${criteria.length} critério(s). Objetivo v1 sha256=${sha256(objective).slice(0, 12)}`);
    if (criteria.length === 0) {
      await this.logs.log(job.id, 'ATENÇÃO: job sem critérios de aceitação — a conclusão será bloqueada até que critérios sejam adicionados.', { level: 'WARN' });
    }
    return this.get(projectId, job.id);
  }

  // ---------- Critérios permanentes do projeto ----------
  listInvariants(projectId: string) {
    return this.prisma.projectInvariant.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async createInvariant(projectId: string, body: any) {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Projeto não encontrado');
    const [c] = this.parseCriteria([body]);
    if (c.kind === 'MANUAL_APPROVAL') throw new BadRequestException('Critério permanente deve ser verificável automaticamente');
    const exists = await this.prisma.projectInvariant.findUnique({ where: { projectId_key: { projectId, key: c.key } } });
    if (exists) throw new ConflictException(`Critério permanente ${c.key} já existe`);
    return this.prisma.projectInvariant.create({
      data: { projectId, key: c.key, description: c.description, kind: c.kind, config: c.config, author: optString(body, 'author', 100) ?? 'operador' },
    });
  }

  /** Desativar não altera jobs já criados (seus critérios ficam congelados); só os próximos. */
  async setInvariantActive(projectId: string, id: string, body: any) {
    const inv = await this.prisma.projectInvariant.findFirst({ where: { id, projectId } });
    if (!inv) throw new NotFoundException('Critério permanente não encontrado neste projeto');
    if (typeof body?.active !== 'boolean') throw new BadRequestException('active deve ser true ou false');
    return this.prisma.projectInvariant.update({ where: { id }, data: { active: body.active } });
  }

  async setProjectBudget(projectId: string, body: any) {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Projeto não encontrado');
    const v = body?.maxCostUsd;
    const maxCostUsd = v === null ? null : optNumber(body, 'maxCostUsd', 0, 1_000_000);
    if (maxCostUsd === undefined) throw new BadRequestException('Informe maxCostUsd (número) ou null para remover o limite');
    const agg = await this.prisma.job.aggregate({ where: { projectId }, _sum: { costSpentUsd: true } });
    const p = await this.prisma.project.update({ where: { id: projectId }, data: { maxCostUsd } });
    return { ...p, custoGastoUsd: agg._sum.costSpentUsd ?? 0 };
  }

  async list(projectId: string) {
    return this.prisma.job.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { steps: { select: { key: true, status: true } }, research: { select: { id: true, title: true } } },
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
        experiment: true,
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
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const running = await tx.queueTask.findMany({ where: { jobId, status: 'RUNNING' }, select: { stepId: true } });
      const busy = new Set(running.map((t) => t.stepId));
      for (const s of job.steps) {
        if (s.status === 'EXECUTANDO' && !busy.has(s.id)) {
          // Worker caiu durante a interrupção: tentativa órfã é encerrada; etapa volta para PENDENTE.
          await tx.attempt.updateMany({
            where: { stepId: s.id, status: 'EXECUTANDO' },
            data: { status: 'INTERROMPIDA', endedAt: new Date(), error: 'tentativa órfã encerrada na retomada' },
          });
          await tx.step.update({ where: { id: s.id }, data: { status: 'PENDENTE', statusDetail: 'retomada' } });
        } else if (['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(s.status)) {
          await tx.step.update({ where: { id: s.id }, data: { status: 'PENDENTE', statusDetail: 'retomada' } });
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
