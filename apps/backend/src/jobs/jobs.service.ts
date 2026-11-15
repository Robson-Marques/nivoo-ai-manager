import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CriterionKind, Prisma } from '@prisma/client';
import { sha256 } from '../common/hash';
import { caminhoDoProjeto } from '../common/path-guard';
import { appConfig } from '../config';
import { BlockedReason } from '../common/status';
import { oneOf, optNumber, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { QueueService } from '../queue/queue.service';
import { evaluatePolicy } from '../security/policy';
import { LogService } from './log.service';
import { aceitarRevisao, lerRevisao, RULE_REVIEW_CRITERION, RULE_REVIEW_STEP, ruleReviewStep } from './rule-review';
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
      // Juntar as cenas num vídeo só (etapa do sistema, ffmpeg).
      if ((provider ?? defaultProvider) === 'juntar-videos') {
        Object.assign(providerOptions, opcoesDeJuncao(key, opts));
        verificacao = verifyCommand ?? `test -s '${providerOptions.arquivo}'`;
      }
      // Apagar/mover arquivos (etapa do sistema): lista validada. O "Fazer" do plano já é a confirmação, e o
      // git guarda tudo (dá para voltar qualquer arquivo) — não pede uma segunda confirmação.
      if ((provider ?? defaultProvider) === 'arquivos-projeto') {
        Object.assign(providerOptions, operacoesDeArquivos(key, opts));
        const r = (providerOptions.remover as string[]).map((p) => `test ! -e '${p}'`);
        const m = (providerOptions.mover as Array<{ para: string }>).map((x) => `test -e '${x.para}'`);
        verificacao = verifyCommand ?? ([...r, ...m].join(' && ') || 'true');
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
    const brutas = comVideoCompleto(plan.steps, defaultProvider);
    const steps = this.parseSteps(brutas, defaultProvider);
    this.assertAcyclic(steps);
    const criteria = this.parseCriteria(plan.criteria ?? []);
    if (criteria.length === 0) throw new BadRequestException('O plano precisa de critérios de aceitação verificáveis');
    const limits = plan.limits && typeof plan.limits === 'object' ? plan.limits : {};
    return { title, objective, defaultProvider, steps: brutas, criteria: plan.criteria, limits };
  }

  async create(projectId: string, body: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const title = reqString(body, 'title', 300);
    const objective = reqString(body, 'objective', 50000);
    const defaultProvider = optString(body, 'defaultProvider', 60) ?? 'local-shell';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    const steps = this.parseSteps(comVideoCompleto(body.steps ?? [], defaultProvider), defaultProvider);
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
    // Última coisa registrada (ex.: "[ferramenta] Read src/app.ts"): a tela mostra que o trabalho está vivo.
    const ultima = await this.prisma.logEntry.findFirst({ where: { jobId }, orderBy: { id: 'desc' }, select: { message: true, createdAt: true } });
    return { ...job, ultimaAtividade: ultima ? { mensagem: ultima.message.slice(0, 300), em: ultima.createdAt } : null };
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
      // 0 = sem limite (como na criação).
      maxDurationSec: body?.maxDurationSec === 0 ? 0 : optNumber(body, 'maxDurationSec', 10, 7 * 24 * 3600),
      maxCostUsd: optNumber(body, 'maxCostUsd', 0, 10000),
      stepTimeoutSec: optNumber(body, 'stepTimeoutSec', 1, 24 * 3600),
      repetitionWindow: optNumber(body, 'repetitionWindow', 2, 20),
      maxSessionsPerStep: body?.maxSessionsPerStep === 0 ? 0 : optNumber(body, 'maxSessionsPerStep', 1, 100),
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

  private async pastaDoTrabalho(projectId: string, jobId: string): Promise<string | null> {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspacePath: true } });
    const wt = p ? path.join(p.workspacePath, 'worktrees', jobId) : null;
    return wt && fs.existsSync(wt) ? wt : null;
  }

  /** O que a revisão independente disse (violações e perguntas para o usuário). */
  async revisao(projectId: string, jobId: string) {
    await this.get(projectId, jobId);
    const wt = await this.pastaDoTrabalho(projectId, jobId);
    return (wt && lerRevisao(wt)) ?? { conforme: null, violacoes: [], perguntas: [], observacoes: '' };
  }

  /**
   * "Aceitar assim mesmo": a revisão disse "não conforme" (ex.: por uma dúvida que só o usuário responde) e o
   * usuário aceita o trabalho como está. Fica registrado no relatório quem aceitou e o que estava apontado; os
   * critérios são conferidos de novo e, passando, o trabalho conclui normalmente. Um trabalho nunca fica preso.
   */
  async aceitarRevisao(projectId: string, jobId: string, por = 'usuário') {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'BLOQUEADO' || job.blockedReason !== BlockedReason.CRITERIOS_NAO_ATENDIDOS) {
      throw new ConflictException('Só dá para aceitar assim mesmo um trabalho parado pela conferência final');
    }
    if (!job.criteria.some((c) => c.key === RULE_REVIEW_STEP)) throw new ConflictException('Este trabalho não tem revisão independente');
    if (job.steps.some((s) => s.status !== 'CONCLUIDO')) throw new ConflictException('Há etapas não concluídas; use "Tentar de novo"');
    const wt = await this.pastaDoTrabalho(projectId, jobId);
    if (!wt) throw new ConflictException('A pasta do trabalho não existe mais');
    const nome = String(por).slice(0, 80) || 'usuário';
    aceitarRevisao(wt, nome);
    await this.logs.log(jobId, `Revisão aceita assim mesmo por ${nome}: os critérios são conferidos de novo`, { level: 'WARN' });
    return this.requestEvaluation(projectId, jobId);
  }

  /**
   * O usuário responde às perguntas da revisão ali mesmo: a resposta fica guardada (out/respostas-do-usuario.md e
   * memória do projeto), a IA do trabalho aplica a resposta numa etapa nova e a revisão independente confere de novo.
   */
  async responderRevisao(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'BLOQUEADO' || job.blockedReason !== BlockedReason.CRITERIOS_NAO_ATENDIDOS) {
      throw new ConflictException('Só dá para responder à revisão de um trabalho parado pela conferência final');
    }
    const revisao = job.steps.find((s) => s.key === RULE_REVIEW_STEP);
    if (!revisao) throw new ConflictException('Este trabalho não tem revisão independente');
    if (job.steps.some((s) => s.status !== 'CONCLUIDO')) throw new ConflictException('Há etapas não concluídas; use "Tentar de novo"');
    const resposta = reqString(body, 'resposta', 20000).trim();
    if (!resposta) throw new BadRequestException('Escreva a resposta');
    const por = (optString(body, 'por', 80) ?? 'usuário').trim() || 'usuário';
    const wt = await this.pastaDoTrabalho(projectId, jobId);
    if (!wt) throw new ConflictException('A pasta do trabalho não existe mais');
    const r = lerRevisao(wt) ?? { violacoes: [], perguntas: [], observacoes: '' };
    const quando = new Date().toISOString();
    fs.mkdirSync(path.join(wt, 'out'), { recursive: true });
    fs.appendFileSync(path.join(wt, 'out', 'respostas-do-usuario.md'), `## Resposta de ${por} (${quando})\n\n${resposta}\n\n`);
    fs.rmSync(path.join(wt, 'out', 'conferencia-regras.json'), { force: true }); // o veredito antigo sai; a revisão roda de novo
    const n = job.steps.filter((s) => s.key.startsWith('resposta-usuario-')).length + 1;
    const key = `resposta-usuario-${n}`;
    const outras = job.steps.filter((s) => s.key !== RULE_REVIEW_STEP);
    const provider = [...outras].reverse().find((s) => s.provider)?.provider ?? job.defaultProvider;
    const base = Math.max(...job.steps.map((s) => s.order)) + 1;
    const lista = (t: string, xs: string[]) => (xs.length ? [t, ...xs.map((x) => `- ${x}`), ''] : []);
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      await tx.step.create({
        data: {
          jobId, key, order: base, provider, dependsOn: outras.map((s) => s.key),
          title: 'Aplicar a resposta do usuário',
          instructions: [
            'A revisão independente deixou perguntas que só o usuário podia responder. Ele RESPONDEU. Aplique a resposta ao trabalho.',
            '',
            ...lista('O que a revisão apontou:', r.violacoes),
            ...lista('Perguntas:', r.perguntas.map((q) => q.pergunta)),
            `Resposta do usuário (${por}):`,
            resposta,
            '',
            'Ajuste os entregáveis de acordo com a resposta (ela também está em out/respostas-do-usuario.md), mantendo o que já foi feito e as regras do projeto.',
            'Atualize out/perguntas-ao-usuario.md: tire o que foi respondido; deixe só o que continuar realmente em aberto.',
          ].join('\n'),
          verifyCommand: 'true',
        },
      });
      await tx.step.update({ where: { id: revisao.id }, data: { status: 'PENDENTE', order: base + 1, dependsOn: [...new Set([...revisao.dependsOn, key])], statusDetail: 'resposta do usuário: conferir de novo' } });
      await tx.job.update({ where: { id: jobId }, data: { status: 'EXECUTANDO', blockedReason: null, statusDetail: `aplicando a resposta de ${por}`, finishedAt: null } });
      await tx.memoryEntry.create({
        data: {
          projectId, category: 'ESPECIFICACAO', author: por, references: { jobId },
          title: `Resposta do usuário: ${resposta.replace(/\s+/g, ' ').slice(0, 120)}`,
          content: [...lista('Perguntas:', r.perguntas.map((q) => q.pergunta)), 'Resposta:', resposta].join('\n').slice(0, 50000),
        },
      });
    });
    await this.logs.log(jobId, `Resposta de ${por} às perguntas da revisão: a IA aplica e a revisão confere de novo`, { level: 'INFO' });
    await this.orchestrator.scheduleReady(jobId);
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
  const arquivo = caminhoDoProjeto(o.arquivo ?? `videos/${key}.mp4`) ?? '';
  if (!/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
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
  // Legenda da cena (texto curto que aparece no vídeo completo) e estilo da transição para a cena seguinte.
  if (o.legenda !== undefined && String(o.legenda).trim()) out.legenda = String(o.legenda).trim().slice(0, 300);
  if (o.transicao !== undefined) out.transicao = transicaoValida(key, o.transicao);
  // Trilha de fundo do vídeo completo (na cena: vai para a junção) e cena sem música própria.
  if (o.trilha !== undefined) out.trilha = trilhaValida(key, o.trilha);
  if (o.semMusica !== undefined) out.semMusica = o.semMusica === true;
  return out;
}

