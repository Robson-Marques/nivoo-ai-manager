import { registrarErro } from '../diagnostico/erros';
import { tipoDe } from '../accounts/connections';
import { ferramentasDaIa } from '../providers/ferramentas';
import { mcpDoProjeto } from '../mcp/mcp';
import { copiarAnexosParaSessao } from '../conversations/attachments';
import { descreverOperacoes } from '../providers/arquivos-projeto.provider';
import { looksLikeResourceProblem } from '../providers/provider.interface';
import { trocarParaReserva } from '../projects/mover-trabalho';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Prisma, Step } from '@prisma/client';
import * as path from 'node:path';
import { appConfig } from '../config';
import { normalizedOutputHash } from '../common/hash';
import { textoDoRepositorio } from '../git/contexto-git';
import { referenciasDaConferencia, variaveisDaConferencia } from '../accounts/secrets';
import { getGitAccount } from '../git/git-accounts';
import { ambienteDaConferencia, killProcessGroup, minimalEnv, portaLivre, faltaCredencial, problemaDoAmbiente, runProcess, semLockfile, TEXTO_FOTOS, TEXTO_PADRAO_DAS_TELAS, TEXTO_ROTEIRO, TEXTO_SISTEMA_RODANDO } from '../common/exec';
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
import { SESSION_CONTEXT_DIR, WorkspaceService } from '../storage/workspace.service';
import { avisarConversaQueParou, jobsDaConversa } from '../conversations/jobs-da-conversa';
import { infoDeVersao, textoDaVersao } from '../git/versao';
import { bancoDeTesteDisponivel, descartarBancoDeTeste, prepararBancoDeTeste, TEXTO_BANCO_DE_TESTE } from '../common/banco-de-teste';
import { escreverArquivosDaMemoria } from '../memory/camadas';
import { ProjectProfileService } from '../projects/project-profile.service';
import { RULE_REVIEW_REPORT, RULE_REVIEW_STEP, RULE_REVIEW_STEP_CHECK } from '../jobs/rule-review';

/** Modelo escolhido para a IA no projeto (undefined = padrão da IA). */
export function projectModel(project: { aiModels: unknown }, providerId: string): string | undefined {
  const m = ((project.aiModels ?? {}) as Record<string, string>)[providerId];
  return m || undefined;
}

/** Conteúdo exato de uma etapa que uma aprovação cobre. */
export function stepHash(step: Pick<Step, 'instructions' | 'verifyCommand' | 'provider'>): string {
  // Trocar de uma IA para outra (IA reserva) não muda o que a etapa faz: a aprovação continua valendo.
  // Trocar para um executor do sistema (comandos, arquivos) muda, e pede aprovação de novo.
  const p = step.provider ?? null;
  const quem = p === null || tipoDe(p) ? 'ia' : p;
  return sha256(JSON.stringify([step.instructions, step.verifyCommand ?? null, quem]));
}

const RESOURCE_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

export type StepOutcome = 'CONCLUIDO' | 'CONTINUA' | 'RETRY' | 'FALHOU' | 'BLOQUEADO' | 'INTERROMPIDO' | 'AGUARDANDO_RECURSO' | 'AGUARDANDO_APROVACAO' | 'IGNORADO';

/** Erros que não são do trabalho da IA: não geram lição. */
export function ehProblemaDeInfra(texto: string): boolean {
  return /command not found|comando não encontrado|exit 127|timeout após \d+ ms|limite de \d+ sess|recusou o login|não está conectada/i.test(texto) || looksLikeResourceProblem(texto);
}

const MOTIVO_LICAO: Record<string, string> = {
  REPETICAO_IMPRODUTIVA: 'a IA ficou repetindo sem avançar',
  LIMITE_TENTATIVAS: 'esgotou as tentativas',
  LIMITE_SESSOES: 'esgotou as sessões',
  POLITICA: 'bloqueado por segurança',
};

/**
 * Conferência que falhou sem mensagem: o comando e, para `test -f/-s/-e/-d <arquivo>` e `grep -q <texto> <arquivo>`,
 * o que de fato falta na pasta do trabalho.
 */
