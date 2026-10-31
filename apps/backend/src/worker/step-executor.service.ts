import { Injectable, Logger } from '@nestjs/common';
import { Job, Prisma, Step } from '@prisma/client';
import * as path from 'node:path';
import { appConfig } from '../config';
import { normalizedOutputHash } from '../common/hash';
import { killProcessGroup, minimalEnv, runProcess } from '../common/exec';
import * as os from 'node:os';
import { BlockedReason } from '../common/status';
import { LogService } from '../jobs/log.service';
import { OrchestratorService } from '../jobs/orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { buildPrompt, ExecutionResult } from '../providers/provider.interface';
import * as fs from 'node:fs';
import { sha256, sha256File } from '../common/hash';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { AGENT_RULES, evaluatePolicy } from '../security/policy';
import { resolveInside } from '../common/path-guard';
import { assembleContext, ContextSection, ContextStats, fullMemoryDocument } from './context-builder';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';

/** Conteúdo exato de uma etapa que uma aprovação cobre. */
export function stepHash(step: Pick<Step, 'instructions' | 'verifyCommand' | 'provider'>): string {
  return sha256(JSON.stringify([step.instructions, step.verifyCommand ?? null, step.provider ?? null]));
}

const RESOURCE_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

export type StepOutcome = 'CONCLUIDO' | 'CONTINUA' | 'RETRY' | 'FALHOU' | 'BLOQUEADO' | 'INTERROMPIDO' | 'AGUARDANDO_RECURSO' | 'AGUARDANDO_APROVACAO' | 'IGNORADO';

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
    const orphanRows = await this.prisma.attempt.findMany({ where: { stepId: step.id, status: 'EXECUTANDO' } });
    for (const o of orphanRows) {
      if (o.pid && o.hostname === os.hostname() && killProcessGroup(o.pid)) {
        await L(`Processo órfão (pgid ${o.pid}) da tentativa #${o.number} encerrado`, 'WARN');
      }
    }
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
    if (job.project.maxCostUsd !== null) {
      const agg = await this.prisma.job.aggregate({ where: { projectId: job.projectId }, _sum: { costSpentUsd: true } });
      const spent = new Prisma.Decimal(agg._sum.costSpentUsd ?? 0);
      if (spent.gte(job.project.maxCostUsd)) {
        return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_ORCAMENTO_PROJETO, `custo do projeto US$ ${spent} ≥ orçamento do projeto US$ ${job.project.maxCostUsd}`);
      }
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
      // A aprovação vale só para o conteúdo exato que foi aprovado (hash das instruções + verificação).
      const approved = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'APROVADO', subjectHash: stepHash(step) } });
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

    const isAi = provider.kind !== 'executor';
    const prep = await this.prepareExperimentData(job.id, worktree);
    if (prep) {
      return this.blockJob(task, workerId, job, step, BlockedReason.POLITICA, prep);
    }
    if (isAi) {
      const planted = this.workspace.sanitizeHarnessFiles(worktree);
      if (planted.length) await L(`Arquivos de harness removidos antes da sessão (não fazem parte do trabalho): ${planted.join(', ')}`, 'WARN');
    }
    const treeBefore = await this.workspace.snapshotHash(worktree);
    // Defesa em profundidade: o diretório de dados do projeto não pode ser alterado pelo agente.
    const protectedBefore = isAi ? this.workspace.dirFingerprint(dataDir, ['verificador.py']) : null;

    const number = (await this.prisma.attempt.count({ where: { stepId: step.id } })) + 1;
    const attempt = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.job.updateMany({ where: { id: job.id, status: 'AGUARDANDO_RECURSO' }, data: { status: 'EXECUTANDO', statusDetail: null } });
      await tx.step.update({ where: { id: step.id }, data: { status: 'EXECUTANDO', statusDetail: null, attemptCount: number } });
      return tx.attempt.create({ data: { jobId: job.id, stepId: step.id, number, provider: providerId, workerId, hostname: os.hostname(), treeBefore } });
    });
    await L(`Tentativa #${number} da etapa "${step.key}" com ${providerId}${isAi ? ' (nova sessão de IA)' : ''}`, 'INFO', attempt.id);

    const { text: context, stats: contextStats } = await this.buildContext(job, step, isAi ? worktree : undefined);
    // O prompt exato de cada sessão é guardado: prova do contexto recebido (objetivo, notas, evidências).
    const promptArt = await this.artifacts.storeContent(
      { projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id, name: `prompts/${step.key}/tentativa-${number}.md`, kind: 'PROMPT' },
      isAi ? buildPrompt({ context, instructions: step.instructions } as any) : step.instructions,
    );
    await this.prisma.attempt.update({ where: { id: attempt.id }, data: { promptArtifactId: promptArt.id, contextStats: contextStats as unknown as Prisma.InputJsonValue } });
    if (contextStats.memoryOmitted || contextStats.overBudget) {
      await L(`Orçamento de contexto: ${contextStats.totalChars}/${contextStats.budgetChars} caracteres; ${contextStats.memoryOmitted} entrada(s) de memória omitidas do prompt (íntegras em .nivoo/memoria.md)`, 'INFO', attempt.id);
    }
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
        options: (step.providerOptions ?? {}) as { model?: string; maxTurns?: number },
        onSpawn: (pid) => {
          logChain = logChain.then(() => this.prisma.attempt.update({ where: { id: attempt.id }, data: { pid } }).then(() => undefined).catch(() => undefined));
        },
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

    // O agente terminou a sessão normalmente (ou por limite de turnos)? Guardado antes da verificação.
    const sessionClosedNormally = !result.interrupted && !result.resourceUnavailable && (result.exitCode === 0 || !!result.sessionEnded);
    // Verificação determinística da etapa (não decide conclusão do job).
    let verified = !step.verifyCommand;
    if (result.exitCode === 0 && !result.interrupted && step.verifyCommand) {
      const v = await runProcess('bash', ['-e', '-o', 'pipefail', '-c', step.verifyCommand], {
        cwd: worktree,
        env: minimalEnv({ NIVOO_JOB_ID: job.id, NIVOO_OUTPUT_DIR: outputDir, NIVOO_DATA_DIR: dataDir }),
        timeoutMs: 120_000,
        signal,
      });
      const vOut = `${v.stdout}${v.stderr}`.trim().slice(-800);
      await L(`Verificação da etapa: exit ${v.exitCode}${vOut ? ` — ${vOut}` : ''}`, v.exitCode === 0 ? 'INFO' : 'WARN', attempt.id);
      verified = v.exitCode === 0;
      if (v.aborted) result = { ...result, interrupted: true };
      else if (v.exitCode !== 0) {
        result = { ...result, exitCode: result.sessionEnded ? 0 : v.exitCode ?? 1, error: `verificação da etapa falhou (exit ${v.exitCode}): ${vOut}` };
      }
    }
    const elapsedSec = Math.ceil((Date.now() - started) / 1000);

    // Artefatos: saída da tentativa + arquivos novos em out/.
    const logArt = await this.artifacts.storeContent(
      { projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id, name: `logs/${step.key}/tentativa-${number}.log`, kind: 'LOG' },
      `${result.output}\n${result.error ? `\n[erro] ${result.error}\n` : ''}`,
    );
    const outputs = await this.artifacts.collectOutputs({ projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id }, outputDir);
    if (outputs.length) await L(`Artefatos registrados: ${outputs.map((a) => `${a.name} (sha256 ${a.sha256.slice(0, 12)})`).join(', ')}`, 'INFO', attempt.id);

    if (protectedBefore !== null) {
      const protectedAfter = this.workspace.dirFingerprint(dataDir, ['verificador.py']);
      if (protectedAfter !== protectedBefore) {
        await this.prisma.attempt.update({ where: { id: attempt.id }, data: { status: 'FALHA', error: 'violação de isolamento: diretório de dados alterado', endedAt: new Date() } });
        await L('VIOLAÇÃO DE ISOLAMENTO: a sessão alterou o diretório de dados do projeto (fora do workspace). Job bloqueado.', 'ERROR', attempt.id);
        return this.blockJob(task, workerId, job, step, BlockedReason.POLITICA, 'agente alterou arquivos fora do workspace (diretório de dados do projeto)');
      }
    }
    if (isAi) {
      const planted = this.workspace.sanitizeHarnessFiles(worktree);
      if (planted.length) {
        await L(`A sessão criou arquivos de harness (hooks/instruções ocultas); removidos: ${planted.join(', ')}`, 'WARN', attempt.id);
      }
    }
    const notes = await this.ingestNotes(job, step, attempt.id, worktree, providerId, result.sessionId, outputs);
    const treeAfter = await this.workspace.snapshotHash(worktree);

    // Classificação: interrupção, limite do provedor, sucesso verificado, fim de sessão sem concluir, falha.
    const attemptStatus = result.interrupted
      ? 'INTERROMPIDA'
      : result.resourceUnavailable
        ? 'RECURSO_INDISPONIVEL'
        : result.exitCode === 0 && verified
          ? 'SUCESSO'
          : isAi && sessionClosedNormally
            ? 'SESSAO_ENCERRADA'
            : 'FALHA';
    if (attemptStatus === 'SESSAO_ENCERRADA' && !result.error) {
      result = { ...result, error: `sessão encerrada (${result.stopReason ?? 'sem motivo'}) sem concluir a etapa` };
    }
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
          sessionId: result.sessionId,
          stopReason: result.stopReason,
          numTurns: result.numTurns,
          treeAfter,
          notesIngested: notes,
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
      // Checkpoint primeiro: a etapa só volta a ser retomável depois que o estado está salvo.
      await this.checkpoint(job.id, step, worktree, `interrompido na tentativa ${number}`, { tentativa: number, log: logArt.id });
      await this.prisma.step.updateMany({ where: { id: step.id, status: 'EXECUTANDO' }, data: { status: 'PENDENTE', statusDetail: 'tentativa interrompida' } });
      await this.queue.complete(task.id, workerId);
      // Se o usuário já retomou o job enquanto abortávamos, reagenda.
      await this.orchestrator.scheduleReady(job.id);
      return 'INTERROMPIDO';
    }

    if (attemptStatus === 'RECURSO_INDISPONIVEL') {
      this.registry.invalidate(providerId);
      return this.awaitResource(task, workerId, job, step, result.error ?? 'recurso indisponível');
    }

    if (attemptStatus === 'SESSAO_ENCERRADA') {
      return this.continueInNewSession(task, workerId, job, step, worktree, number, treeBefore, treeAfter, notes);
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

  /**
   * Sessão terminou sem concluir a etapa: continua automaticamente em NOVA sessão (sem comando manual),
   * com o contexto reconstruído do banco. Limites: sessões por etapa, tempo, orçamento e falta de progresso.
   */
  private async continueInNewSession(
    task: ClaimedTask, workerId: string, job: Job, step: Step, worktree: string, number: number,
    treeBefore: string, treeAfter: string, notes: number,
  ): Promise<StepOutcome> {
    await this.checkpoint(job.id, step, worktree, `sessão ${number} encerrada sem concluir ${step.key}`, {
      tentativa: number, progresso: treeBefore !== treeAfter, notas: notes,
    });
    const sessions = await this.prisma.attempt.findMany({
      where: { stepId: step.id, status: 'SESSAO_ENCERRADA' },
      orderBy: { number: 'desc' },
    });
    const recent = sessions.slice(0, job.repetitionWindow);
    if (recent.length >= job.repetitionWindow && recent.every((a) => a.treeBefore === a.treeAfter)) {
      return this.blockJob(task, workerId, job, step, BlockedReason.REPETICAO_IMPRODUTIVA,
        `últimas ${recent.length} sessões terminaram sem nenhuma alteração no trabalho (notas não contam como progresso)`);
    }
    if (sessions.length >= job.maxSessionsPerStep) {
      return this.failStep(task, workerId, job, step, `limite de ${job.maxSessionsPerStep} sessões sem concluir a etapa`, BlockedReason.LIMITE_SESSOES);
    }
    await this.prisma.step.update({
      where: { id: step.id },
      data: { status: 'PENDENTE', statusDetail: `sessão ${number} encerrada sem concluir; continuação automática agendada` },
    });
    await this.logs.log(job.id, `Continuação automática: nova sessão para "${step.key}" (${sessions.length}/${job.maxSessionsPerStep} sessões usadas)`, {
      stepId: step.id, source: 'worker',
    });
    await this.queue.requeue(task.id, workerId, new Date(), 'continuação em nova sessão');
    return 'CONTINUA';
  }

  /**
   * Lição de falha (versão determinística e auditável do "aprendizado contínuo"): o que foi tentado e
   * por que não funcionou fica na memória DO PROJETO, com referência às tentativas, e entra com alta
   * prioridade no contexto de sessões futuras do mesmo projeto — nunca de outros projetos.
   */
  private async recordLesson(job: Job, step: Step, reason: string, detail: string): Promise<void> {
    const teaches: string[] = [BlockedReason.REPETICAO_IMPRODUTIVA, BlockedReason.LIMITE_TENTATIVAS, BlockedReason.LIMITE_SESSOES, BlockedReason.POLITICA];
    if (!teaches.includes(reason)) return; // limites de tempo/orçamento e interrupções não dizem nada sobre a abordagem
    const recent = await this.prisma.attempt.findMany({ where: { stepId: step.id }, orderBy: { number: 'desc' }, take: 3 });
    const tried = recent
      .reverse()
      .map((a) => `#${a.number} ${a.status}${a.stopReason ? ` (${a.stopReason})` : ''}: ${(a.error ?? '').slice(0, 300)}${a.output ? ` — saída: ${a.output.trim().slice(-200)}` : ''}`)
      .join(' | ');
    await this.prisma.memoryEntry.create({
      data: {
        projectId: job.projectId,
        researchId: job.researchId,
        category: 'PENDENCIA',
        title: `Lição: etapa "${step.key}" (${job.title}) — ${reason}`,
        content: `Abordagem sem sucesso. Instruções da etapa: ${step.instructions.slice(0, 400)}. Motivo: ${detail}. Tentativas: ${tried || 'nenhuma'}. Não repita esta abordagem sem mudar algo essencial.`,
        references: { origem: 'licao-automatica', jobId: job.id, stepId: step.id, motivo: reason, attemptIds: recent.map((a) => a.id) },
        author: 'sistema:licoes',
      },
    }).catch(() => undefined);
  }

  /** Copia o dataset do experimento para dados/ no worktree, verificando o sha256 registrado. */
  private async prepareExperimentData(jobId: string, worktree: string): Promise<string | null> {
    const exp = await this.prisma.experiment.findUnique({ where: { jobId }, include: { dataset: { include: { project: true } } } });
    const ds = exp?.dataset;
    if (!ds) return null;
    const src = resolveInside(this.workspace.projectDirs(ds.project.slug).data, ds.uri);
    if (!fs.existsSync(src)) return `arquivo do dataset ${ds.uri} não existe`;
    const hash = await sha256File(src);
    if (ds.sha256 && hash !== ds.sha256) return `dataset ${ds.name} alterado (sha256 ${hash.slice(0, 12)} ≠ registrado ${ds.sha256.slice(0, 12)})`;
    const dest = path.join(worktree, 'dados', path.basename(ds.uri));
    if (!fs.existsSync(dest) || (await sha256File(dest)) !== hash) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return null;
  }

  /**
   * Notas estruturadas deixadas pelo agente em .nivoo/notas.jsonl (uma por linha):
   * {"tipo": "HIPOTESE|DECISAO_PROPOSTA|EVIDENCIA|PENDENCIA|PROGRESSO", "titulo": "...", "conteudo": "...", "arquivos": ["out/x"]}
   * São versionadas no git do job e importadas para a memória do projeto. Decisões do agente
   * entram como PENDENCIA (proposta) — só o operador aprova decisões.
   */
  private async ingestNotes(job: Job, step: Step, attemptId: string, worktree: string, providerId: string, sessionId: string | undefined, outputs: { id: string; name: string }[]): Promise<number> {
    const file = path.join(worktree, '.nivoo', 'notas.jsonl');
    if (!fs.existsSync(file)) return 0;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    // Deduplicação por hash do conteúdo: robusta mesmo se o agente reescrever o arquivo inteiro.
    const known = await this.prisma.memoryEntry.findMany({
      where: { projectId: job.projectId, references: { path: ['jobId'], equals: job.id } },
      select: { references: true },
    });
    const seen = new Set(known.map((k) => (k.references as any)?.noteHash).filter(Boolean));
    const fresh = lines.filter((l) => !seen.has(sha256(l.trim())));
    const commit = await this.workspace.headCommit(worktree);
    const author = `agente:${providerId}:sessao:${sessionId ?? attemptId}`;
    let count = 0;
    for (const line of fresh) {
      count++;
      let n: any;
      try {
        n = JSON.parse(line);
      } catch {
        await this.logs.log(job.id, `Nota inválida ignorada (não é JSON): ${line.slice(0, 200)}`, { stepId: step.id, level: 'WARN', source: 'worker' });
        await this.prisma.memoryEntry.create({
          data: { projectId: job.projectId, researchId: job.researchId, category: 'PENDENCIA', title: 'nota inválida do agente', content: line.slice(0, 2000), references: { jobId: job.id, attemptId, noteHash: sha256(line.trim()), origem: 'notas-do-agente' }, author },
        });
        continue;
      }
      const tipo = String(n.tipo ?? '').toUpperCase();
      const titulo = String(n.titulo ?? tipo).slice(0, 200);
      const conteudo = String(n.conteudo ?? '').slice(0, 20000);
      const refsBase = { jobId: job.id, attemptId, sessionId: sessionId ?? null, origem: 'notas-do-agente', noteHash: sha256(line.trim()) };
      let category: 'HIPOTESE_INVESTIGACAO' | 'EVIDENCIA' | 'PENDENCIA' = 'PENDENCIA';
      let references: Record<string, unknown> = refsBase;
      if (tipo === 'HIPOTESE') category = 'HIPOTESE_INVESTIGACAO';
      if (tipo === 'EVIDENCIA') {
        const wanted: string[] = Array.isArray(n.arquivos) ? n.arquivos.map((a: string) => String(a).replace(/^out\//, '')) : [];
        const arts = await this.prisma.artifact.findMany({ where: { jobId: job.id, name: { in: wanted } }, orderBy: { createdAt: 'desc' } });
        if (arts.length && commit) {
          category = 'EVIDENCIA';
          references = { ...refsBase, artifactIds: arts.map((a) => a.id), gitCommit: commit, parameters: {} };
        }
      }
      const prefix = tipo === 'DECISAO_PROPOSTA' ? '[decisão proposta pelo agente — requer aprovação] ' : tipo === 'PROGRESSO' ? '[progresso] ' : tipo === 'EVIDENCIA' && category !== 'EVIDENCIA' ? '[evidência sem artefato verificável] ' : '';
      await this.prisma.memoryEntry.create({
        data: { projectId: job.projectId, researchId: job.researchId, category, title: titulo, content: prefix + conteudo, references: references as Prisma.InputJsonValue, author },
      });
    }
    if (count) await this.logs.log(job.id, `${count} nota(s) do agente importada(s) para a memória do projeto`, { stepId: step.id, source: 'worker' });
    void outputs;
    return count;
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
    await this.recordLesson(job, step, reason, detail);
    await this.queue.complete(task.id, workerId);
    return 'BLOQUEADO';
  }

  private async failStep(task: ClaimedTask, workerId: string, job: Job, step: Step, detail: string, reason: string = BlockedReason.LIMITE_TENTATIVAS): Promise<StepOutcome> {
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.step.update({ where: { id: step.id }, data: { status: 'FALHOU', statusDetail: detail } });
      await tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'FALHOU', blockedReason: reason, statusDetail: `etapa ${step.key}: ${detail}` },
      });
    });
    await this.logs.log(job.id, `Job FALHOU na etapa ${step.key}: ${detail}`, { stepId: step.id, level: 'ERROR', source: 'worker' });
    await this.recordLesson(job, step, reason, detail);
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
          subjectHash: stepHash(step),
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

  /**
   * Contexto reconstruído do banco, do git e dos artefatos — não de resumos de conversa.
   * Montado com orçamento (NIVOO_CONTEXT_MAX_CHARS): seções obrigatórias sempre entram; memória e
   * artefatos entram por prioridade; o restante fica íntegro em .nivoo/memoria.md (leitura sob demanda).
   */
  async buildContext(job: Job, step: Step, worktree?: string): Promise<{ text: string; stats: ContextStats }> {
    const [objective, criteria, steps, checkpoint, memory, attempts, artifacts, experiment] = await Promise.all([
      this.prisma.jobObjectiveVersion.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' } }),
      this.prisma.acceptanceCriterion.findMany({ where: { jobId: job.id } }),
      this.prisma.step.findMany({ where: { jobId: job.id }, orderBy: { order: 'asc' } }),
      this.prisma.checkpoint.findFirst({ where: { jobId: job.id }, orderBy: { seq: 'desc' } }),
      this.prisma.memoryEntry.findMany({
        where: { projectId: job.projectId, supersededById: null, ...(job.researchId ? { OR: [{ researchId: job.researchId }, { researchId: null }] } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.attempt.findMany({ where: { stepId: step.id }, orderBy: { number: 'desc' }, take: 5 }),
      this.prisma.artifact.findMany({ where: { jobId: job.id, kind: { in: ['FILE', 'METRICS', 'REPORT'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.experiment.findUnique({ where: { jobId: job.id }, include: { dataset: { include: { asset: true } }, hypothesis: true } }),
    ]);
    const sessionNo = attempts.length + 1;
    const sections: ContextSection[] = [];
    const add = (key: string, lines: string[], required = true) => sections.push({ key, text: lines.join('\n'), required });
    add('regras', ['# Nivoo AI Manager — contexto da execução', '', '## Regras invioláveis', ...AGENT_RULES.map((r) => `- ${r}`)]);
    add('objetivo', [`## Objetivo original (v${objective?.version}, sha256 ${objective?.sha256})`, objective?.text ?? '']);
    add('criterios', ['## Critérios de aceitação do job (verificados pelo backend, não por você)', ...criteria.map((c) => `- [${c.status}] ${c.key} (${c.kind}): ${c.description}`)]);
    add('etapas', ['## Etapas', ...steps.map((s) => `- [${s.status}] ${s.key}: ${s.title}${s.id === step.id ? '  <== ETAPA ATUAL' : ''}`)]);
    if (step.verifyCommand) add('verificacao', ['## Verificação desta etapa (executada pelo backend ao fim da sessão)', '```', step.verifyCommand, '```']);
    if (experiment) {
      const lines = ['## Experimento', `- nome: ${experiment.name}; parâmetros: ${JSON.stringify(experiment.parameters)}`];
      if (experiment.hypothesis) lines.push(`- hipótese: ${experiment.hypothesis.statement}`, `- regra de decisão pré-registrada: ${JSON.stringify(experiment.hypothesis.decisionRule)}`);
      if (experiment.dataset) lines.push(`- dados: dados/${path.basename(experiment.dataset.uri)} (ativo ${experiment.dataset.asset.code}, papel ${experiment.dataset.role}, sha256 ${experiment.dataset.sha256}). ${experiment.dataset.notes}`);
      add('experimento', lines);
    }
    const history = [`## Sessões desta etapa: esta é a sessão ${sessionNo}`];
    if (attempts.length) {
      history.push('As sessões anteriores terminaram sem concluir a etapa. Continue de onde pararam; NÃO recomece do zero e não repita abordagens que falharam.');
      for (const a of [...attempts].reverse()) history.push(`- sessão ${a.number}: ${a.status} (término: ${a.stopReason ?? '-'}) ${(a.error ?? '').slice(0, 400)}`);
    }
    add('historico', history);
    add('protocolo', [
      '## Como registrar progresso (obrigatório antes de terminar a sessão)',
      'Acrescente linhas JSON (uma por linha) em `.nivoo/notas.jsonl` no diretório atual, por exemplo:',
      '{"tipo": "PROGRESSO", "titulo": "...", "conteudo": "o que foi feito e o que falta"}',
      'Tipos: HIPOTESE, DECISAO_PROPOSTA, EVIDENCIA (com "arquivos": ["out/..."]), PENDENCIA, PROGRESSO.',
      'Nunca apague ou reescreva linhas existentes desse arquivo. A memória completa do projeto está em `.nivoo/memoria.md`.',
      '',
      `Resultados e evidências: grave em out/ (${'$'}NIVOO_OUTPUT_DIR). Você não decide se o trabalho terminou.`,
    ]);
    if (checkpoint) {
      add('checkpoint', [`## Último checkpoint #${checkpoint.seq} (${checkpoint.label}; commit ${checkpoint.gitCommit ?? '-'})`, JSON.stringify(checkpoint.state).slice(0, 4000)], false);
    }
    const artLines = artifacts.map((a) => `- ${a.name} (sha256 ${a.sha256.slice(0, 12)}, ${a.sizeBytes} B)`);
    const budget = Number(process.env.NIVOO_CONTEXT_MAX_CHARS ?? 60000);
    const result = assembleContext(sections, memory, artLines, budget);
    if (worktree) {
      fs.mkdirSync(path.join(worktree, '.nivoo'), { recursive: true });
      fs.writeFileSync(path.join(worktree, '.nivoo', 'memoria.md'), fullMemoryDocument(memory, artLines));
    }
    return result;
  }
}
