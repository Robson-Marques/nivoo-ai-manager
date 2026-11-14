import { copiarAnexosParaSessao } from '../conversations/attachments';
import { trocarParaReserva } from '../projects/mover-trabalho';
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
import { sha256 } from '../common/hash';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { AGENT_RULES, evaluatePolicy } from '../security/policy';
import { assembleContext, ContextSection, ContextStats, fullMemoryDocument } from './context-builder';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';
import { ProjectProfileService } from '../projects/project-profile.service';
import { RULE_REVIEW_STEP } from '../jobs/rule-review';

/** Modelo escolhido para a IA no projeto (undefined = padrão da IA). */
export function projectModel(project: { aiModels: unknown }, providerId: string): string | undefined {
  const m = ((project.aiModels ?? {}) as Record<string, string>)[providerId];
  return m || undefined;
}

/** Conteúdo exato de uma etapa que uma aprovação cobre. */
export function stepHash(step: Pick<Step, 'instructions' | 'verifyCommand' | 'provider'>): string {
  return sha256(JSON.stringify([step.instructions, step.verifyCommand ?? null, step.provider ?? null]));
}

const RESOURCE_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

export type StepOutcome = 'CONCLUIDO' | 'CONTINUA' | 'RETRY' | 'FALHOU' | 'BLOQUEADO' | 'INTERROMPIDO' | 'AGUARDANDO_RECURSO' | 'AGUARDANDO_APROVACAO' | 'IGNORADO';

