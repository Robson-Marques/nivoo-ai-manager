import { Injectable, Logger } from '@nestjs/common';
import { Job, Prisma, Step } from '@prisma/client';
import * as path from 'node:path';
import { appConfig } from '../config';
import { normalizedOutputHash } from '../common/hash';
import { minimalEnv, runProcess } from '../common/exec';
import { BlockedReason } from '../common/status';
import { LogService } from '../jobs/log.service';
import { OrchestratorService } from '../jobs/orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ExecutionResult } from '../providers/provider.interface';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { AGENT_RULES, evaluatePolicy } from '../security/policy';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';

const RESOURCE_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

export type StepOutcome = 'CONCLUIDO' | 'RETRY' | 'FALHOU' | 'BLOQUEADO' | 'INTERROMPIDO' | 'AGUARDANDO_RECURSO' | 'AGUARDANDO_APROVACAO' | 'IGNORADO';

@Injectable()
export class StepExecutorService {
  private readonly logger = new Logger('StepExecutor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly registry: ProviderRegistry,
    private readonly workspace: WorkspaceService,
    private readonly artifacts: ArtifactStoreService,
    private readonly orchestrator: OrchestratorService,
    private readonly logs: LogService,
  ) {}

  /**
   * Executa uma tarefa RUN_STEP. `signal` é abortado quando o lease é perdido
   * (interrupção pelo usuário ou outro worker assumiu).
   */
  async run(task: ClaimedTask, workerId: string, signal: AbortSignal): Promise<StepOutcome> {
    const step = await this.prisma.step.findUnique({ where: { id: task.stepId! } });
    const job = step ? await this.prisma.job.findUnique({ where: { id: step.jobId }, include: { project: true } }) : null;
    if (!step || !job) {
      await this.queue.complete(task.id, workerId);
      return 'IGNORADO';
    }
    const L = (msg: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO', attemptId?: string) =>
      this.logs.log(job.id, msg, { stepId: step.id, attemptId, level, source: `worker:${workerId}` });

    // Recuperação: tentativas órfãs de um worker anterior que perdeu o lease.
    const orphans = await this.prisma.attempt.updateMany({
      where: { stepId: step.id, status: 'EXECUTANDO' },
      data: { status: 'INTERROMPIDA', endedAt: new Date(), error: `worker perdido (${task.previousLockedBy ?? 'desconhecido'}); lease expirado` },
    });
    if (orphans.count > 0 || task.recovered) {
      await L(`Recuperação: ${orphans.count} tentativa(s) órfã(s) de ${task.previousLockedBy ?? '?'} encerradas; retomando a partir do último checkpoint`, 'WARN');
      await this.prisma.step.updateMany({ where: { id: step.id, status: 'EXECUTANDO' }, data: { status: 'PENDENTE' } });
    }

    if (!['EXECUTANDO', 'AGUARDANDO_RECURSO'].includes(job.status)) {
      await this.queue.complete(task.id, workerId);
      return 'IGNORADO';
    }
    if (step.status === 'CONCLUIDO') {
      await this.queue.complete(task.id, workerId);
      await this.orchestrator.scheduleReady(job.id);
      return 'IGNORADO';
    }

    // Limites de tempo e orçamento do job.
    if (job.activeSeconds >= job.maxDurationSec) {
      return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_TEMPO, `tempo ativo ${job.activeSeconds}s ≥ limite ${job.maxDurationSec}s`);
    }
    if (new Prisma.Decimal(job.costSpentUsd).gte(job.maxCostUsd)) {
      return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_ORCAMENTO, `custo US$ ${job.costSpentUsd} ≥ orçamento US$ ${job.maxCostUsd}`);
    }
    const failures = await this.prisma.attempt.count({ where: { stepId: step.id, status: 'FALHA' } });
    if (failures >= job.maxAttemptsPerStep) {
      return this.failStep(task, workerId, job, step, `limite de ${job.maxAttemptsPerStep} tentativa(s) com falha atingido`);
    }