export function explicarConferencia(comando: string, pasta: string): string {
  const faltas: string[] = [];
  for (const m of comando.matchAll(/test\s+(!\s+)?-([fsed])\s+('([^']+)'|"([^"]+)"|(\S+))/g)) {
    const neg = !!m[1];
    const arq = m[4] ?? m[5] ?? m[6];
    const abs = path.resolve(pasta, arq);
    if (!abs.startsWith(path.resolve(pasta))) continue;
    const existe = fs.existsSync(abs);
    if (!neg && !existe) faltas.push(`falta ${arq}`);
    else if (!neg && m[2] === 's' && existe && fs.statSync(abs).size === 0) faltas.push(`${arq} está vazio`);
    else if (neg && existe) faltas.push(`${arq} ainda existe`);
  }
  for (const m of comando.matchAll(/grep\s+(?:-[a-zA-Z]+\s+)*('([^']+)'|"([^"]+)"|(\S+))\s+('([^']+)'|"([^"]+)"|(\S+))/g)) {
    const texto = m[2] ?? m[3] ?? m[4];
    const arq = m[6] ?? m[7] ?? m[8];
    const abs = path.resolve(pasta, arq);
    if (!abs.startsWith(path.resolve(pasta)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (!fs.readFileSync(abs, 'utf8').includes(texto)) faltas.push(`${arq} não contém "${texto}"`);
  }
  return `o comando de conferência falhou sem mensagem: ${comando.slice(0, 300)}${faltas.length ? ` — ${faltas.join('; ')}` : ''}`;
}

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
    // Trava de gasto é opcional: 0 = sem trava neste trabalho (o limite do projeto, se definido, continua valendo).
    const travaDoTrabalho = new Prisma.Decimal(job.maxCostUsd).gt(0);
    if (travaDoTrabalho && new Prisma.Decimal(job.costSpentUsd).gte(job.maxCostUsd)) {
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
    // Só o que roda como comando: instrução de IA é texto ("não use rm -rf" não é ação destrutiva).
    const pol = evaluatePolicy(`${(step.provider ?? job.defaultProvider) === "local-shell" ? step.instructions : ""}\n${step.verifyCommand ?? ''}`);
    if (step.requiresApproval || pol.requiresApproval) {
      // A aprovação vale só para o conteúdo exato que foi aprovado (hash das instruções + verificação).
      const approved = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'APROVADO', subjectHash: stepHash(step) } });
      if (!approved) {
        const ops = (step.provider ?? job.defaultProvider) === 'arquivos-projeto' ? descreverOperacoes((step.providerOptions ?? {}) as never) : '';
        return this.awaitApproval(task, workerId, job, step, ops ? [ops] : pol.reasons, ops ? `Confirma ${ops}? (fica no histórico do git; dá para desfazer)` : undefined);
      }
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
      if (new Prisma.Decimal(job.maxCostUsd).gt(0) && new Prisma.Decimal(job.costSpentUsd).add(estimado).gt(job.maxCostUsd)) {
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
    let docsPendentes = new Map<string, Buffer>();
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
        // A conversa inteira que gerou o trabalho: o pedido do usuário (ex.: "as 16 seções") fica disponível em
        // cada sessão — antes só o resumo do objetivo chegava e a IA perguntava ao usuário o que ele já tinha dito.
        const conversa = await this.prisma.conversationMessage.findMany({
          where: { conversationId: origem.conversationId },
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, kind: true, createdAt: true, attachments: true },
        });
        fs.writeFileSync(path.join(worktree, SESSION_CONTEXT_DIR, 'conversa-do-pedido.md'), conversaComoTexto(conversa));
        // Resultados dos OUTROS trabalhos desta conversa (ex.: o plano de limpeza que este trabalho vai executar).
        const outros = (await jobsDaConversa(this.prisma, origem.conversationId)).filter((id) => id !== job.id);
        const resultados = await this.artifacts.copiarResultados(job.projectId, outros, path.join(worktree, SESSION_CONTEXT_DIR, 'resultados'));
        if (resultados.length) await L(`Resultados de trabalhos anteriores da conversa disponíveis para a IA: ${resultados.length} arquivo(s) em contexto/resultados/`);
      }
      // Instruções de agente do próprio repositório: cópia legível em contexto/repositorio/, restauradas depois.
      repoHarness = await this.workspace.hideRepoHarness(worktree);
      // Documentos de instrução escritos por uma sessão anterior que ainda não viraram commit (a sessão acabou sem
      // concluir a etapa): são do trabalho. Saem da pasta durante esta sessão (cópia legível em contexto/repositorio/)
      // e voltam depois — antes a limpeza abaixo os apagava.
      const naoVersionados = this.workspace.docsNoTrabalho(worktree).filter((f) => !repoHarness.includes(f));
      docsPendentes = this.workspace.capturarDocsEditados(worktree, naoVersionados);
      for (const [rel, conteudo] of docsPendentes) {
        const dest = path.join(worktree, SESSION_CONTEXT_DIR, 'repositorio', WorkspaceService.sessionPath(rel));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, conteudo);
      }
      const planted = this.workspace.sanitizeHarnessFiles(worktree).filter((f) => !repoHarness.includes(f) && !docsPendentes.has(f) && !f.startsWith('contexto/'));
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
    const { text: contextBase, stats: contextStats } = await this.buildContext(job, step, profile.text, isAi ? worktree : undefined);
    const docsDoRepo = isAi ? [...this.workspace.docsEditaveis(repoHarness), ...docsPendentes.keys()] : [];
    const context = docsDoRepo.length
      ? `${contextBase}\n\n## Documentos de instrução do repositório\nNesta sessão ${docsDoRepo.join(', ')} ficam fora da pasta (cópia para ler em contexto/repositorio/, com "_" no nome). Se o trabalho pede para alterar um deles, escreva o arquivo no caminho original (ex.: ${docsDoRepo[0]}) com o conteúdo COMPLETO atualizado (parta da cópia): essa versão entra no trabalho.`
      : contextBase;
    // O prompt exato de cada sessão é guardado: prova do contexto recebido (objetivo, notas, evidências).
    const promptArt = await this.artifacts.storeContent(
      { projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id, name: `prompts/${step.key}/tentativa-${number}.md`, kind: 'PROMPT' },
      isAi ? buildPrompt({ context, instructions: step.instructions }) : step.instructions,
    );
    await this.prisma.attempt.update({ where: { id: attempt.id }, data: { promptArtifactId: promptArt.id, contextStats: contextStats as unknown as Prisma.InputJsonValue } });
    if (contextStats.memoryOmitted || contextStats.overBudget) {
      await L(`Orçamento de contexto: ${contextStats.totalChars}/${contextStats.budgetChars} caracteres; ${contextStats.memoryOmitted} entrada(s) de memória omitidas do prompt (íntegras em .nivoo/memoria.md)`, 'INFO', attempt.id);
    }
    // Tempo da sessão: o da etapa; com limite de tempo no trabalho (> 0), nunca além do que resta dele.
    // 0 = sem limite de tempo no trabalho (não pode virar "1 segundo").
    const remainingSec = job.maxDurationSec > 0 ? Math.max(1, job.maxDurationSec - job.activeSeconds) : Infinity;
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
        projectMediaDir: this.pastaDeMidia(job.project.dirKey),
        systemPrompt: isAi ? profile.text : undefined,
        timeoutMs,
        signal,
        // Modelo: o da etapa (se definido) ou o escolhido para esta IA no projeto; senão, o padrão da IA.
        options: { model: projectModel(job.project, providerId), ...((step.providerOptions ?? {}) as { model?: string; maxTurns?: number }) },
        // Ferramentas MCP liberadas para este projeto (Conexões → Ferramentas).
        ...(isAi ? { mcp: mcpDoProjeto(job.projectId, { jobId: job.id }) } : {}),
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
      registrarErro('worker', `erro do conector ${providerId} (trabalho ${job.id}, etapa ${step.key}): ${e?.message ?? e}`, e);
    }
    await logChain;
    // Login recusado de verdade (token expirado/revogado) marca a conexão para a tela pedir "Reconecte".
    if (isAi) this.registry.registrarResultado(providerId, result.exitCode === 0 && !result.resourceUnavailable, result.error); // só o canal de erro, nunca o texto da IA (código e logs do projeto citam 401…)

    if (isAi && !result.interrupted) {
      // Remoções/movimentações pedidas pela IA (.nivoo/remover.txt): o sistema faz por ela, ANTES da conferência.
      const rem = this.workspace.aplicarRemocoesPedidas(worktree);
      if (rem.feitos.length) await L(`Pedido da IA: ${rem.feitos.length} item(ns) apagado(s)/movido(s): ${rem.feitos.slice(0, 50).join(', ')}`, 'INFO', attempt.id);
      if (rem.recusados.length) await L(`Pedidos de remoção recusados (caminho inválido, protegido ou inexistente): ${rem.recusados.slice(0, 30).join('; ')}`, 'WARN', attempt.id);
    }
    // Sessão de IA que esgotou o tempo = sessão encerrada (não falha): confere, salva o que foi feito e continua
    // numa nova sessão. Antes contava como falha: sem conferência, sem checkpoint, e dois tempos esgotados seguidos
    // bloqueavam o trabalho como "repetição improdutiva".
    if (isAi && !result.interrupted && !result.resourceUnavailable && /^timeout após \d+ ms/.test(result.error ?? '')) {
      result = { ...result, sessionEnded: true, stopReason: result.stopReason ?? 'tempo da sessão esgotado' };
    }
    // O agente terminou a sessão normalmente (ou por limite de turnos)? Guardado antes da verificação.
    const sessionClosedNormally = !result.interrupted && !result.resourceUnavailable && (result.exitCode === 0 || !!result.sessionEnded);
    // Verificação determinística da etapa (não decide conclusão do job).
    // Etapa de revisão: basta o relatório (vale também para trabalhos criados antes, que guardaram a conferência antiga).
    const verifyCommand = step.key === RULE_REVIEW_STEP ? RULE_REVIEW_STEP_CHECK : step.verifyCommand;
    let verifyCommandEfetivo = verifyCommand ?? ''; // o que realmente roda (o sistema pode curar npm ci sem lockfile)
    let verified = !verifyCommand;
    let faltaPrograma: string | null = null;
    let ambiente: string | null = null; // falha do servidor do Nivoo (não do projeto): nenhuma sessão resolve
    let credencialFaltando: string | null = null; // registro de pacotes privado sem token: só o usuário resolve
    if ((result.exitCode === 0 || (isAi && result.sessionEnded)) && !result.interrupted && !result.resourceUnavailable && verifyCommand) {
      // Banco de teste descartável do trabalho (testes de integração do projeto).
      const banco = await prepararBancoDeTeste(job.id).catch(async (e) => {
        await L(`Banco de teste indisponível: ${e?.message ?? e}`, 'WARN', attempt.id);
        return null;
      });
      const porta = await portaLivre().catch(() => 0);
      // Variáveis da conferência: valores fixos + as que apontam para o token de uma conta Git conectada
      // (resolvido aqui; o token nunca entra na sessão da IA, só na conferência).
      const envDaConferencia: Record<string, string> = { ...variaveisDaConferencia(job.projectId) };
      for (const [nome, contaId] of Object.entries(referenciasDaConferencia(job.projectId))) {
        try {
          envDaConferencia[nome] = getGitAccount(contaId).token;
        } catch {
          /* conta apagada: a variável fica sem valor e o 401 orienta de novo */
        }
      }
      // A conferência pode levar minutos (instalar, testar, compilar): registra o andamento para a tela não parecer
      // parada — a última linha da saída a cada 15 s e um "ainda rodando" a cada minuto.
      await L(`Conferindo a etapa (testes, build…): ${verifyCommand.replace(/\s+/g, ' ').slice(0, 200)}`, 'INFO', attempt.id);
      const inicioConferencia = Date.now();
      const avisoMs = Number(process.env.NIVOO_CONFERENCIA_AVISO_MS ?? 15_000);
      let ultimaLinha = '';
      let ultimoRegistro = Date.now();
      const anotar = (pedaco: string) => {
        const l = pedaco.split('\n').map((x) => x.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).pop();
        if (l) ultimaLinha = l;
        if (ultimaLinha && Date.now() - ultimoRegistro > avisoMs) {
          ultimoRegistro = Date.now();
          void L(`Conferência rodando (${Math.round((Date.now() - inicioConferencia) / 60_000)} min): ${ultimaLinha.slice(0, 200)}`, 'INFO', attempt.id);
        }
      };
      const pulso = setInterval(() => {
        if (Date.now() - ultimoRegistro < avisoMs * 3.5) return;
        ultimoRegistro = Date.now();
        void L(`Conferência ainda rodando (${Math.round((Date.now() - inicioConferencia) / 60_000)} min)${ultimaLinha ? `: ${ultimaLinha.slice(0, 160)}` : ''}`, 'INFO', attempt.id);
      }, avisoMs * 4);
      const conferir = () =>
        runProcess('bash', ['-e', '-o', 'pipefail', '-c', verifyCommandEfetivo], {
          onStdout: anotar,
          onStderr: anotar,
          cwd: worktree,
          env: ambienteDaConferencia({ NIVOO_JOB_ID: job.id, NIVOO_OUTPUT_DIR: outputDir, NIVOO_PORTA_TESTE: String(porta), ...envDaConferencia, ...(banco?.env ?? {}) }),
          encerrarGrupoAoSair: true,
          // A conferência pode instalar dependências, rodar os testes e o build do projeto: até 30 min (configurável).
          timeoutMs: Number(process.env.NIVOO_VERIFY_TIMEOUT_SEC ?? 1800) * 1000,
          maxBuffer: 20 * 1024 * 1024,
          signal,
        });
      let v = await conferir();
      // Cache do corepack quebrado (download interrompido: "pnpm.cjs" ausente): o sistema refaz o cache e confere
      // de novo, sozinho — não é coisa que a IA conserte.
      if (v.exitCode !== 0 && /corepack/i.test(`${v.stdout}${v.stderr}`) && problemaDoAmbiente(`${v.stdout}${v.stderr}`)) {
        const cache = process.env.COREPACK_HOME ?? path.join(process.env.HOME ?? os.homedir(), '.cache', 'node', 'corepack');
        fs.rmSync(cache, { recursive: true, force: true });
        await L(`Conferência: cache do corepack quebrado no servidor; refeito (${cache}) e conferindo de novo`, 'WARN', attempt.id);
        v = await conferir();
      }
      // "npm ci" sem package-lock.json (projeto que não commita o lockfile): o npm aborta com EUSAGE antes de testar.
      // A IA não tem terminal para gerar o lockfile nem pode mudar o comando: o sistema refaz a conferência com
      // "npm ci" → "npm install" (igual para yarn/pnpm "--frozen-lockfile"), uma vez. Não é falha do código.
      if (v.exitCode !== 0 && semLockfile(`${v.stdout}${v.stderr}`) && /npm ci|--frozen-lockfile|--immutable/.test(verifyCommandEfetivo)) {
        verifyCommandEfetivo = verifyCommandEfetivo
          .replace(/npm ci/g, 'npm install')
          .replace(/\s--frozen-lockfile/g, '')
          .replace(/\s--immutable/g, '');
        await L('Conferência: o projeto não tem package-lock.json, então "npm ci" não roda; refiz com "npm install" (sem travar no lockfile).', 'WARN', attempt.id);
        v = await conferir();
      }
      clearInterval(pulso);
      if (v.exitCode !== 0 && !v.aborted) ambiente = problemaDoAmbiente(`${v.stdout}${v.stderr}`);
      // 401/403 num registro de pacotes privado: falta um token (segredo) que a IA não pode fornecer.
      if (v.exitCode !== 0 && !v.aborted && !ambiente) credencialFaltando = faltaCredencial(`${v.stdout}${v.stderr}`);
      // Conferência que falha calada (ex.: `test -f relatorio.md`): diz qual comando falhou e, para os testes
      // de arquivo mais comuns, o que falta — a IA e o usuário precisam saber o que cobrar.
      const vOut = (`${v.stdout}${v.stderr}`.trim() || (v.exitCode !== 0 ? explicarConferencia(verifyCommand, worktree) : '')).slice(-4000); // a IA precisa do erro do teste/build para corrigir
      // Saída inteira da conferência para a próxima sessão ler (o erro do teste costuma estar no fim de muita saída).
      try {
        fs.mkdirSync(path.join(worktree, '.nivoo'), { recursive: true });
        fs.writeFileSync(path.join(worktree, '.nivoo', 'ultima-conferencia.txt'), `$ ${verifyCommand}\n(exit ${v.exitCode})\n\n${`${v.stdout}${v.stderr}`.slice(-2_000_000)}`);
      } catch {
        /* melhor esforço */
      }
      await L(`Verificação da etapa: exit ${v.exitCode}${vOut ? ` — ${vOut}` : ''}`, v.exitCode === 0 ? 'INFO' : 'WARN', attempt.id);
      verified = v.exitCode === 0;
      // 127 = o comando da conferência não existe no servidor: nenhuma sessão vai resolver isso.
      // 127 com um programa que a PRÓPRIA conferência chama (ex.: "rg" em "rg x && …"): nenhuma sessão resolve.
      // Programa que falta dentro do projeto (ex.: jest num "npm test") a IA corrige: segue o fluxo normal.
      if (v.exitCode === 127) {
        const falta = /(\S+): (?:command not found|comando não encontrado|not found)/.exec(vOut)?.[1]?.replace(/^.*:\s*/, '') ?? '';
        const daConferencia = verifyCommand.split(/&&|\|\||;|\|/).map((x) => x.trim().replace(/^\(+\s*/, '').split(/\s+/)[0]).filter(Boolean);
        if (falta && daConferencia.includes(falta)) faltaPrograma = falta;
      }
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
      // Documento de instrução (CLAUDE.md, AGENTS.md…) escrito ou criado pela IA = atualização pedida pelo trabalho.
      const editados = this.workspace.capturarDocsEditados(worktree, this.workspace.docsNoTrabalho(worktree));
      const planted = this.workspace.sanitizeHarnessFiles(worktree);
      // Configurações (.claude/, .codex/…) voltam intactas; a IA não mexe em hooks nem permissões.
      await this.workspace.restoreRepoHarness(worktree, repoHarness).catch(async (e) => L(`Falha ao restaurar instruções do repositório: ${e?.message ?? e}`, 'ERROR', attempt.id));
      // Os pendentes de sessões anteriores voltam (a versão desta sessão, se a IA reescreveu, vale mais).
      for (const [rel, c] of docsPendentes) if (!editados.has(rel)) editados.set(rel, c);
      if (editados.size) {
        this.workspace.gravarDocsEditados(worktree, editados);
        await L(`Documentos de instrução escritos pela IA (entram no trabalho): ${[...editados.keys()].join(', ')}`, 'INFO', attempt.id);
      }
      const novos = planted.filter((f) => !repoHarness.includes(f) && !editados.has(f));
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

    if (ambiente && attemptStatus !== 'SUCESSO') {
      await this.checkpoint(job.id, step, worktree, `conferência sem ambiente na etapa ${step.key}`, { tentativa: number });
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `a conferência falhou por um problema do SERVIDOR do Nivoo, não do projeto (${ambiente}). O trabalho feito está salvo. Rode "nivoo update" no servidor (instala e arruma as ferramentas) e clique em "Tentar de novo"; se repetir, mande o diagnóstico`);
    }

    if (credencialFaltando && attemptStatus !== 'SUCESSO') {
      await this.checkpoint(job.id, step, worktree, `conferência sem credencial na etapa ${step.key}`, { tentativa: number });
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `a conferência não conseguiu instalar as dependências: um registro de pacotes privado recusou o acesso por falta de token (${credencialFaltando}). O trabalho feito está salvo. Guarde o token em Ajustes do projeto → "Variáveis da conferência" (ex.: GITLAB_PACKAGE_TOKEN, o mesmo nome que o .npmrc usa) e clique em "Continuar"`);
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
    // A conferência da etapa falhando sempre igual, sessão após sessão: a IA mexe em arquivos (parece avanço),
    // mas não resolve o que a conferência cobra. Para e explica, em vez de girar sem fim.
    const janelaConferencia = Math.max(6, job.repetitionWindow * 3);
    // Normalizado: tempos, durações, datas e números mudam a cada execução de teste sem ser progresso.
    const conferencias = sessions.slice(0, janelaConferencia).map((a) => normalizarErro(a.error ?? ''));
    if (conferencias.length >= janelaConferencia && conferencias[0].startsWith('verificação da etapa falhou') && conferencias.every((e) => e === conferencias[0])) {
      return this.blockJob(task, workerId, job, step, BlockedReason.REPETICAO_IMPRODUTIVA,
        `a conferência da etapa falhou ${janelaConferencia} vezes seguidas do mesmo jeito: ${(sessions[0].error ?? '').replace(/^verificação da etapa falhou /, '').slice(-600)}`);
    }
    // Só anotações, sessão após sessão, sem nunca mexer num arquivo: depois de uma janela longa também para
    // (sem limite de sessões, nada mais seguraria uma IA que só escreve "ainda analisando").
    const janelaLonga = Math.max(8, job.repetitionWindow * 4);
    if (sessions.length >= janelaLonga && sessions.slice(0, janelaLonga).every((a) => a.treeBefore === a.treeAfter)) {
      return this.blockJob(task, workerId, job, step, BlockedReason.REPETICAO_IMPRODUTIVA,
        `as últimas ${janelaLonga} sessões só anotaram progresso, sem alterar nenhum arquivo do trabalho`);
    }
    if (job.maxSessionsPerStep > 0 && sessions.length >= job.maxSessionsPerStep) {
      return this.failStep(task, workerId, job, step, `limite de ${job.maxSessionsPerStep} sessões sem concluir a etapa`, BlockedReason.LIMITE_SESSOES);
    }
    await this.prisma.step.update({
      where: { id: step.id },
      data: { status: 'PENDENTE', statusDetail: `sessão ${number} encerrada sem concluir; continuação automática agendada` },
    });
    await this.logs.log(job.id, `Continuação automática: nova sessão para "${step.key}" (${sessions.length}${job.maxSessionsPerStep > 0 ? `/${job.maxSessionsPerStep}` : ''} sessões usadas)`, {
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
    // Problema de infraestrutura (programa faltando, IA sem crédito/login, limite do próprio sistema) não diz
    // nada sobre o jeito de fazer: não vira lição.
    if (ehProblemaDeInfra(`${detail} ${recent.map((a) => `${a.error ?? ''} ${(a.output ?? '').slice(-500)}`).join(' ')}`)) return;
    // Uma lição por etapa e motivo (não uma por tentativa).
    const ja = await this.prisma.memoryEntry.findFirst({
      where: { projectId: job.projectId, supersededById: null, AND: [{ references: { path: ['origem'], equals: 'licao-automatica' } }, { references: { path: ['stepId'], equals: step.id } }, { references: { path: ['motivo'], equals: reason } }] },
    });
    if (ja) return;
    const tried = recent
      .reverse()
      .map((a) => `#${a.number} ${a.status}${a.stopReason ? ` (${a.stopReason})` : ''}: ${(a.error ?? '').slice(0, 300)}${a.output ? ` — saída: ${a.output.trim().slice(-200)}` : ''}`)
      .join(' | ');
    await this.prisma.memoryEntry.create({
      data: {
        camada: 'INTERNA',
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
          data: { camada: 'INTERNA', projectId: job.projectId, category: 'PENDENCIA', title: 'nota inválida do agente', content: line.slice(0, 2000), references: { jobId: job.id, attemptId, noteHash: sha256(line.trim()), origem: 'notas-do-agente' }, author },
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
        data: { camada: 'INTERNA', projectId: job.projectId, category, title: titulo, content: prefix + conteudo, references: references as Prisma.InputJsonValue, author },
      });
    }
    if (count) await escreverArquivosDaMemoria(this.prisma, job.projectId);
    if (count) await this.logs.log(job.id, `${count} nota(s) do agente guardada(s) na memória interna do processo`, { stepId: step.id, source: 'worker' });
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

  /** Ao fim do trabalho (parado/falhou): tira da pasta do trabalho dependências e caches (node_modules…). */
  private async limparAoFim(job: Job & { project?: { dirKey: string } }): Promise<void> {
    try {
      const p = job.project ?? (await this.prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, select: { dirKey: true } }));
      const wt = path.join(this.workspace.projectDirs(p.dirKey).worktrees, job.id);
      const r = await this.workspace.limparLixoDeExecucao(wt);
      if (await descartarBancoDeTeste(job.id)) await this.logs.log(job.id, 'Banco de teste do trabalho apagado', { source: 'worker' });
      if (r.removidos.length) await this.logs.log(job.id, `Limpeza: ${r.removidos.join(', ')} apagado(s) da pasta do trabalho (${r.mb} MB; são só instalação/cache)`, { source: 'worker' });
    } catch {
      /* limpeza é melhor esforço */
    }
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
    await avisarConversaQueParou(this.prisma, job.id, `${reason}: ${detail}`);
    await this.limparAoFim(job);
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
    await avisarConversaQueParou(this.prisma, job.id, detail);
    await this.limparAoFim(job);
    await this.recordLesson(job, step, reason, detail);
    await this.queue.complete(task.id, workerId);
    return 'FALHOU';
  }

  private async awaitApproval(task: ClaimedTask, workerId: string, job: Job, step: Step, reasons: string[], descricao?: string): Promise<StepOutcome> {
    const pending = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'PENDENTE' } });
    if (!pending) {
      await this.prisma.approval.create({
        data: {
          jobId: job.id,
          projectId: job.projectId,
          kind: 'ACAO_DESTRUTIVA',
          subjectId: step.id,
          subjectHash: stepHash(step),
          description: descricao ?? `Etapa "${step.key}" contém ação potencialmente destrutiva: ${reasons.join('; ') || 'marcada como requer aprovação'}`,
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
  /** Pasta de mídia durável do projeto (vídeos enviados e editados), fora do git; criada se não existir. */
  private pastaDeMidia(dirKey: string): string {
    const dir = this.workspace.projectDirs(dirKey).midia;
    fs.mkdirSync(path.join(dir, 'entrada'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'saida'), { recursive: true });
    return dir;
  }

  async buildContext(job: Job, step: Step, profileText: string, worktree?: string): Promise<{ text: string; stats: ContextStats }> {
    const [objective, criteria, steps, checkpoint, memory, attempts, artifacts] = await Promise.all([
      this.prisma.jobObjectiveVersion.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' } }),
      this.prisma.acceptanceCriterion.findMany({ where: { jobId: job.id } }),
      this.prisma.step.findMany({ where: { jobId: job.id }, orderBy: { order: 'asc' } }),
      this.prisma.checkpoint.findFirst({ where: { jobId: job.id }, orderBy: { seq: 'desc' } }),
      this.prisma.memoryEntry.findMany({
        // Memória do projeto inteira + da interna só o que serve a esta sessão: lições de falhas do projeto e as
        // notas DESTE trabalho (notas de outros trabalhos são processo encerrado, não contexto).
        where: {
          projectId: job.projectId,
          supersededById: null,
          OR: [
            { camada: 'PROJETO' },
            { camada: 'INTERNA', references: { path: ['origem'], equals: 'licao-automatica' } },
            { camada: 'INTERNA', references: { path: ['jobId'], equals: job.id } },
          ],
        },
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
    // Esta pasta é o projeto (e o repositório ligado): nada de pedir "a pasta original" ou o endereço do GitHub.
    const vinculo = await this.prisma.project.findUnique({ where: { id: job.projectId }, select: { dirKey: true, gitUrl: true, gitBranch: true } });
    if (vinculo) add('repositorio', await textoDoRepositorio(this.workspace.projectDirs(vinculo.dirKey).repo, vinculo));
    const ferramentas = ferramentasDaIa(step.provider ?? job.defaultProvider, mcpDoProjeto(job.projectId).map((m) => m.nome));
    if (ferramentas.length) add('ferramentas', [...ferramentas, ...(bancoDeTesteDisponivel() ? TEXTO_BANCO_DE_TESTE : []), ...TEXTO_SISTEMA_RODANDO, ...TEXTO_FOTOS, ...TEXTO_ROTEIRO, ...TEXTO_PADRAO_DAS_TELAS]);
    if (step.key === RULE_REVIEW_STEP && worktree) {
      // Relatórios e documentos em out/ também são o produto (não aparecem no diff do git): a revisão confere eles.
      const emOut = fs.existsSync(path.join(worktree, 'out'))
        ? fs.readdirSync(path.join(worktree, 'out'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(worktree, path.join(e.parentPath ?? (e as any).path, e.name)))
        : [];
      add('mudancas', [
        '## Mudanças feitas por este trabalho (comparadas com a pasta principal)', '```diff', await this.workspace.diffAgainstMain(worktree), '```',
        ...(emOut.length ? ['Resultados em out/ (relatórios e documentos entregues; leia e confira também):', ...emOut.slice(0, 100).map((f) => `- ${f}`)] : []),
      ]);
    }
    if (worktree && fs.existsSync(path.join(worktree, SESSION_CONTEXT_DIR, 'conversa-do-pedido.md'))) {
      add('conversa', [
        '## O pedido do usuário, por inteiro',
        `A conversa que gerou este trabalho (mensagens do usuário completas, com listas, seções e exemplos que ele deu) está em ${SESSION_CONTEXT_DIR}/conversa-do-pedido.md.`,
        'O objetivo abaixo é um RESUMO: na dúvida sobre o que foi pedido, leia a conversa. Antes de perguntar algo ao usuário,',
        `procure a resposta na conversa, na memória do projeto (.nivoo/memoria.md), em out/respostas-do-usuario.md e nos entregáveis anteriores.`,
        ...(fs.existsSync(path.join(worktree, SESSION_CONTEXT_DIR, 'resultados'))
          ? [`Resultados de trabalhos ANTERIORES desta conversa (relatórios, inventários, planos) estão em ${SESSION_CONTEXT_DIR}/resultados/<id do trabalho>/: use-os como base.`]
          : []),
      ]);
    }
    // Versão declarada × última etiqueta do Git: a IA sobe o número certo (o mesmo que o Nivoo vai publicar).
    const versao = textoDaVersao(await infoDeVersao(this.workspace.projectDirs((job as any).project?.dirKey ?? (await this.prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, select: { dirKey: true } })).dirKey).repo).catch(() => null));
    if (versao.length) add('versao', versao);
    add('objetivo', [`## Objetivo original (v${objective?.version}, sha256 ${objective?.sha256})`, objective?.text ?? '']);
    add('criterios', ['## Critérios de aceitação do job (verificados pelo backend, não por você)', ...criteria.map((c) => `- [${c.status}] ${c.key} (${c.kind}): ${c.description}`)]);
    add('etapas', ['## Etapas', ...steps.map((s) => `- [${s.status}] ${s.key}: ${s.title}${s.id === step.id ? '  <== ETAPA ATUAL' : ''}`)]);
    const conferencia = step.key === RULE_REVIEW_STEP ? RULE_REVIEW_STEP_CHECK : step.verifyCommand;
    if (conferencia) add('verificacao', ['## Verificação desta etapa (executada pelo backend ao fim da sessão)', '```', conferencia, '```']);
    if (step.key === RULE_REVIEW_STEP) {
      add('revisao', [
        '## Como esta revisão termina',
        `- A etapa termina quando ${RULE_REVIEW_REPORT} existe com "conforme" true ou false. NÃO é preciso deixar conforme=true:`,
        '  se houver violação que você não consegue corrigir (ex.: falta fazer parte do trabalho), grave conforme=false com as violações',
        '  concretas — o sistema devolve o trabalho à IA do projeto para corrigir e depois revisa de novo.',
      ]);
    }
    const history = [`## Sessões desta etapa: esta é a sessão ${sessionNo}`];
    if (attempts.length) {
      history.push('As sessões anteriores terminaram sem concluir a etapa. Continue de onde pararam; NÃO recomece do zero e não repita abordagens que falharam.');
      history.push('Se a conferência falha por uma causa fora do que a etapa pede (ex.: o script de teste do package.json está errado, falta uma configuração),',
        'corrija essa causa — o mínimo necessário — e explique no fim. Só não mexa no que o usuário ou as regras do projeto protegem. Anotar a falha e',
        'encerrar a sessão sem mudar nada não resolve: a conferência vai falhar igual.');
      for (const a of [...attempts].reverse()) {
        const e = a.error ?? '';
        // O começo diz o que falhou; o fim tem o erro do teste/build (o meio costuma ser instalação).
        const resumo = e.length > 1500 ? `${e.slice(0, 300)} … ${e.slice(-1200)}` : e;
        history.push(`- sessão ${a.number}: ${a.status} (término: ${a.stopReason ?? '-'}) ${resumo}`);
      }
      if (worktree && fs.existsSync(path.join(worktree, 'out', 'telas-interativas', 'relatorio.md'))) {
        history.push('A última conferência rodou os ROTEIROS de interação: out/telas-interativas/relatorio.md e as fotos (inclusive a do passo que falhou). Corrija a tela no passo que falhou.');
      }
      if (worktree && fs.existsSync(path.join(worktree, 'out', 'telas', 'relatorio.md'))) {
        history.push('A última conferência tirou FOTOS das telas: out/telas/*.png (computador e celular) e out/telas/relatorio.md. ABRA as fotos e corrija o visual (layout quebrado, texto cortado ou sobreposto, não cabe no celular) e os problemas do relatório.');
      }
      if (worktree && fs.existsSync(path.join(worktree, '.nivoo', 'ultima-conferencia.txt'))) {
        history.push('A saída COMPLETA da última conferência (testes, build) está em .nivoo/ultima-conferencia.txt: leia antes de corrigir.');
      }
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

/** Conversa do chat em Markdown (usuário por inteiro; respostas longas da IA resumidas no começo e no fim). */
export function conversaComoTexto(msgs: Array<{ role: string; content: string; kind: string | null; createdAt: Date; attachments?: unknown }>): string {
  const partes = ['# Conversa que gerou este trabalho', ''];
  let total = 0;
  for (const m of msgs) {
    const quem = m.role === 'USUARIO' ? 'Usuário' : m.kind === 'sistema' ? 'Sistema' : 'IA';
    const limite = m.role === 'USUARIO' ? 40_000 : 6_000;
    const c = m.content.length > limite ? `${m.content.slice(0, limite / 2)}\n… (cortado) …\n${m.content.slice(-limite / 2)}` : m.content;
    const anexos = Array.isArray(m.attachments) && m.attachments.length ? `\n(anexos: ${m.attachments.map((a: any) => a?.nome).filter(Boolean).join(', ')} — em contexto/anexos/)` : '';
    const bloco = `## ${quem} — ${m.createdAt.toISOString()}\n\n${c}${anexos}\n`;
    total += bloco.length;
    if (total > 600_000) {
      partes.push('… (conversa longa demais: o restante foi omitido) …');
      break;
    }
    partes.push(bloco);
  }
  return partes.join('\n');
}

/** Erro sem o que muda a cada execução (horários, durações, números, hashes): para comparar repetição. */
export function normalizarErro(e: string): string {
  return e
    .replace(/\b[0-9a-f]{7,40}\b/gi, 'H')
    .replace(/\d+([.,]\d+)?\s*(ms|s|seg|min|m|kb|mb)\b/gi, 'N')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}