/** Lista de apagar/mover de uma etapa "arquivos-projeto", validada (só caminhos do projeto, nada protegido). */
export function operacoesDeArquivos(key: string, o: any): { remover: string[]; mover: Array<{ de: string; para: string }> } {
  const ok = (p: unknown) => {
    const r = caminhoDoProjeto(p);
    if (!r) throw new BadRequestException(`Etapa ${key}: caminho inválido ou protegido: ${String(p)}`);
    return r;
  };
  const remover = Array.isArray(o.remover) ? o.remover.map(ok) : [];
  const mover = Array.isArray(o.mover) ? o.mover.map((m: any) => ({ de: ok(m?.de), para: ok(m?.para) })) : [];
  if (!remover.length && !mover.length) throw new BadRequestException(`Etapa ${key}: informe "remover" e/ou "mover"`);
  if (remover.length + mover.length > 2000) throw new BadRequestException(`Etapa ${key}: no máximo 2000 itens por etapa`);
  return { remover, mover };
}

/** Opções da etapa que junta as cenas: lista de cenas (na ordem) e o arquivo final, só caminhos do projeto. */
/** Estilos de transição entre as cenas (nomes do ffmpeg xfade); "corte" = sem transição. */
export const TRANSICOES = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'slideup', 'circleopen', 'circleclose', 'smoothleft', 'zoomin', 'corte'];