    // Política: proibições financeiras e ações destrutivas.
    const pol = evaluatePolicy(`${step.instructions}\n${step.verifyCommand ?? ''}`);
    if (pol.forbidden) {
      return this.blockJob(task, workerId, job, step, BlockedReason.POLITICA, pol.reasons.join('; '));
    }
    if (step.requiresApproval || pol.requiresApproval) {
      const approved = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'APROVADO' } });
      if (!approved) return this.awaitApproval(task, workerId, job, step, pol.reasons);
    }

    // Disponibilidade do conector.
    const providerId = step.provider ?? job.defaultProvider;
    const status = await this.registry.status(providerId, 15_000);
    if (!status.available) {
      return this.awaitResource(task, workerId, job, step, `${providerId} indisponível: ${status.errors.join('; ') || 'sem detalhes'}`);
    }
    const provider = this.registry.get(providerId);

    // Workspace isolado do job (worktree na branch job/<id>).
    const worktree = await this.workspace.ensureJobWorktree(job.project.slug, job.id);
    const dataDir = this.workspace.projectDirs(job.project.slug).data;
    const outputDir = path.join(worktree, 'out');

    const number = (await this.prisma.attempt.count({ where: { stepId: step.id } })) + 1;
    const attempt = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.job.updateMany({ where: { id: job.id, status: 'AGUARDANDO_RECURSO' }, data: { status: 'EXECUTANDO', statusDetail: null } });
      await tx.step.update({ where: { id: step.id }, data: { status: 'EXECUTANDO', statusDetail: null, attemptCount: number } });
      return tx.attempt.create({ data: { jobId: job.id, stepId: step.id, number, provider: providerId, workerId } });
    });
    await L(`Tentativa #${number} da etapa "${step.key}" com ${providerId}`, 'INFO', attempt.id);

    const context = await this.buildContext(job, step);
    const remainingSec = Math.max(1, job.maxDurationSec - job.activeSeconds);
    const timeoutMs = Math.min(job.stepTimeoutSec, remainingSec) * 1000;
    const started = Date.now();
    let result: ExecutionResult;
    // Logs do provedor são gravados em ordem, sem bloquear a execução.
    let logChain = Promise.resolve();
    try {
      result = await provider.execute({
        jobId: job.id,
        stepId: step.id,
        attemptId: attempt.id,
        instructions: step.instructions,
        context,
        cwd: worktree,
        outputDir,
        dataDir,
        timeoutMs,
        signal,
        onLog: (line, level = 'INFO') => {
          logChain = logChain.then(() =>
            this.logs.log(job.id, line, { stepId: step.id, attemptId: attempt.id, level, source: `provider:${providerId}` }).catch(() => undefined),
          );
        },
      });
    } catch (e: any) {
      result = { exitCode: -1, output: '', error: `erro do conector: ${e?.message ?? e}` };
    }
    await logChain;

    // Verificação determinística da etapa (não decide conclusão do job).
    if (result.exitCode === 0 && !result.interrupted && step.verifyCommand) {
      const v = await runProcess('bash', ['-e', '-o', 'pipefail', '-c', step.verifyCommand], {
        cwd: worktree,
        env: minimalEnv({ NIVOO_JOB_ID: job.id, NIVOO_OUTPUT_DIR: outputDir, NIVOO_DATA_DIR: dataDir }),
        timeoutMs: 120_000,
        signal,
      });
      await L(`Verificação da etapa: exit ${v.exitCode}${v.stderr ? ` — ${v.stderr.slice(0, 500)}` : ''}`, v.exitCode === 0 ? 'INFO' : 'WARN', attempt.id);
      if (v.aborted) result = { ...result, interrupted: true };
      else if (v.exitCode !== 0) result = { ...result, exitCode: v.exitCode ?? 1, error: `verificação da etapa falhou (exit ${v.exitCode}): ${v.stderr.slice(0, 500)}` };
    }
    const elapsedSec = Math.ceil((Date.now() - started) / 1000);

    // Artefatos: saída da tentativa + arquivos novos em out/.
    const logArt = await this.artifacts.storeContent(
      { projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id, name: `logs/${step.key}/tentativa-${number}.log`, kind: 'LOG' },
      `${result.output}\n${result.error ? `\n[erro] ${result.error}\n` : ''}`,
    );
    const outputs = await this.artifacts.collectOutputs({ projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id }, outputDir);
    if (outputs.length) await L(`Artefatos registrados: ${outputs.map((a) => `${a.name} (sha256 ${a.sha256.slice(0, 12)})`).join(', ')}`, 'INFO', attempt.id);

    const attemptStatus = result.interrupted
      ? 'INTERROMPIDA'
      : result.resourceUnavailable
        ? 'RECURSO_INDISPONIVEL'
        : result.exitCode === 0
          ? 'SUCESSO'
          : 'FALHA';
    const outputHash = normalizedOutputHash(result.output ?? '', result.error);
    await this.prisma.$transaction([
      this.prisma.attempt.update({
        where: { id: attempt.id },
        data: {
          status: attemptStatus,
          exitCode: result.exitCode,
          output: (result.output ?? '').slice(-20000),
          outputHash,
          error: result.error?.slice(0, 5000),
          costUsd: result.costUsd ?? 0,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          endedAt: new Date(),
        },
      }),
      this.prisma.job.update({
        where: { id: job.id },
        data: { activeSeconds: { increment: elapsedSec }, costSpentUsd: { increment: result.costUsd ?? 0 } },
      }),
      this.prisma.step.update({ where: { id: step.id }, data: { lastOutput: (result.output ?? '').slice(-4000) } }),
    ]);
    await L(`Tentativa #${number}: ${attemptStatus} (exit ${result.exitCode}, ${elapsedSec}s${result.costUsd ? `, US$ ${result.costUsd}` : ''})${result.error ? ` — ${result.error.slice(0, 300)}` : ''}`,
      attemptStatus === 'SUCESSO' ? 'INFO' : 'WARN', attempt.id);

    if (attemptStatus === 'INTERROMPIDA') {
      await this.prisma.step.updateMany({ where: { id: step.id, status: 'EXECUTANDO' }, data: { status: 'PENDENTE', statusDetail: 'tentativa interrompida' } });
      await this.checkpoint(job.id, step, worktree, `interrompido na tentativa ${number}`, { tentativa: number, log: logArt.id });
      await this.queue.complete(task.id, workerId);
      // Se o usuário já retomou o job enquanto abortávamos, reagenda.
      await this.orchestrator.scheduleReady(job.id);
      return 'INTERROMPIDO';
    }

    if (attemptStatus === 'RECURSO_INDISPONIVEL') {
      this.registry.invalidate(providerId);
      return this.awaitResource(task, workerId, job, step, result.error ?? 'recurso indisponível');
    }

    if (attemptStatus === 'SUCESSO') {
      const commit = await this.checkpoint(job.id, step, worktree, `etapa ${step.key} concluída (tentativa ${number})`, {
        tentativa: number,
        log: logArt.id,
        artefatos: outputs.map((a) => a.id),
      });
      await this.prisma.step.update({ where: { id: step.id }, data: { status: 'CONCLUIDO', statusDetail: `tentativa ${number}; commit ${commit?.slice(0, 10) ?? '-'}` } });
      await this.queue.complete(task.id, workerId);
      await this.orchestrator.scheduleReady(job.id);
      return 'CONCLUIDO';
    }

    // FALHA: repetição improdutiva?
    const recent = await this.prisma.attempt.findMany({
      where: { stepId: step.id, status: 'FALHA' },
      orderBy: { number: 'desc' },
      take: job.repetitionWindow,
    });
    if (recent.length >= job.repetitionWindow && recent.every((a) => a.outputHash === outputHash)) {
      await this.checkpoint(job.id, step, worktree, `repetição improdutiva na etapa ${step.key}`, { tentativa: number });
      return this.blockJob(task, workerId, job, step, BlockedReason.REPETICAO_IMPRODUTIVA,
        `últimas ${recent.length} tentativas produziram a mesma saída/erro (hash ${outputHash.slice(0, 12)})`);
    }
    if (failures + 1 >= job.maxAttemptsPerStep) {
      await this.checkpoint(job.id, step, worktree, `falha definitiva na etapa ${step.key}`, { tentativa: number });
      return this.failStep(task, workerId, job, step, `limite de ${job.maxAttemptsPerStep} tentativa(s) com falha atingido`);
    }
    await this.prisma.step.update({ where: { id: step.id }, data: { status: 'PENDENTE', statusDetail: `falha na tentativa ${number}; nova tentativa agendada` } });
    const backoff = Math.min(60_000, 1000 * 2 ** (failures));
    await this.queue.requeue(task.id, workerId, new Date(Date.now() + backoff), result.error);
    return 'RETRY';
  }

  private async checkpoint(jobId: string, step: Step, worktree: string, label: string, extra: Record<string, unknown>) {
    const commit = await this.workspace.commitCheckpoint(worktree, `checkpoint: ${label}`).catch(() => null);
    const steps = await this.prisma.step.findMany({ where: { jobId }, select: { key: true, status: true } });
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const seq = (await tx.checkpoint.count({ where: { jobId } })) + 1;
      await tx.checkpoint.create({
        data: {
          jobId,
          stepId: step.id,
          seq,
          label,
          gitCommit: commit,
          state: { etapa: step.key, etapas: Object.fromEntries(steps.map((s) => [s.key, s.status])), ...extra } as Prisma.InputJsonValue,
        },
      });
    });
    return commit;
  }

  private async blockJob(task: ClaimedTask, workerId: string, job: Job, step: Step, reason: string, detail: string): Promise<StepOutcome> {
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.step.update({ where: { id: step.id }, data: { status: 'BLOQUEADO', statusDetail: `${reason}: ${detail}` } });
      await tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'BLOQUEADO', blockedReason: reason, statusDetail: `etapa ${step.key}: ${detail}` },
      });
    });
    await this.logs.log(job.id, `Job BLOQUEADO (${reason}) na etapa ${step.key}: ${detail}`, { stepId: step.id, level: 'ERROR', source: 'worker' });
    await this.queue.complete(task.id, workerId);
    return 'BLOQUEADO';
  }

  private async failStep(task: ClaimedTask, workerId: string, job: Job, step: Step, detail: string): Promise<StepOutcome> {
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.step.update({ where: { id: step.id }, data: { status: 'FALHOU', statusDetail: detail } });
      await tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'FALHOU', blockedReason: BlockedReason.LIMITE_TENTATIVAS, statusDetail: `etapa ${step.key}: ${detail}` },
      });
    });
    await this.logs.log(job.id, `Job FALHOU na etapa ${step.key}: ${detail}`, { stepId: step.id, level: 'ERROR', source: 'worker' });
    await this.queue.complete(task.id, workerId);
    return 'FALHOU';
  }

  private async awaitApproval(task: ClaimedTask, workerId: string, job: Job, step: Step, reasons: string[]): Promise<StepOutcome> {
    const pending = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'PENDENTE' } });
    if (!pending) {
      await this.prisma.approval.create({
        data: {
          jobId: job.id,
          projectId: job.projectId,
          kind: 'ACAO_DESTRUTIVA',
          subjectId: step.id,
          description: `Etapa "${step.key}" contém ação potencialmente destrutiva: ${reasons.join('; ') || 'marcada como requer aprovação'}`,
        },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.step.update({ where: { id: step.id }, data: { status: 'AGUARDANDO_APROVACAO', statusDetail: 'ação destrutiva requer aprovação' } });
      await tx.job.updateMany({ where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } }, data: { status: 'AGUARDANDO_APROVACAO', statusDetail: `etapa ${step.key} aguarda aprovação` } });
    });
    await this.logs.log(job.id, `Etapa ${step.key} aguardando aprovação explícita (ação destrutiva)`, { stepId: step.id, level: 'WARN', source: 'worker' });
    await this.queue.complete(task.id, workerId);
    return 'AGUARDANDO_APROVACAO';
  }

  private async awaitResource(task: ClaimedTask, workerId: string, job: Job, step: Step, detail: string): Promise<StepOutcome> {
    const waits = await this.prisma.attempt.count({ where: { stepId: step.id, status: 'RECURSO_INDISPONIVEL' } });
    const delay = RESOURCE_BACKOFF_MS[Math.min(task.claims - 1, RESOURCE_BACKOFF_MS.length - 1)] ?? 60_000;
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.step.update({ where: { id: step.id }, data: { status: 'AGUARDANDO_RECURSO', statusDetail: detail.slice(0, 1000) } });
      await tx.job.updateMany({ where: { id: job.id, status: 'EXECUTANDO' }, data: { status: 'AGUARDANDO_RECURSO', statusDetail: `etapa ${step.key}: ${detail}`.slice(0, 2000) } });
    });
    await this.logs.log(job.id, `Aguardando recurso (${detail}). Nova verificação em ${Math.round(delay / 1000)}s. Esperas anteriores: ${waits}`, {
      stepId: step.id,
      level: 'WARN',
      source: 'worker',
    });
    await this.queue.requeue(task.id, workerId, new Date(Date.now() + delay), detail);
    return 'AGUARDANDO_RECURSO';
  }

  /** Contexto reconstruído do banco (não de resumos de conversa). */
  async buildContext(job: Job, step: Step): Promise<string> {
    const [objective, criteria, steps, checkpoint, memory, attempts] = await Promise.all([
      this.prisma.jobObjectiveVersion.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' } }),
      this.prisma.acceptanceCriterion.findMany({ where: { jobId: job.id } }),
      this.prisma.step.findMany({ where: { jobId: job.id }, orderBy: { order: 'asc' } }),
      this.prisma.checkpoint.findFirst({ where: { jobId: job.id }, orderBy: { seq: 'desc' } }),
      this.prisma.memoryEntry.findMany({
        where: {
          projectId: job.projectId,
          supersededById: null,
          category: { in: ['ESPECIFICACAO', 'ARQUITETURA_RESTRICOES', 'DECISAO_APROVADA', 'HIPOTESE_REJEITADA', 'PENDENCIA'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.prisma.attempt.findMany({ where: { stepId: step.id }, orderBy: { number: 'desc' }, take: 3 }),
    ]);
    const lines: string[] = [];
    lines.push('# Nivoo AI Manager — contexto da execução', '', '## Regras invioláveis', ...AGENT_RULES.map((r) => `- ${r}`));
    lines.push('', `## Objetivo (v${objective?.version}, sha256 ${objective?.sha256.slice(0, 12)})`, objective?.text ?? '');
    lines.push('', '## Critérios de aceitação (verificados pelo backend)', ...criteria.map((c) => `- [${c.status}] ${c.key} (${c.kind}): ${c.description}`));
    lines.push('', '## Etapas', ...steps.map((s) => `- [${s.status}] ${s.key}: ${s.title}${s.id === step.id ? '  <== ETAPA ATUAL' : ''}`));
    if (checkpoint) lines.push('', `## Último checkpoint #${checkpoint.seq} (${checkpoint.label}; commit ${checkpoint.gitCommit ?? '-'})`, JSON.stringify(checkpoint.state));
    if (memory.length) lines.push('', '## Memória do projeto (decisões, restrições, hipóteses rejeitadas, pendências)', ...memory.map((m) => `- [${m.category}] ${m.title}: ${m.content.slice(0, 800)}`));
    if (attempts.length) {
      lines.push('', '## Tentativas anteriores desta etapa (não repita abordagens que falharam)');
      for (const a of attempts) lines.push(`- #${a.number} ${a.status} via ${a.provider}: ${(a.error ?? '').slice(0, 300)} | saída: ${(a.output ?? '').slice(-300)}`);
    }
    lines.push('', `Diretório de saída para evidências: ${'$'}NIVOO_OUTPUT_DIR (out/). Dados do projeto: ${'$'}NIVOO_DATA_DIR.`);
    return lines.join('\n');
  }
}