const MOTIVO_LICAO: Record<string, string> = {
  REPETICAO_IMPRODUTIVA: 'a IA ficou repetindo sem avançar',
  LIMITE_TENTATIVAS: 'esgotou as tentativas',
  LIMITE_SESSOES: 'esgotou as sessões',
  POLITICA: 'bloqueado por segurança',
};

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
    private readonly profiles: ProjectProfileService,
  ) {}

  /**
   * Executa uma tarefa RUN_STEP. `signal` é abortado quando o lease é perdido
   * (interrupção pelo usuário ou outro worker assumiu).
   */
  async run(task: ClaimedTask, workerId: string, signal: AbortSignal): Promise<StepOutcome> {
    const step = await this.prisma.step.findUnique({ where: { id: task.stepId! } });
    const job = step ? await this.prisma.job.findUnique({ where: { id: step.jobId }, include: { project: { include: { area: true } } } }) : null;
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
    if (job.maxDurationSec > 0 && job.activeSeconds >= job.maxDurationSec) {
      return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_TEMPO, `tempo ativo ${job.activeSeconds}s ≥ limite ${job.maxDurationSec}s`);
    }
    if (new Prisma.Decimal(job.costSpentUsd).gte(job.maxCostUsd)) {
      return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_ORCAMENTO, `custo US$ ${job.costSpentUsd} ≥ orçamento US$ ${job.maxCostUsd}`);
    }
    if (job.project.maxCostUsd !== null) {
      const agg = await this.prisma.job.aggregate({ where: { projectId: job.projectId }, _sum: { costSpentUsd: true } });
      const conversa = await this.prisma.conversationMessage.aggregate({ where: { conversation: { projectId: job.projectId } }, _sum: { costUsd: true } });
      const spent = new Prisma.Decimal(agg._sum.costSpentUsd ?? 0).add(conversa._sum.costUsd ?? 0);
      if (spent.gte(job.project.maxCostUsd)) {
        return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_ORCAMENTO_PROJETO, `custo do projeto US$ ${spent} ≥ orçamento do projeto US$ ${job.project.maxCostUsd}`);
      }
    }
    const failures = await this.prisma.attempt.count({ where: { stepId: step.id, status: 'FALHA', number: { gt: step.resumeFromAttempt } } });
    if (failures >= job.maxAttemptsPerStep) {
      return this.failStep(task, workerId, job, step, `limite de ${job.maxAttemptsPerStep} tentativa(s) com falha atingido`);
    }

    // Política: ações destrutivas só com aprovação do usuário.
    const pol = evaluatePolicy(`${step.instructions}\n${step.verifyCommand ?? ''}`);
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

    // Etapa paga por uso (vídeo): o custo estimado não pode estourar o limite do trabalho nem o do projeto.
    const estimador = this.registry.get(providerId) as unknown as { estimarCusto?: (o: Record<string, unknown>) => number };
    if (estimador.estimarCusto) {
      const estimado = estimador.estimarCusto({ model: projectModel(job.project, providerId), ...((step.providerOptions ?? {}) as Record<string, unknown>) });
      if (new Prisma.Decimal(job.costSpentUsd).add(estimado).gt(job.maxCostUsd)) {
        return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_ORCAMENTO,
          `esta etapa custaria cerca de US$ ${estimado.toFixed(2)} e passaria o limite do trabalho (US$ ${job.maxCostUsd}; já gasto US$ ${job.costSpentUsd})`);
      }
      if (job.project.maxCostUsd !== null) {
        const agg = await this.prisma.job.aggregate({ where: { projectId: job.projectId }, _sum: { costSpentUsd: true } });
        const conversa = await this.prisma.conversationMessage.aggregate({ where: { conversation: { projectId: job.projectId } }, _sum: { costUsd: true } });
        const gasto = new Prisma.Decimal(agg._sum.costSpentUsd ?? 0).add(conversa._sum.costUsd ?? 0);
        if (gasto.add(estimado).gt(job.project.maxCostUsd)) {
          return this.blockJob(task, workerId, job, step, BlockedReason.LIMITE_ORCAMENTO_PROJETO,
            `esta etapa custaria cerca de US$ ${estimado.toFixed(2)} e passaria o limite do projeto (US$ ${job.project.maxCostUsd}; já gasto US$ ${gasto})`);
        }
      }
    }
    const provider = this.registry.get(providerId);

    // Workspace isolado do job (worktree na branch job/<id>).
    const worktree = await this.workspace.ensureJobWorktree(job.project.dirKey, job.id);
    const knowledgeDir = this.workspace.projectDirs(job.project.dirKey).knowledge;
    const outputDir = path.join(worktree, 'out');

    const isAi = provider.kind !== 'executor';
    // Defesa em profundidade: o conhecimento original do projeto (fora do workspace) não pode ser alterado
    // durante a tentativa. A impressão digital é tirada ANTES de qualquer escrita do próprio worker.
    const protectedBefore = isAi ? this.workspace.dirFingerprint(knowledgeDir) : null;
    let repoHarness: string[] = [];
    if (isAi) {
      // Padrões da base e conhecimento do projeto, renovados a cada sessão (leitura; fora do git).
      const ctx = this.workspace.prepareSessionContext(job.project.area.slug, job.project.dirKey, worktree);
      if (ctx.skipped) await L(`Contexto: ${ctx.skipped} arquivo(s) de referência não copiados por exceder o limite de tamanho`, 'WARN');
      // Anexos da conversa que originou este trabalho (imagens e documentos enviados no chat).
      const origem = await this.prisma.conversationMessage.findFirst({ where: { jobId: job.id }, select: { conversationId: true } });
      if (origem) {
        const comAnexos = await this.prisma.conversationMessage.findMany({
          where: { conversationId: origem.conversationId, role: 'USUARIO', NOT: { attachments: { equals: Prisma.DbNull } } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, conversationId: true, attachments: true },
        });
        const anexos = copiarAnexosParaSessao(this.workspace.projectDirs(job.project.dirKey).root, worktree, comAnexos);
        if (anexos.length) await L(`Anexos da conversa disponíveis para a IA: ${anexos.map((a) => a.caminho).join(', ')}`);
      }
      // Instruções de agente do próprio repositório: cópia legível em contexto/repositorio/, restauradas depois.
      repoHarness = await this.workspace.hideRepoHarness(worktree);
      const planted = this.workspace.sanitizeHarnessFiles(worktree).filter((f) => !repoHarness.includes(f) && !f.startsWith('contexto/'));
      if (planted.length) await L(`Arquivos de harness removidos antes da sessão (não fazem parte do trabalho): ${planted.join(', ')}`, 'WARN');
    }
    const treeBefore = await this.workspace.snapshotHash(worktree);

    const number = (await this.prisma.attempt.count({ where: { stepId: step.id } })) + 1;
    const attempt = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.job.updateMany({ where: { id: job.id, status: 'AGUARDANDO_RECURSO' }, data: { status: 'EXECUTANDO', statusDetail: null } });
      await tx.step.update({ where: { id: step.id }, data: { status: 'EXECUTANDO', statusDetail: null, attemptCount: number } });
      return tx.attempt.create({ data: { jobId: job.id, stepId: step.id, number, provider: providerId, workerId, hostname: os.hostname(), treeBefore } });
    });
    await L(`Tentativa #${number} da etapa "${step.key}" com ${providerId}${isAi ? ' (nova sessão de IA)' : ''}`, 'INFO', attempt.id);

    const profile = await this.profiles.build(job.projectId);
    const { text: context, stats: contextStats } = await this.buildContext(job, step, profile.text, isAi ? worktree : undefined);
    // O prompt exato de cada sessão é guardado: prova do contexto recebido (objetivo, notas, evidências).
    const promptArt = await this.artifacts.storeContent(
      { projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id, name: `prompts/${step.key}/tentativa-${number}.md`, kind: 'PROMPT' },
      isAi ? buildPrompt({ context, instructions: step.instructions }) : step.instructions,
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
        systemPrompt: isAi ? profile.text : undefined,
        timeoutMs,
        signal,
        // Modelo: o da etapa (se definido) ou o escolhido para esta IA no projeto; senão, o padrão da IA.
        options: { model: projectModel(job.project, providerId), ...((step.providerOptions ?? {}) as { model?: string; maxTurns?: number }) },
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
    // Login recusado de verdade (token expirado/revogado) marca a conexão para a tela pedir "Reconecte".
    if (isAi) this.registry.registrarResultado(providerId, result.exitCode === 0 && !result.resourceUnavailable, result.error ?? result.output.slice(-500));

    // O agente terminou a sessão normalmente (ou por limite de turnos)? Guardado antes da verificação.
    const sessionClosedNormally = !result.interrupted && !result.resourceUnavailable && (result.exitCode === 0 || !!result.sessionEnded);
    // Verificação determinística da etapa (não decide conclusão do job).
    let verified = !step.verifyCommand;
    let faltaPrograma: string | null = null;
    if (result.exitCode === 0 && !result.interrupted && step.verifyCommand) {
      const v = await runProcess('bash', ['-e', '-o', 'pipefail', '-c', step.verifyCommand], {
        cwd: worktree,
        env: minimalEnv({ NIVOO_JOB_ID: job.id, NIVOO_OUTPUT_DIR: outputDir }),
        timeoutMs: 120_000,
        signal,
      });
      const vOut = `${v.stdout}${v.stderr}`.trim().slice(-800);
      await L(`Verificação da etapa: exit ${v.exitCode}${vOut ? ` — ${vOut}` : ''}`, v.exitCode === 0 ? 'INFO' : 'WARN', attempt.id);
      verified = v.exitCode === 0;
      // 127 = o comando da conferência não existe no servidor: nenhuma sessão vai resolver isso.
      if (v.exitCode === 127) faltaPrograma = /(\S+): (?:command not found|comando não encontrado)/.exec(vOut)?.[1] ?? 'um programa';
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
      const protectedAfter = this.workspace.dirFingerprint(knowledgeDir);
      if (protectedAfter !== protectedBefore) {
        // O custo e o tempo da sessão contam no orçamento mesmo quando ela é descartada.
        await this.prisma.$transaction([
          this.prisma.attempt.update({
            where: { id: attempt.id },
            data: {
              status: 'FALHA', error: 'violação de isolamento: conhecimento do projeto alterado', endedAt: new Date(),
              costUsd: result.costUsd ?? 0, costEstimated: !!result.costEstimated, sessionId: result.sessionId, stopReason: result.stopReason,
            },
          }),
          this.prisma.job.update({ where: { id: job.id }, data: { activeSeconds: { increment: elapsedSec }, costSpentUsd: { increment: result.costUsd ?? 0 } } }),
        ]);
        await L('VIOLAÇÃO DE ISOLAMENTO: a sessão alterou o conhecimento original do projeto (fora do workspace). Job bloqueado.', 'ERROR', attempt.id);
        return this.blockJob(task, workerId, job, step, BlockedReason.POLITICA, 'agente alterou arquivos fora do workspace (conhecimento do projeto)');
      }
    }
    if (isAi) {
      const planted = this.workspace.sanitizeHarnessFiles(worktree);
      // Os do repositório voltam intactos (a IA não altera nem apaga instruções versionadas do projeto).
      await this.workspace.restoreRepoHarness(worktree, repoHarness).catch(async (e) => L(`Falha ao restaurar instruções do repositório: ${e?.message ?? e}`, 'ERROR', attempt.id));
      const novos = planted.filter((f) => !repoHarness.includes(f));
      if (novos.length) {
        await L(`A sessão criou arquivos de harness (hooks/instruções ocultas); removidos: ${novos.join(', ')}`, 'WARN', attempt.id);
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
          costEstimated: !!result.costEstimated,
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

    if (faltaPrograma && attemptStatus !== 'SUCESSO') {
      await this.checkpoint(job.id, step, worktree, `conferência impossível na etapa ${step.key}`, { tentativa: number });
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `a conferência automática desta etapa usa "${faltaPrograma}", que não existe no servidor; o trabalho feito até aqui está salvo. Peça na conversa para refazer o plano usando só comandos básicos`);
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
      where: { stepId: step.id, status: 'FALHA', number: { gt: step.resumeFromAttempt } },
      orderBy: { number: 'desc' },
      take: job.repetitionWindow,
    });
    if (recent.length >= job.repetitionWindow && recent.every((a) => a.outputHash === outputHash)) {
      await this.checkpoint(job.id, step, worktree, `repetição improdutiva na etapa ${step.key}`, { tentativa: number });
      return this.blockJob(task, workerId, job, step, BlockedReason.REPETICAO_IMPRODUTIVA,
        `as últimas ${recent.length} tentativas terminaram com o mesmo resultado/erro (${(result.error ?? result.output ?? '').trim().slice(-200) || 'sem mensagem'})`);
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
      where: { stepId: step.id, status: 'SESSAO_ENCERRADA', number: { gt: step.resumeFromAttempt } },
      orderBy: { number: 'desc' },
    });
    const recent = sessions.slice(0, job.repetitionWindow);
    // Avanço = arquivo do trabalho alterado OU progresso anotado pela IA (tarefas longas de leitura e análise
    // passam sessões inteiras lendo antes de escrever). O limite de sessões por etapa segura o resto.
    if (recent.length >= job.repetitionWindow && recent.every((a) => a.treeBefore === a.treeAfter && a.notesIngested === 0)) {
      return this.blockJob(task, workerId, job, step, BlockedReason.REPETICAO_IMPRODUTIVA,
        `as últimas ${recent.length} sessões terminaram sem alterar nenhum arquivo e sem anotar progresso`);
    }
    if (job.maxSessionsPerStep > 0 && sessions.length >= job.maxSessionsPerStep) {
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
        category: 'PENDENCIA',
        title: `Lição: "${step.title || step.key}" (${job.title}) — ${MOTIVO_LICAO[reason] ?? reason}`,
        content: `O que aconteceu: ${detail}.\nInstruções da etapa: ${step.instructions.slice(0, 400)}\nTentativas: ${tried || 'nenhuma'}\nNão repita esta abordagem sem mudar algo essencial.`,
        references: { origem: 'licao-automatica', jobId: job.id, stepId: step.id, motivo: reason, attemptIds: recent.map((a) => a.id) },
        author: 'sistema:licoes',
      },
    }).catch(() => undefined);
  }

  /**
   * Notas estruturadas deixadas pelo agente em .nivoo/notas.jsonl (uma por linha):
   * {"tipo": "DECISAO_PROPOSTA|EVIDENCIA|PENDENCIA|PROGRESSO", "titulo": "...", "conteudo": "...", "arquivos": ["out/x"]}
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
          data: { projectId: job.projectId, category: 'PENDENCIA', title: 'nota inválida do agente', content: line.slice(0, 2000), references: { jobId: job.id, attemptId, noteHash: sha256(line.trim()), origem: 'notas-do-agente' }, author },
        });
        continue;
      }
      const tipo = String(n.tipo ?? '').toUpperCase();
      const titulo = String(n.titulo ?? tipo).slice(0, 200);
      const conteudo = String(n.conteudo ?? '').slice(0, 20000);
      const refsBase = { jobId: job.id, attemptId, sessionId: sessionId ?? null, origem: 'notas-do-agente', noteHash: sha256(line.trim()) };
      let category: 'EVIDENCIA' | 'PENDENCIA' = 'PENDENCIA';
      let references: Record<string, unknown> = refsBase;
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
        data: { projectId: job.projectId, category, title: titulo, content: prefix + conteudo, references: references as Prisma.InputJsonValue, author },
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
    // IA reserva: acabou o crédito/limite da IA do projeto → continua sozinho com a próxima conectada.
    const providerId = step.provider ?? job.defaultProvider;
    const reserva = await trocarParaReserva(this.prisma, this.registry, job.projectId, providerId).catch(() => null);
    if (reserva) {
      const aviso = `${reserva.anterior} ficou indisponível (${detail.slice(0, 200)}). O trabalho continua com ${reserva.nome}, do ponto em que estava.`;
      await this.logs.log(job.id, aviso, { stepId: step.id, level: 'WARN', source: 'worker' });
      const origem = await this.prisma.conversationMessage.findFirst({ where: { jobId: job.id }, select: { conversationId: true } });
      if (origem) await this.prisma.conversationMessage.create({ data: { conversationId: origem.conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: aviso, jobId: job.id } });
      await this.prisma.step.update({ where: { id: step.id }, data: { status: 'PENDENTE', statusDetail: `continua com ${reserva.nome}` } });
      await this.queue.requeue(task.id, workerId, new Date(), `continua com ${reserva.id}`);
      return 'CONTINUA';
    }
    const waits = await this.prisma.attempt.count({ where: { stepId: step.id, status: 'RECURSO_INDISPONIVEL' } });
    const delay = RESOURCE_BACKOFF_MS[Math.min(task.resourceWaits, RESOURCE_BACKOFF_MS.length - 1)];
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
    await this.queue.requeue(task.id, workerId, new Date(Date.now() + delay), detail, true);
    return 'AGUARDANDO_RECURSO';
  }

  /**
   * Contexto reconstruído do banco, do git e dos artefatos — não de resumos de conversa.
   * Montado com orçamento (NIVOO_CONTEXT_MAX_CHARS): seções obrigatórias sempre entram; memória e
   * artefatos entram por prioridade; o restante fica íntegro em .nivoo/memoria.md (leitura sob demanda).
   */
  async buildContext(job: Job, step: Step, profileText: string, worktree?: string): Promise<{ text: string; stats: ContextStats }> {
    const [objective, criteria, steps, checkpoint, memory, attempts, artifacts] = await Promise.all([
      this.prisma.jobObjectiveVersion.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' } }),
      this.prisma.acceptanceCriterion.findMany({ where: { jobId: job.id } }),
      this.prisma.step.findMany({ where: { jobId: job.id }, orderBy: { order: 'asc' } }),
      this.prisma.checkpoint.findFirst({ where: { jobId: job.id }, orderBy: { seq: 'desc' } }),
      this.prisma.memoryEntry.findMany({
        where: { projectId: job.projectId, supersededById: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.attempt.findMany({ where: { stepId: step.id }, orderBy: { number: 'desc' }, take: 5 }),
      this.prisma.artifact.findMany({ where: { jobId: job.id, kind: { in: ['FILE', 'METRICS', 'REPORT'] } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const sessionNo = attempts.length + 1;
    const sections: ContextSection[] = [];
    const add = (key: string, lines: string[], required = true) => sections.push({ key, text: lines.join('\n'), required });
    add('regras', ['# Nivoo AI Manager — contexto da execução', '', '## Regras de segurança do sistema (invioláveis)', ...AGENT_RULES.map((r) => `- ${r}`)]);
    // "Fine-tune do projeto": regras da base + regras do projeto + conhecimento. Prende a IA ao projeto.
    add('perfil', [profileText]);
    if (step.key === RULE_REVIEW_STEP && worktree) {
      add('mudancas', ['## Mudanças feitas por este trabalho (comparadas com a pasta principal)', '```diff', await this.workspace.diffAgainstMain(worktree), '```']);
    }
    add('objetivo', [`## Objetivo original (v${objective?.version}, sha256 ${objective?.sha256})`, objective?.text ?? '']);
    add('criterios', ['## Critérios de aceitação do job (verificados pelo backend, não por você)', ...criteria.map((c) => `- [${c.status}] ${c.key} (${c.kind}): ${c.description}`)]);
    add('etapas', ['## Etapas', ...steps.map((s) => `- [${s.status}] ${s.key}: ${s.title}${s.id === step.id ? '  <== ETAPA ATUAL' : ''}`)]);
    if (step.verifyCommand) add('verificacao', ['## Verificação desta etapa (executada pelo backend ao fim da sessão)', '```', step.verifyCommand, '```']);
    const history = [`## Sessões desta etapa: esta é a sessão ${sessionNo}`];
    if (attempts.length) {
      history.push('As sessões anteriores terminaram sem concluir a etapa. Continue de onde pararam; NÃO recomece do zero e não repita abordagens que falharam.');
      for (const a of [...attempts].reverse()) history.push(`- sessão ${a.number}: ${a.status} (término: ${a.stopReason ?? '-'}) ${(a.error ?? '').slice(0, 400)}`);
    }
    add('historico', history);
    add('protocolo', [
      '## Tarefas longas (ler muitos arquivos, auditorias, documentos grandes)',
      `Cada sessão tem tempo limitado (cerca de ${Math.round(job.stepTimeoutSec / 60)} min) e a próxima continua de onde esta parou.`,
      'Crie o arquivo de resultado LOGO NO COMEÇO e vá completando a cada parte analisada (salve com frequência);',
      'não deixe para escrever tudo no fim. Anote o progresso (o que já foi visto e o que falta) nas notas abaixo.',
      '',
      '## Como registrar progresso (obrigatório antes de terminar a sessão)',
      'Acrescente linhas JSON (uma por linha) em `.nivoo/notas.jsonl` no diretório atual, por exemplo:',
      '{"tipo": "PROGRESSO", "titulo": "...", "conteudo": "o que foi feito e o que falta"}',
      'Tipos: DECISAO_PROPOSTA, EVIDENCIA (com "arquivos": ["out/..."]), PENDENCIA, PROGRESSO.',
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