/** Trilha de fundo: um áudio do projeto ou a descrição da música que o Google (Lyria) compõe; volume 0–1. */
function trilhaValida(key: string, t: any): { arquivo?: string; descricao?: string; volume?: number } {
  if (!t || typeof t !== 'object') throw new BadRequestException(`Etapa ${key}: trilha deve ser {"descricao":"..."} ou {"arquivo":"audio/musica.mp3"}`);
  const out: { arquivo?: string; descricao?: string; volume?: number } = {};
  if (t.arquivo !== undefined) {
    const a = caminhoDoProjeto(t.arquivo);
    if (!a || !/\.(mp3|wav|m4a|aac|ogg)$/i.test(a)) throw new BadRequestException(`Etapa ${key}: trilha.arquivo deve ser um áudio do projeto (mp3, wav, m4a, aac, ogg)`);
    out.arquivo = a;
  }
  if (t.descricao !== undefined && String(t.descricao).trim()) out.descricao = String(t.descricao).trim().slice(0, 1000);
  if (!out.arquivo && !out.descricao) throw new BadRequestException(`Etapa ${key}: trilha precisa de "descricao" (música gerada) ou "arquivo" (áudio do projeto)`);
  if (t.volume !== undefined) {
    const v = Number(t.volume);
    if (!(v > 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: trilha.volume deve ser entre 0 e 1`);
    out.volume = v;
  }
  return out;
}

function transicaoValida(key: string, t: unknown): string {
  const v = String(t).trim().toLowerCase();
  if (!TRANSICOES.includes(v)) throw new BadRequestException(`Etapa ${key}: transicao deve ser uma de: ${TRANSICOES.join(', ')}`);
  return v;
}

export function opcoesDeJuncao(key: string, o: any): { cenas: string[]; arquivo: string; legendas?: string[]; transicoes?: string[]; trilha?: ReturnType<typeof trilhaValida>; volumeCenas?: number } {
  const cenas = Array.isArray(o.cenas) ? o.cenas.map((c: unknown) => caminhoDoProjeto(c)) : [];
  if (!cenas.length || cenas.some((c: string | null) => !c || !/\.(mp4|mov|webm)$/i.test(c))) throw new BadRequestException(`Etapa ${key}: "cenas" deve ser a lista de vídeos do projeto, na ordem`);
  if (cenas.length > 200) throw new BadRequestException(`Etapa ${key}: no máximo 200 cenas`);
  const arquivo = caminhoDoProjeto(o.arquivo) ?? '';
  if (!/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
  if (cenas.includes(arquivo)) throw new BadRequestException(`Etapa ${key}: o vídeo final não pode ter o nome de uma cena`);
  const out: ReturnType<typeof opcoesDeJuncao> = { cenas, arquivo };
  if (o.trilha !== undefined) out.trilha = trilhaValida(key, o.trilha);
  if (o.volumeCenas !== undefined) {
    const v = Number(o.volumeCenas);
    if (!(v >= 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: volumeCenas deve ser entre 0 (sem o som das cenas) e 1`);
    out.volumeCenas = v;
  }
  if (Array.isArray(o.legendas) && o.legendas.some((l: unknown) => String(l ?? '').trim())) out.legendas = cenas.map((_: string, i: number) => String(o.legendas[i] ?? '').trim().slice(0, 300));
  if (o.transicao !== undefined || Array.isArray(o.transicoes)) {
    const lista = Array.isArray(o.transicoes) ? o.transicoes : [];
    out.transicoes = cenas.slice(1).map((_: string, i: number) => transicaoValida(key, lista[i] ?? o.transicao ?? 'fade'));
  }
  return out;
}

/**
 * Plano com duas ou mais cenas de vídeo ganha, sozinho, a etapa final que junta tudo num vídeo só (o Veo
 * gera de 4 a 8 s por vez; quem pediu o vídeo quer o vídeo inteiro). Se o plano já tem a etapa, nada muda.
 * Nome do final: `<pasta das cenas>/<pasta>-completo.mp4` (ex.: videos/pizzaria/pizzaria-completo.mp4).
 */
export function comVideoCompleto(entrada: unknown, defaultProvider: string): unknown {
  if (!Array.isArray(entrada)) return entrada;
  let raw: any[] = entrada;
  if (raw.some((s: any) => (s?.provider ?? defaultProvider) === 'juntar-videos')) return raw;
  let cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  if (cenas.length < 2) return raw;
  // Com trilha de fundo, as cenas vêm SEM música própria (só falas e sons do ambiente): a música corre única,
  // de ponta a ponta, na montagem.
  const trilha = cenas.map((s: any) => s.providerOptions?.trilha).find((t: unknown) => t);
  if (trilha) {
    raw = raw.map((s: any) => (cenas.includes(s) ? { ...s, providerOptions: { ...(s.providerOptions ?? {}), semMusica: true } } : s));
    cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  }
  const arquivos = cenas.map((s: any) => caminhoDoProjeto(s.providerOptions?.arquivo ?? `videos/${s.key}.mp4`));
  if (arquivos.some((a) => !a)) return raw; // a validação da cena aponta o erro
  const pastas = [...new Set(arquivos.map((a) => path.posix.dirname(a as string)))];
  const pasta = pastas.length === 1 && pastas[0] !== '.' ? pastas[0] : 'videos';
  const nome = pasta === 'videos' ? 'video' : path.posix.basename(pasta);
  let arquivo = `${pasta}/${nome}-completo.mp4`;
  for (let n = 2; arquivos.includes(arquivo); n++) arquivo = `${pasta}/${nome}-completo-${n}.mp4`;
  const chaves = new Set(raw.map((s: any) => String(s?.key)));
  let key = 'video-completo';
  for (let n = 2; chaves.has(key); n++) key = `video-completo-${n}`;
  return [
    ...raw,
    {
      key,
      title: 'Juntar as cenas no vídeo completo',
      provider: 'juntar-videos',
      instructions: `Junta as ${cenas.length} cenas, na ordem, em ${arquivo}.`,
      dependsOn: cenas.map((s: any) => s.key),
      providerOptions: {
        cenas: arquivos,
        arquivo,
        // Legenda de cada cena (se o plano trouxe) e a transição escolhida em cada cena para a seguinte.
        ...(cenas.some((s: any) => String(s.providerOptions?.legenda ?? '').trim()) ? { legendas: cenas.map((s: any) => String(s.providerOptions?.legenda ?? '').trim()) } : {}),
        ...(cenas.some((s: any) => s.providerOptions?.transicao) ? { transicoes: cenas.slice(0, -1).map((s: any) => String(s.providerOptions?.transicao ?? 'fade')) } : {}),
        ...(trilha ? { trilha } : {}),
      },
    },
  ];
}
