import { diagnoseAttempt,formatFailureEvidence } from './executor/failure-evidence';
import { skillExecutionEvidence,collectSkillCoverage } from '../specialties/skill-evidence';
import { nativeImageTarget,isCodexAccount } from '../providers/codex-image-assets';
import { classifyMediaFailure } from '../specialties/media/failure-policy';
import { checkGeneratedImageOutputs } from './image-output-guard';
import { tipoDe } from '../accounts/connections';
import { dependenciasDeMontagemPorArquivo, etapaPedeRenderizacaoMotion } from '../jobs/executor-priority';
import { operationsNeedApproval,validateFileOperations } from '../common/file-operations';
import { descreverOperacoes } from '../providers/arquivos-projeto.provider';
import { isTransientRateLimit, resourceRateLimitDelayMs } from '../providers/resource-rate-limit';
import { trocarEtapaParaReserva,markModelIncompatible } from '../projects/mover-trabalho';
import { projectSessionMcp } from '../mcp/session-policy';
import { Injectable, Logger } from '@nestjs/common';
import { Attempt, Job, Prisma, Step } from '@prisma/client';
import * as path from 'node:path';
import { appConfig } from '../config';
import { armazenamentoDisponivel, MIN_FREE_VIDEO_BYTES } from '../common/disk-guard';
import { normalizedOutputHash } from '../common/hash';
import { stopOwnedOrphan,processIdentity } from '../common/process-identity';
import { assertStepLease,LostStepLease } from './executor/lease';
import * as os from 'node:os';
import { BlockedReason } from '../common/status';
import { LogService } from '../jobs/log.service';
import { OrchestratorService } from '../jobs/orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { buildPrompt } from '../providers/provider.interface';
import type { ExecutionResult } from '../providers/provider.interface';
import { attemptContract,readAttemptJournal,writeAttemptPhase,attachAttemptReplay,terminalAttemptJournal,makeReplayEnvelope,canReplayAttempt,replayAuxFingerprint,validFinalizationPlan,type FinalizationPlan,type AttemptReplayInput } from './executor/attempt-journal';
import * as fs from 'node:fs';
import { sha256 } from '../common/hash';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { evaluatePolicy } from '../security/policy';
import type { ContextStats } from './context-builder';
import { buildExecutionContext } from './executor/context';
import { readApprovedScope } from '../jobs/approved-scope';
import { approvedGoldfish,checkApprovedGoldfishStep,type ApprovedGoldfishResolution } from '../specialties/software/egm/resolution-execution';
import { detectGoldfishGitDrift,renderGoldfishGitDrift } from '../specialties/software/egm/resolution-proof';
import { prepareExecutionWorkspace } from './executor/workspace';
import { dispatchExecution,executionTimeoutMs } from './executor/dispatch';
import { verifyExecution } from './executor/verification';
import { prepareExecutionPrompt } from './executor/prompt';
import { normalizeSessionResult,classifyExecutionResult } from './executor/outcome';
import { hasMotionCommand,readMotionInvocations } from '../jobs/motion/command';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';
import { avisarConversaQueParou } from '../conversations/jobs-da-conversa';
import { descartarBancoDeTeste } from '../common/banco-de-teste';
import { ProjectProfileService } from '../projects/project-profile.service';
import { decideFailedAttempt,repeatedSessionVerification,decideSessionContinuation,repairKey,isRepairStep } from './executor/recovery-policy';
import { recoverRenderedOutput,captureMediaOutputs,publishAttemptMedia,durableMediaOutputs } from './executor/media-recovery';
import { recordLesson,ingestNotes,saveCheckpoint } from './executor/recovery-store';
import { capturasParaRecuperar } from '../jobs/motion-capture-freshness';
import { mediaEnabledForArea,hasNativeMediaOperation } from '../specialties/media/scope';
import { parecerVisualNaoAprovado, prepararQuadrosDoVideo, quadrosRequeridos } from '../jobs/video-frame-extraction';

/** Modelo escolhido para a IA no projeto (undefined = padrão da IA). */
import { projectModel } from '../providers/project-model';
import { assessModel,selectedModel } from '../providers/model-capabilities';
export { projectModel } from '../providers/project-model';

/** Conteúdo exato de uma etapa que uma aprovação cobre. */
export function stepHash(step: Pick<Step, 'instructions' | 'verifyCommand' | 'provider'> & Partial<Pick<Step,'providerOptions'>>): string {
  // Trocar de uma IA para outra (IA reserva) não muda o que a etapa faz: a aprovação continua valendo.
  // Trocar para um executor do sistema (comandos, arquivos) muda, e pede aprovação de novo.
  const p = step.provider ?? null;
  const quem = p === null || tipoDe(p) ? 'ia' : p;
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  // Exact executor options are part of the approval, not just its description.
  return sha256(JSON.stringify([step.instructions, step.verifyCommand ?? null, quem,...(quem==='ia'?[]:[canonical(step.providerOptions??{})])]));
}

// Erros corrigíveis diferentes não compartilham teto de sessões.
// Recursos externos sem acesso continuam protegidos por três verificações.
const MAX_RESOURCE_RECHECKS_PER_STEP = 3;
const RESOURCE_BACKOFF_MS = [30_000, 60_000, 120_000];
export type StepOutcome = 'CONCLUIDO' | 'CONTINUA' | 'RETRY' | 'FALHOU' | 'BLOQUEADO' | 'INTERROMPIDO' | 'AGUARDANDO_RECURSO' | 'AGUARDANDO_APROVACAO' | 'IGNORADO';

export { ehProblemaDeInfra } from './executor/recovery-store';

export { explicarConferencia } from './executor/verification';

type ExecutionJob=Prisma.JobGetPayload<{include:{project:{include:{area:true}}}}>;
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
      await this.queue.complete(task.id, workerId, task.claims);
      return 'IGNORADO';
    }
    const L = (msg: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO', attemptId?: string) =>
      this.logs.log(job.id, msg, { stepId: step.id, attemptId, level, source: `worker:${workerId}` });

    if(signal.aborted)return 'INTERROMPIDO';
    // Reconcile only under the current claim. Never signal a group on
    // another host or an unrelated process that reused an old PID.
    const orphanRows=await this.prisma.attempt.findMany({where:{stepId:step.id,status:'EXECUTANDO'}});
    let replay:Attempt|null=null;
    if(orphanRows.length||task.recovered){
      const recovery=await this.prisma.$transaction(async tx=>{
        await OrchestratorService.lockJob(tx,job.id);
        await assertStepLease(tx,task,workerId);
        const current=await tx.attempt.findMany({where:{stepId:step.id,status:'EXECUTANDO'}});
        const unsafe:string[]=[];
        // Only a single latest attempt with a complete receipt may be adopted.
        // The provider has already returned and the next side-effecting phase has not begun.
        if(current.length===1){
          const o=current[0],journal=readAttemptJournal(o.executionState);
          if(o.hostname===os.hostname()&&!o.pid&&o.number===step.attemptCount&&o.number>step.resumeFromAttempt
            &&['EXECUTANDO','PENDENTE','AGUARDANDO_RECURSO'].includes(step.status)&&['EXECUTANDO','AGUARDANDO_RECURSO'].includes(job.status)
            &&canReplayAttempt(journal)){
            await tx.attempt.update({where:{id:o.id},data:{workerId}});
            await tx.step.update({where:{id:step.id},data:{status:'EXECUTANDO',statusDetail:'retomando recibo persistido'}});
            return {count:0,detail:null,replay:{...o,workerId}};
          }
        }
        for(const o of current){
          if(o.hostname!==os.hostname()){unsafe.push('#'+o.number+': host diferente ou não identificado');continue;}
          const journal=readAttemptJournal(o.executionState);
          if(o.executionState!=null&&!journal){unsafe.push('#'+o.number+': diário de execução inválido ou de versão desconhecida');continue;}
          if(journal?.phase==='PREPARED')continue; // no provider dispatch authorized yet
          if(journal){
            // A phase in flight has no trustworthy completion receipt. Never
            // redispatch, repeat a verification, or publish from an unknown state.
            if(o.pid){
              const state=await stopOwnedOrphan(o.pid,o.processIdentity);
              if(state==='uncertain'||state==='owned'){unsafe.push('#'+o.number+': '+journal.phase+'; grupo ainda não reconciliado');continue;}
            }
            if(o.pid&&journal.phase==='DISPATCHING'&&['local-shell','claude-code-cli','codex-cli'].includes(o.provider.split('--')[0])&&!durableMediaOutputs(job,step).length&&(o.provider!=='local-shell'||!evaluatePolicy(step.instructions).requiresApproval)){
              // The owned process group is gone and the worktree remains.
              // A local/CLI session can continue from files; a remote paid
              // request with unknown outcome must not be blindly repeated.
              continue;
            }
            // Keep unresolved identity/receipt discoverable on every resume.
            // Do not mark an uncertain operation terminal merely to unblock the queue.
            await tx.attempt.updateMany({where:{id:o.id,status:'EXECUTANDO'},data:{error:'recibo preservado; reconciliação necessária na fase '+journal.phase}});
            unsafe.push('#'+o.number+': fase '+journal.phase+' sem retomada automática comprovada'+(journal.costKnown===false?'; custo não informado':''));
            continue;
          }
          if(o.pid){
            const state=await stopOwnedOrphan(o.pid,o.processIdentity);
            if(state==='uncertain'||state==='owned')unsafe.push('#'+o.number+': grupo de processos não confirmado como encerrado');
          }else if(!['nvidia-api','openrouter-free-api','groq-free-api'].includes(tipoDe(o.provider)??'')){
            unsafe.push('#'+o.number+': processo não registrado; resultado anterior incerto');
          }
        }
        if(unsafe.length){
          const detail='Recuperação pendente: '+unsafe.join('; ')+'. Arquivos e recibos preservados; reconcilie a fase anterior antes de retomar.';
          await tx.step.updateMany({where:{id:step.id,status:{not:'CONCLUIDO'}},data:{status:'BLOQUEADO',statusDetail:detail}});
          await tx.job.updateMany({where:{id:job.id,status:{in:['EXECUTANDO','AGUARDANDO_RECURSO']}},data:{status:'BLOQUEADO',blockedReason:'FALHA_INFRAESTRUTURA',statusDetail:detail}});
          await tx.queueTask.updateMany({where:{id:task.id,claims:task.claims,lockedBy:workerId,status:'RUNNING'},data:{status:'DONE',lockedUntil:null,lastError:detail}});
          return {count:0,detail};
        }
        const changed=await tx.attempt.updateMany({where:{id:{in:current.map(o=>o.id)},status:'EXECUTANDO'},data:{status:'INTERROMPIDA',endedAt:new Date(),error:'worker anterior perdeu lease; custo/resultado não confirmados'}});
        await tx.step.updateMany({where:{id:step.id,status:'EXECUTANDO'},data:{status:'PENDENTE'}});
        return {count:changed.count,detail:null};
      }).catch(e=>{if(e instanceof LostStepLease)return null;throw e;});
      if(!recovery)return 'INTERROMPIDO';
      if(recovery.detail){await L(recovery.detail,'WARN');return 'BLOQUEADO';}
      replay=recovery.replay??null;
      await L('Recuperação: '+recovery.count+' tentativa(s) órfã(s) reconciliada(s); arquivos e checkpoints preservados.','WARN');
    }

    if (!['EXECUTANDO', 'AGUARDANDO_RECURSO'].includes(job.status)) {
      await this.queue.complete(task.id, workerId, task.claims);
      return 'IGNORADO';
    }
    if (step.status === 'CONCLUIDO') {
      await this.queue.complete(task.id, workerId, task.claims);
      await this.orchestrator.scheduleReady(job.id);
      return 'IGNORADO';
    }

    let egm:ApprovedGoldfishResolution|null=null;
    try{
      egm=approvedGoldfish(job.approvedScope);
      if(egm){
        checkApprovedGoldfishStep(egm,step);
        const repo=this.workspace.projectDirs(job.project.dirKey).repo;
        const drift=await detectGoldfishGitDrift(repo,egm.revision,egm.targetPath,signal);
        if(signal.aborted)return 'INTERROMPIDO';
        if(drift.status!=='unchanged')throw Error(renderGoldfishGitDrift(drift)+'\nEvidências precisam ser reconciliadas antes de continuar.');
      }
    }catch(e){return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,(e as Error).message);}
    if(replay){
      const journal=readAttemptJournal(replay.executionState);
      const existing=path.join(this.workspace.projectDirs(job.project.dirKey).worktrees,job.id);
      let valid=false;
      if(canReplayAttempt(journal)&&journal.replay.input.providerId===replay.provider&&journal.replay.contract===attemptContract(job,step,replay.provider)
        &&fs.existsSync(path.join(existing,'.git'))){
        try{
          await this.prisma.$transaction(tx=>assertStepLease(tx,task,workerId));
          valid=journal.replay.head===await this.workspace.headCommit(existing)
            &&(journal.phase==='RESTORING'?journal.finalization?.sourceHash===await this.workspace.snapshotHash(existing,true):journal.replay.tree===await this.workspace.snapshotHash(existing))
            &&journal.replay.notes===await replayAuxFingerprint(path.join(existing,'.nivoo'))
            &&journal.replay.context===await replayAuxFingerprint(path.join(existing,'contexto'))
            &&journal.replay.knowledge===await replayAuxFingerprint(this.workspace.projectDirs(job.project.dirKey).knowledge);
        }catch(e){if(e instanceof LostStepLease)return 'INTERROMPIDO';valid=false;}
      }
      if(!valid||!canReplayAttempt(journal)){
        return this.reconcileReceiptConflict(task,workerId,job,step,replay,'Recibo da tentativa anterior existe, mas o contrato ou os arquivos não correspondem ao estado registrado. Não repetir a sessão automaticamente.');
      }
      await L('RETOMADA DO RECIBO: tentativa #'+replay.number+' na fase '+journal.phase+'; nenhuma nova sessão do provedor.','INFO',replay.id);
      return this.finishAttempt(task,workerId,signal,job,step,replay,existing,journal.replay.input,journal.phase,journal.finalization);
    }
    const mediaRecovery=await recoverRenderedOutput(this.prisma,job,step,this.pastaDeMidia(job.project.dirKey));
    if(mediaRecovery.kind==='recovered'){
      await L('RECUPERAÇÃO SEM REFAZER: MP4 do mesmo produtor e tentativa, hash e contrato técnico válidos. '+mediaRecovery.detail,'WARN');
      await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,job.id);await assertStepLease(tx,task,workerId);await tx.step.update({where:{id:step.id},data:{status:'CONCLUIDO',statusDetail:'MP4 recuperado de tentativa anterior; sem rerenderizar'}});});
      await this.queue.complete(task.id, workerId, task.claims);
      await this.orchestrator.scheduleReady(job.id);
      return 'CONCLUIDO';
    }
    if(mediaRecovery.kind==='conflict')return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,mediaRecovery.detail);

    // Crash between persistence of SUCESSO and the checkpoint transaction.
    // Only the latest verified attempt, in the same execution epoch and
    // unchanged worktree, may advance without invoking the provider again.
    if(!orphanRows.length&&['EXECUTANDO','PENDENTE','AGUARDANDO_RECURSO'].includes(step.status)&&step.attemptCount>step.resumeFromAttempt){
      const last=await this.prisma.attempt.findFirst({where:{stepId:step.id,jobId:job.id},orderBy:{number:'desc'}});
      if(last?.status==='SUCESSO'&&last.number===step.attemptCount&&last.treeAfter){
        const existing=path.join(this.workspace.projectDirs(job.project.dirKey).worktrees,job.id);
        if(durableMediaOutputs(job,step).length||(step.provider??job.defaultProvider)==='arquivos-projeto'){
          return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,'Tentativa anterior registrada; o estado do resultado durável não foi confirmado. Arquivos preservados; não repetir automaticamente.');
        }
        if(fs.existsSync(path.join(existing,'.git'))){
          const current=await this.workspace.snapshotHash(existing).catch(()=>null);
          if(current===last.treeAfter){
            const commit=await saveCheckpoint(this.prisma,this.workspace,job.id,step,existing,'finalização recuperada da tentativa '+last.number,{tentativa:last.number,recuperacao:true,notas:last.notesIngested},true,{task,workerId});
            if(commit){
              await L('RECUPERAÇÃO SEM REFAZER: tentativa já verificada, estado dos arquivos idêntico; checkpoint concluído sem nova sessão.','INFO',last.id);
              await this.queue.complete(task.id, workerId, task.claims);
              await this.orchestrator.scheduleReady(job.id);
              return 'CONCLUIDO';
            }
          }
        }
        return this.blockJob(task,workerId,job,step,BlockedReason.FALHA_INFRAESTRUTURA,'Tentativa anterior já verificada, mas o checkpoint ou estado dos arquivos não pôde ser confirmado. Resultado preservado; confira o diagnóstico antes de repetir.');
      }
    }

    // Corrige jobs já gravados sem dependsOn: o orquestrador só consegue
    // respeitar dependências presentes no banco. Se uma cena do juntar-videos
    // está sendo produzida por nivoo-renderizar-motion no MESMO trabalho, não
    // iniciar FFmpeg antes de o produtor concluir — sem criar tentativa/falha.
    if ((step.provider ?? job.defaultProvider) === 'juntar-videos') {
      const etapas = await this.prisma.step.findMany({
        where: { jobId: job.id },
        select: { key: true, status: true, provider: true, instructions: true, dependsOn: true, providerOptions: true },
      });
      const normalizadas = dependenciasDeMontagemPorArquivo(etapas, job.defaultProvider) as Array<{ key: string; dependsOn: string[] }>;
      const montagem = normalizadas.find((s) => s.key === step.key);
      const pendentes = (montagem?.dependsOn ?? step.dependsOn).filter((key) =>
        etapas.some((s) => s.key === key && s.status !== 'CONCLUIDO'));
      if (pendentes.length) {
        if (montagem && montagem.dependsOn.some((key) => !step.dependsOn.includes(key))) {
          await this.prisma.$transaction(async (tx) => {
            await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
            await tx.step.update({
              where: { id: step.id },
              data: { dependsOn: montagem.dependsOn, status: 'PENDENTE', statusDetail: 'aguardando renderização das cenas antes de montar trilha' },
            });
          });
        }
        await L(`Montagem aguardando ${pendentes.join(', ')} produzir o vídeo mudo; sem tentar FFmpeg ou gastar IA.`);
        await this.queue.complete(task.id, workerId, task.claims);
        await this.orchestrator.scheduleReady(job.id);
        return 'CONTINUA';
      }
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
    // Não abortar por quantidade TOTAL de tentativas: uma correção pode
    // expor um defeito diferente. Somente repetição da mesma causa deve travar.
    const failures = await this.prisma.attempt.count({
      where: { stepId: step.id, status: 'FALHA', number: { gt: step.resumeFromAttempt } },
    });

    // Política: ações destrutivas só com aprovação do usuário.
    // Só o que roda como comando: instrução de IA é texto ("não use rm -rf" não é ação destrutiva).
    const pol = evaluatePolicy(`${(step.provider ?? job.defaultProvider) === "local-shell" ? step.instructions : ""}\n${step.verifyCommand ?? ''}`);
    let durableFileApproval=false;
    if((step.provider??job.defaultProvider)==='arquivos-projeto'){
      try{durableFileApproval=operationsNeedApproval(validateFileOperations(step.providerOptions));}
      catch(e){return this.blockJob(task,workerId,job,step,BlockedReason.POLITICA,'Operações de arquivo inválidas: '+String((e as Error).message));}
    }
    if (step.requiresApproval || pol.requiresApproval || durableFileApproval) {
      // A aprovação vale só para o conteúdo exato que foi aprovado (hash das instruções + verificação).
      const approved = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'APROVADO', subjectHash: stepHash({...step,provider:step.provider??job.defaultProvider}) } });
      if (!approved) {
        const ops = (step.provider ?? job.defaultProvider) === 'arquivos-projeto' ? descreverOperacoes((step.providerOptions ?? {}) as never) : '';
        if ((step.provider ?? job.defaultProvider) === 'gemini-image') return this.awaitApproval(task, workerId, job, step, ['Geração de imagem pela API Gemini, com cobrança por uso'], 'Autoriza gerar esta imagem com Nano Banana pela API paga do Gemini?');
        return this.awaitApproval(task, workerId, job, step, ops ? [ops] : pol.reasons, ops ? `Confirma ${ops}? ${durableFileApproval?'Inclui arquivos fora do Git; exclusões podem ser irreversíveis.':'O histórico Git preserva arquivos versionados.'}` : undefined);
      }
    }

    // Vídeo gera quadros, intermediários e snapshots: numa partição com
    // apenas ~2 GiB livres o FFmpeg/artefatos derrubaram o PostgreSQL (ENOSPC).
    // Não iniciar captura ou render até haver reserva para os temporários.
    const providerId = step.provider ?? job.defaultProvider;
    const nativeVisual=nativeImageTarget((step.providerOptions as Record<string,unknown>|null)?.visualAsset);
    if(nativeVisual&&!isCodexAccount(providerId))return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,'A etapa de ImageGen exige a conexão Codex por conta; não substitua por outro provedor.');
    if (providerId !== 'local-shell' && providerId !== 'gemini-video' &&
        mediaEnabledForArea(job.project.area) && etapaPedeRenderizacaoMotion(step)) {
      // Compatibilidade com planos antigos: não cobrar outra sessão de IA nem
      // aceitar vídeo velho só porque test -s encontra um arquivo antigo.
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        'Plano inválido: etapa de renderização motion atribuída a ' + providerId +
        '. Essa IA não executou o renderizador; MP4 previamente existente não comprova nova renderização. ' +
        'Use uma etapa local-shell com nivoo-renderizar-motion e fonte real motion/<pasta>. ' +
        'O vídeo e os arquivos existentes foram preservados.');
    }
    if (providerId === 'local-shell' && (hasMotionCommand(step.instructions)||/\bnivoo-conferir-arte\b/.test(step.instructions))) {
      const espaco = armazenamentoDisponivel(['/', this.workspace.projectDirs(job.project.dirKey).root, appConfig().artifactsRoot], MIN_FREE_VIDEO_BYTES);
      if (!espaco.ok) {
        const gb = ((espaco.livre ?? 0) / (1024 ** 3)).toFixed(2);
        return this.blockJob(task, workerId, job, step, BlockedReason.FALHA_INFRAESTRUTURA,
          `Pouco espaço livre (${gb} GiB em ${espaco.pasta}). Para captura/render de vídeo, reserve pelo menos 4 GiB livres; nada foi excluído. Libere espaço e clique Continuar; composição e trabalho preservados.`);
      }
    }
    const status = await this.registry.status(providerId, 15_000);
    if (!status.available) {
      const retryAfter = Number(status.limits?.retryAfterMs);
      return this.awaitResource(task, workerId, job, step,
        `${providerId} indisponível: ${status.errors.join('; ') || 'sem detalhes'}`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,signal);
    }

    let effectiveModel:string|undefined;
    try{
      effectiveModel=selectedModel(projectModel(job.project,providerId),step.providerOptions);
      const assessment=assessModel(providerId,effectiveModel,status,step.providerOptions);
      if(assessment.state==='incompatible'){
        const detail='Modelo '+(assessment.model??'padrão')+' incompatível com a etapa em '+providerId+': '+assessment.reason;
        const switched=await this.tryReserve(task,workerId,job,step,detail,signal,false);
        if(switched)return switched;
        if(signal.aborted)return 'INTERROMPIDO';
        return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,detail+'. Nenhuma reserva compatível encontrada; arquivos preservados.');
      }
      if(status.kind!=='executor')await L('Capacidade do modelo '+(assessment.model??'padrão do CLI')+': '+assessment.state+' — '+assessment.reason,'INFO');
    }catch(e){return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,(e as Error).message);}

    // Etapa paga por uso (vídeo): o custo estimado não pode estourar o limite do trabalho nem o do projeto.
    const estimador = this.registry.get(providerId) as unknown as { estimarCusto?: (o: Record<string, unknown>) => number };
    if (estimador.estimarCusto) {
      const estimado = estimador.estimarCusto({ ...((step.providerOptions ?? {}) as Record<string, unknown>), model:effectiveModel });
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
    let worktree:string;
    try{worktree=egm?await this.workspace.ensureJobWorktree(job.project.dirKey,job.id,egm.revision):await this.workspace.ensureJobWorktree(job.project.dirKey,job.id);}
    catch(e){if(!egm)throw e;return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,(e as Error).message);}
    const previous=orphanRows.length?[...orphanRows].sort((a,b)=>b.number-a.number)[0]:
      step.attemptCount>0?await this.prisma.attempt.findFirst({where:{stepId:step.id,jobId:job.id,number:step.attemptCount,status:'INTERROMPIDA'}}):null;
    if(previous){
      const recoveredNotes=await ingestNotes(this.prisma,this.workspace,this.logs,job,step,previous.id,worktree,previous.provider,previous.sessionId??undefined,[],{task,workerId});
      await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,job.id);await assertStepLease(tx,task,workerId);await tx.attempt.update({where:{id:previous.id},data:{notesIngested:recoveredNotes}});});
      const saved=await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'recuperação após interrupção da sessão',{tentativa:previous.number,notas:recoveredNotes,recuperacao:true},false,{task,workerId});
      await L(saved?'Checkpoint da interrupção preservado; retomando arquivos existentes.':'Git não confirmou o checkpoint da interrupção; arquivos existentes preservados no worktree.',saved?'INFO':'WARN');
    }

    // Recuperação de composições JÁ ESCRITAS e bloqueadas pelo antigo
    // nivoo-conferir-motion: ao clicar Continuar, NÃO abrir outra IA nem
    // obrigar retrabalho. A próxima etapa local renderiza a obra preservada.
    const antigoConferir = /\bnivoo-conferir-motion\s+(motion\/[A-Za-z0-9._/-]+)\s+--modo\s+(hybrid|scene)\b/
      .exec(step.verifyCommand ?? '');
    if (!nativeVisual && this.registry.get(providerId).kind !== 'executor' && antigoConferir) {
      const anterior = await this.prisma.attempt.findFirst({
        where: {stepId:step.id, status:'SESSAO_ENCERRADA'},
        orderBy:{number:'desc'}, select:{error:true},
      });
      if (anterior?.error?.includes('MOTION_CONTRATO:')) {
        const pasta=path.resolve(worktree,antigoConferir[1]);
        const within=pasta.startsWith(path.resolve(worktree)+path.sep);
        const required=[...String(step.verifyCommand??'').matchAll(/\btest\s+-s\s+(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9._/-]+))/g)]
          .map(m=>m[1]??m[2]??m[3]);
        const exists=(file:string)=>{try{return fs.statSync(file).size>0;}catch{return false;}};
        const fontes=antigoConferir[2]==='hybrid'
          ? ['index.html','overlays.json'] : ['scene.json'];
        if (within && fontes.every(name=>exists(path.join(pasta,name))) &&
          required.every(rel=>{
            const full=path.resolve(worktree,rel);
            return full.startsWith(path.resolve(worktree)+path.sep) && exists(full);
          })) {
          await L('RECUPERAÇÃO SEM REFAZER: a IA já entregou a composição e os arquivos previstos. '+
            'A reprovação ocorreu somente no aprovador Motion antigo. '+
            'Avançando à renderização existente, sem outra sessão ou consumo de tokens.', 'WARN');
          await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree,
            'composição recuperada; aprovador Motion removido',{recuperacao:true},false,{task,workerId});
          await this.prisma.step.update({where:{id:step.id},data:{
            status:'CONCLUIDO',statusDetail:'Composição existente recuperada sem nova IA',
          }});
          await this.queue.complete(task.id, workerId, task.claims);
          await this.orchestrator.scheduleReady(job.id);
          return 'CONCLUIDO';
        }
        await L('Arquivos da composição parcialmente disponíveis; não os apagarei nem farei nova conferência artística.', 'WARN');
      }
    }

    const knowledgeDir = this.workspace.projectDirs(job.project.dirKey).knowledge;
    const outputDir = path.join(worktree, 'out');

    const isAi = provider.kind !== 'executor';
    // Pré-conferência determinística: os PNGs exigidos pelo plano vêm do MP4
    // permanente e devem ser extraídos pelo backend, ANTES de gastar sessões de IA.
    // A composição/renderização já aprovada não é repetida.
    if (isAi && !nativeVisual && quadrosRequeridos(step.verifyCommand ?? '').length) {
      const etapas = await this.prisma.step.findMany({
        where: { jobId: job.id, provider: 'local-shell' },
        orderBy: { order: 'asc' },
        select: { instructions: true },
      });
      const saidas=etapas.flatMap(s=>readMotionInvocations(s.instructions).flatMap(op=>op.output?[op.output]:[]));
      const publicadas = await this.prisma.artifact.findMany({
        where: { jobId: job.id, mimeType: 'video/mp4' },
        orderBy: { createdAt: 'asc' },
        select: { name: true },
      });
      const frames = await prepararQuadrosDoVideo(
        worktree, this.pastaDeMidia(job.project.dirKey), step.verifyCommand ?? '',
        [...publicadas.map(a => a.name), ...saidas],
      );
      if (frames.erro) {
        await L('Extração de quadros do MP4 pelo backend falhou: ' + frames.erro, 'ERROR');
        return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL, frames.erro);
      }
      if (frames.gerados.length) await L('Quadros extraídos do MP4 existente pelo backend (sem IA, sem renderização): ' + frames.gerados.join(', '));
    }
    // Preflight antes de criar attempt ou gastar tokens: geração de imagem via
    // skill do CLI não garante um PNG gravado na pasta que o teste exige.
    if (isAi) {
      const blocked = checkGeneratedImageOutputs(step, providerId, worktree);
      if (blocked) return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL, blocked);
    }
    const {protectedBefore,repoHarness,docsPendentes}=await prepareExecutionWorkspace(this.prisma,this.workspace,this.artifacts,job,step,providerId,isAi,worktree,knowledgeDir,L);
    const treeBefore = await this.workspace.snapshotHash(worktree);
    const repairBefore=isRepairStep(step.key)?await this.workspace.repairSourceHash(worktree):null;

    const number = (await this.prisma.attempt.count({ where: { stepId: step.id } })) + 1;
    const attempt = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.job.updateMany({ where: { id: job.id, status: 'AGUARDANDO_RECURSO' }, data: { status: 'EXECUTANDO', statusDetail: null } });
      await tx.step.update({ where: { id: step.id }, data: { status: 'EXECUTANDO', statusDetail: null, attemptCount: number } });
      return tx.attempt.create({ data: { jobId: job.id, stepId: step.id, number, provider: providerId, workerId, hostname: os.hostname(), treeBefore,executionState:{version:1,phase:'PREPARED'} } });
    });
    await L(`Tentativa #${number} da etapa "${step.key}" com ${providerId}${isAi ? ' (nova sessão de IA)' : ''}`, 'INFO', attempt.id);

    const {profileText,context,stats:contextStats}=await prepareExecutionPrompt(isAi,
      async()=> (await this.profiles.build(job.projectId,readApprovedScope(job.approvedScope,job.projectId)?.visual)).text,
      profile=>this.buildContext(job,step,profile,worktree),
      ()=>[...this.workspace.docsEditaveis(repoHarness),...docsPendentes.keys()]);
    // O prompt exato de cada sessão é guardado: prova do contexto recebido (objetivo, notas, evidências).
    const promptArt = await this.artifacts.storeContent(
      { projectId: job.projectId, jobId: job.id, stepId: step.id, attemptId: attempt.id, name: `prompts/${step.key}/tentativa-${number}.md`, kind: 'PROMPT' },
      isAi ? buildPrompt({ context, instructions: step.instructions }) : step.instructions,{task,workerId},
    );
    if(contextStats)contextStats.promptChars=buildPrompt({context,instructions:step.instructions,systemPrompt:profileText}).length;
    await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,job.id);await assertStepLease(tx,task,workerId);await tx.attempt.update({ where: { id: attempt.id }, data: { promptArtifactId: promptArt.id, contextStats: contextStats ? contextStats as unknown as Prisma.InputJsonValue : Prisma.DbNull } });});
    if(contextStats?.skillIds?.length){
      await L('Skills v'+contextStats.skillsVersion+' — orientações selecionadas para o contexto desta sessão: '+contextStats.skillIds.join(', ')+'; seleção não comprova aplicação nem revisão independente.','INFO',attempt.id);
    }
    if (contextStats) {
      await L(`Orçamento de contexto: ${contextStats.totalChars}/${contextStats.budgetChars} caracteres; ${contextStats.memoryOmitted} entrada(s) omitidas, ${contextStats.memoryTruncated??0} abreviadas; prompt-base ${contextStats.promptChars} caracteres (memória integral em .nivoo/memoria.md; não é contagem de tokens)`, 'INFO', attempt.id);
    }
    if(contextStats?.egmExecution)await L('Elephant: rota '+contextStats.egmExecution.route+'; checklist '+contextStats.egmExecution.scopeHash.slice(0,12)+'; base '+(contextStats.egmExecution.baseline.commit??'não comprovada')+'; Goldfish não executado nesta sessão.','INFO',attempt.id);
    if(contextStats?.leanExecution)await L(`Execução enxuta aplicada: ${contextStats.memoryPromptChars} caracteres de memória e ${contextStats.artifactPromptChars} de artefatos no contexto; acervo integral disponível sob demanda.`, 'INFO', attempt.id);
    const timeoutMs=executionTimeoutMs(job,providerId,step.instructions);
    const mediaBefore=captureMediaOutputs(job,step,this.pastaDeMidia(job.project.dirKey));
    const started = Date.now();
    if(signal.aborted)return 'INTERROMPIDO';
    await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'PREPARED',{version:1,phase:'DISPATCHING'});
    const result=await dispatchExecution(this.prisma,this.logs,this.registry,provider,providerId,job,step,attempt,worktree,outputDir,this.pastaDeMidia(job.project.dirKey),context,profileText,timeoutMs,signal,started,contextStats);
    if(typeof result.costUsd!=='number'||!Number.isFinite(result.costUsd)||result.costUsd<0)delete result.costUsd;
    const input:AttemptReplayInput={providerId,isAi,nativeVisual:!!nativeVisual,protectedBefore,repoHarness,
      docsPendentes:[...docsPendentes].map(([key,value])=>[key,value.toString('base64')]),
      treeBefore,repairBefore,contextStats,effectiveModel:effectiveModel??null,failures,mediaBefore:[...mediaBefore],
      result,activeMs:Math.max(0,Date.now()-started)};
    // Cost and provider receipt become durable before any verification or artifact publication.
    // A receipt with no replay envelope is still useful for reconciliation and accounting.
    await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'DISPATCHING',{
      version:1,phase:'RETURNED',costKnown:typeof result.costUsd==='number'&&Number.isFinite(result.costUsd),
      activeMs:input.activeMs,result
    });
    const returnedReplay=await this.replayEnvelope(job,step,worktree,input);
    if(returnedReplay)await attachAttemptReplay(this.prisma,task,workerId,attempt.id,'RETURNED',returnedReplay);
    return this.finishAttempt(task,workerId,signal,job,step,attempt,worktree,input,'RETURNED');
  }

  private async replayEnvelope(job:ExecutionJob,step:Step,worktree:string,input:AttemptReplayInput){
    // Scope of automatic replay: ordinary isolated workspaces only. Native
    // media, external file operations and destructive verification need their
    // own durable output contracts; never infer those from a Git tree.
    if(hasNativeMediaOperation([step],job.defaultProvider)
      ||input.nativeVisual||input.mediaBefore.length||(!input.isAi&&input.providerId!=='local-shell')
      ||step.requiresApproval||evaluatePolicy((input.isAi?'':step.instructions)+'\n'+(step.verifyCommand??'')).requiresApproval)return null;
    try{
      const notes=await replayAuxFingerprint(path.join(worktree,'.nivoo'));
      const context=await replayAuxFingerprint(path.join(worktree,'contexto'));
      const knowledge=await replayAuxFingerprint(this.workspace.projectDirs(job.project.dirKey).knowledge);
      if(!notes||!context||!knowledge)return null;
      return makeReplayEnvelope({
        contract:attemptContract(job,step,input.providerId),head:await this.workspace.headCommit(worktree),
        tree:await this.workspace.snapshotHash(worktree),notes,context,knowledge,input
      });
    }catch{return null;}
  }

  private async reconcileReceiptConflict(task:ClaimedTask,workerId:string,job:Job,step:Step,attempt:Attempt,detail:string):Promise<StepOutcome>{
    await this.prisma.$transaction(async tx=>{
      await OrchestratorService.lockJob(tx,job.id);
      await assertStepLease(tx,task,workerId);
      await tx.attempt.updateMany({where:{id:attempt.id,status:'EXECUTANDO',workerId},data:{status:'INTERROMPIDA',endedAt:new Date(),error:detail}});
      await tx.step.updateMany({where:{id:step.id,status:'EXECUTANDO'},data:{status:'BLOQUEADO',statusDetail:detail}});
      await tx.job.updateMany({where:{id:job.id,status:{in:['EXECUTANDO','AGUARDANDO_RECURSO']}},data:{status:'BLOQUEADO',blockedReason:'FALHA_INFRAESTRUTURA',statusDetail:detail}});
      await tx.queueTask.update({where:{id:task.id},data:{status:'DONE',lockedUntil:null,lastError:detail}});
    });
    await this.logs.log(job.id,detail,{level:'WARN',stepId:step.id,attemptId:attempt.id,source:'worker'});
    return 'BLOQUEADO';
  }

  /** Shared normal/recovery path: a RETURNED receipt continues at the existing
   * verification; a VERIFIED receipt continues at the existing finalization.
   * No extra provider session or duplicate verification is introduced. */
  private async finishAttempt(task:ClaimedTask,workerId:string,signal:AbortSignal,job:ExecutionJob,step:Step,
    attempt:Attempt,worktree:string,input:AttemptReplayInput,phase:'RETURNED'|'VERIFIED'|'PUBLISHING'|'RESTORING'|'FINALIZING',savedPlan?:FinalizationPlan):Promise<StepOutcome>{
    const {providerId,isAi,nativeVisual,protectedBefore,repoHarness,treeBefore,repairBefore,contextStats,failures}=input;
    const effectiveModel=input.effectiveModel??undefined;
    const docsPendentes=new Map(input.docsPendentes.map(([key,value])=>[key,Buffer.from(value,'base64')]));
    const mediaBefore=new Map(input.mediaBefore);
    const number=attempt.number;
    const knowledgeDir=this.workspace.projectDirs(job.project.dirKey).knowledge;
    const outputDir=path.join(worktree,'out');
    const L=(msg:string,level:'INFO'|'WARN'|'ERROR'='INFO',attemptId?:string)=>this.logs.log(job.id,msg,{stepId:step.id,attemptId,level,source:'worker:'+workerId});
    const started=Date.now()-input.activeMs;
    let result=input.result;
    let beforeVerification:ExecutionResult;
    let verification:Awaited<ReturnType<typeof verifyExecution>>;
    let verified:boolean;
    let sessionClosedNormally:boolean;
    if(signal.aborted)return 'INTERROMPIDO';
    if(phase==='RETURNED'){
      await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'RETURNED',{version:1,phase:'VERIFYING',activeMs:input.activeMs});


    const owned=await this.prisma.$transaction(async tx=>{await assertStepLease(tx,task,workerId);return true;}).catch(e=>{if(e instanceof LostStepLease)return false;throw e;});
    if(!owned)return 'INTERROMPIDO';
    if (isAi && !result.interrupted) {
      // Remoções/movimentações pedidas pela IA (.nivoo/remover.txt): o sistema faz por ela, ANTES da conferência.
      const rem = this.workspace.aplicarRemocoesPedidas(worktree, this.pastaDeMidia(job.project.dirKey));
      if (rem.feitos.length) await L(`Pedido da IA: ${rem.feitos.length} item(ns) apagado(s)/movido(s): ${rem.feitos.slice(0, 50).join(', ')}`, 'INFO', attempt.id);
      if (rem.recusados.length) await L(`Pedidos de remoção recusados (caminho inválido, protegido ou inexistente): ${rem.recusados.slice(0, 30).join('; ')}`, 'WARN', attempt.id);
    }
    const normalizedSession=normalizeSessionResult(result,isAi);
    result=normalizedSession.result;
    sessionClosedNormally=normalizedSession.sessionClosedNormally;
    beforeVerification={...result};
    let processWrite=Promise.resolve();
    verification=await verifyExecution(job,step,providerId,isAi,result,worktree,outputDir,this.pastaDeMidia(job.project.dirKey),attempt,signal,L,pid=>{
      const identity=processIdentity(pid);
      processWrite=processWrite.then(async()=>{await this.prisma.attempt.updateMany({where:{id:attempt.id,status:'EXECUTANDO',workerId},data:{pid,processIdentity:identity??Prisma.DbNull}});}).catch(()=>undefined);
    });
    await processWrite;
    result=verification.result;
    verified=verification.verified;
    // Uma revisão não pode ser aprovada com os PNG anteriores à última
    // alteração no HTML. Mesmo se a IA marcar conforme=true, a composição
    // alterada precisa ser recapturada pelo local-shell antes da aprovação.
    if (verified && !nativeVisual && /^direcao-arte-/.test(step.key)) {
      const capturas = await this.prisma.step.findMany({
        where: { jobId: job.id },
        select: { key: true, provider: true, instructions: true, status: true },
      });
      const desatualizadas = capturasParaRecuperar(worktree, step, capturas);
      if (desatualizadas.length) {
        verified = false;
        result = { ...result, error: `Parecer anterior às alterações da composição: recaptura local necessária em ${desatualizadas.join(', ')}; não aprovar os PNGs antigos` };
        await L(`Revisão não aprovada com quadros antigos; capturas vencidas: ${desatualizadas.join(', ')}`, 'WARN', attempt.id);
      }
    }
    const stillOwned=await this.prisma.$transaction(async tx=>{await assertStepLease(tx,task,workerId);return true;}).catch(e=>{if(e instanceof LostStepLease)return false;throw e;});
    if(!stillOwned)return 'INTERROMPIDO';
      const verifiedInput:AttemptReplayInput={...input,result,beforeVerification,verification,verified,sessionClosedNormally,activeMs:Math.max(0,Date.now()-started)};
      await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'VERIFYING',{
        version:1,phase:'VERIFIED',activeMs:verifiedInput.activeMs,
        verification:verification.skillVerification,verified,result
      });
      const verifiedReplay=await this.replayEnvelope(job,step,worktree,verifiedInput);
      if(verifiedReplay)await attachAttemptReplay(this.prisma,task,workerId,attempt.id,'VERIFIED',verifiedReplay);
    }else{
      if(!input.beforeVerification||!input.verification||typeof input.verified!=='boolean'||typeof input.sessionClosedNormally!=='boolean')
        return this.reconcileReceiptConflict(task,workerId,job,step,attempt,'Recibo da conferência incompleto; resultado preservado.');
      beforeVerification=input.beforeVerification;
      verification=input.verification;
      verified=input.verified;
      sessionClosedNormally=input.sessionClosedNormally;
    }
    const {falhaTecnicaDaMidia,faltaPrograma,ambiente,credencialFaltando}=verification;
    if(signal.aborted)return 'INTERROMPIDO';
    const lease={task,workerId};
    const elapsedSec = Math.ceil((Date.now() - started) / 1000);
    let plan:FinalizationPlan;
    let logArt:{id:string;name:string},outputs:{id:string;name:string;sha256:string}[],videos:{id:string;name:string;sha256:string}[];
    const alreadyRestoring=phase==='RESTORING'||phase==='FINALIZING';
    const alreadyRestored=phase==='FINALIZING';
    if(alreadyRestoring){
      if(!validFinalizationPlan(savedPlan))throw Error('Plano de finalização incompleto; arquivos preservados.');
      plan=savedPlan;
      const ids=[plan.logId,...plan.outputIds,...plan.videoIds];
      const rows=await this.prisma.artifact.findMany({where:{id:{in:ids},projectId:job.projectId,jobId:job.id,stepId:step.id,attemptId:attempt.id},select:{id:true,name:true,sha256:true}});
      const byId=new Map(rows.map(a=>[a.id,a]));
      if(ids.some(id=>!byId.has(id)))return this.reconcileReceiptConflict(task,workerId,job,step,attempt,'Registros da publicação anterior estão incompletos. Não repetir a sessão.');
      logArt=byId.get(plan.logId)!;outputs=plan.outputIds.map(id=>byId.get(id)!);videos=plan.videoIds.map(id=>byId.get(id)!);
    }else{
      if(phase!=='PUBLISHING')await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'VERIFIED',{version:1,phase:'PUBLISHING',activeMs:Math.max(0,Date.now()-started)});
      logArt=await this.artifacts.storeContent({projectId:job.projectId,jobId:job.id,stepId:step.id,attemptId:attempt.id,name:`logs/${step.key}/tentativa-${number}.log`,kind:'LOG'},
        `${result.output}\n${result.error?`\n[erro] ${result.error}\n`:''}`,lease);
      outputs=await this.artifacts.collectOutputs({projectId:job.projectId,jobId:job.id,stepId:step.id,attemptId:attempt.id},outputDir,lease);
      if(outputs.length)await L('Artefatos registrados: '+outputs.map(a=>a.name+' (sha256 '+a.sha256.slice(0,12)+')').join(', '),'INFO',attempt.id);
      videos=await publishAttemptMedia(this.artifacts,job,step,attempt.id,this.pastaDeMidia(job.project.dirKey),mediaBefore,result,verified,lease);
      if(videos.length)await L('Vídeo(s) disponível(is): '+videos.map(v=>v.name).join(', '),'INFO',attempt.id);
      const editados=isAi?this.workspace.capturarDocsEditados(worktree,this.workspace.docsNoTrabalho(worktree)):new Map<string,Buffer>();
      if(isAi)for(const [rel,c] of docsPendentes)if(!editados.has(rel))editados.set(rel,c);
      // Persist the actual bytes before any deletion or Git checkout. A
      // recovery never recaptures an already partially restored document.
      plan={logId:logArt.id,outputIds:outputs.map(a=>a.id),videoIds:videos.map(v=>v.id),
        remove:isAi?this.workspace.listHarnessFiles(worktree):[],
        docs:[...editados].map(([rel,c])=>[rel,c.toString('base64')]),
        sourceHash:await this.workspace.snapshotHash(worktree,true)};
      if(signal.aborted)return 'INTERROMPIDO';
      await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'PUBLISHING',{version:1,phase:'RESTORING',finalization:plan,activeMs:Math.max(0,Date.now()-started)});
    }
    if (protectedBefore !== null) {
      const protectedAfter = this.workspace.dirFingerprint(knowledgeDir);
      if (protectedAfter !== protectedBefore) {
        if(!alreadyRestored)await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'RESTORING',{version:1,phase:'FINALIZING',activeMs:Math.max(0,Date.now()-started)});
        // O custo e o tempo da sessão contam no orçamento mesmo quando ela é descartada.
        const recorded=await this.prisma.$transaction(async tx=>{
          await OrchestratorService.lockJob(tx,job.id);
          await assertStepLease(tx,task,workerId);
          const updated=await tx.attempt.updateMany({
            where: { id: attempt.id,status:'EXECUTANDO',workerId },
            data: {
              status: 'FALHA', error: 'violação de isolamento: conhecimento do projeto alterado', endedAt: new Date(),executionState:await terminalAttemptJournal(tx,attempt.id,workerId,'FALHA'),
              costUsd: result.costUsd ?? 0, costEstimated: !!result.costEstimated, sessionId: result.sessionId, stopReason: result.stopReason,
              inputTokens:result.inputTokens,outputTokens:result.outputTokens,
            },
          });
          if(updated.count!==1)throw new LostStepLease();
          await tx.job.update({ where: { id: job.id }, data: { activeSeconds: { increment: elapsedSec } } });
          return true;
        }).catch(e=>{if(e instanceof LostStepLease)return false;throw e;});
        if(!recorded)return 'INTERROMPIDO';
        await L('VIOLAÇÃO DE ISOLAMENTO: a sessão alterou o conhecimento original do projeto (fora do workspace). Job bloqueado.', 'ERROR', attempt.id);
        return this.blockJob(task, workerId, job, step, BlockedReason.POLITICA, 'agente alterou arquivos fora do workspace (conhecimento do projeto)');
      }
    }
    if(!alreadyRestored){
      if(signal.aborted)return 'INTERROMPIDO';
      await this.prisma.$transaction(tx=>assertStepLease(tx,task,workerId));
      if(isAi){
        // Restore only the persisted removal list and exact document bytes.
        // Any unplanned harness in a recovered workspace is a conflict.
        if(alreadyRestoring){
          const allowed=new Set([...plan.remove,...repoHarness.map(f=>f.split('/').slice(0,f.split('/').findIndex(p=>WorkspaceService.HARNESS_FILES.includes(p))+1).join('/')),...plan.docs.map(([rel])=>rel)]);
          if(this.workspace.listHarnessFiles(worktree).some(f=>!allowed.has(f)))return this.reconcileReceiptConflict(task,workerId,job,step,attempt,'Harness mudou fora do plano de restauração. Arquivos preservados.');
        }
        this.workspace.removePlannedHarness(worktree,plan.remove);
        await this.workspace.restoreRepoHarness(worktree,repoHarness);
        this.workspace.gravarDocsEditados(worktree,new Map(plan.docs.map(([rel,c])=>[rel,Buffer.from(c,'base64')])));
        if(plan.docs.length)await L('Documentos de instrução preservados: '+plan.docs.map(([rel])=>rel).join(', '),'INFO',attempt.id);
      }
      const finalInput:AttemptReplayInput={...input,result,beforeVerification,verification,verified,sessionClosedNormally,activeMs:Math.max(0,Date.now()-started)};
      const restoredReplay=await this.replayEnvelope(job,step,worktree,finalInput);
      await writeAttemptPhase(this.prisma,task,workerId,attempt.id,'RESTORING',{version:1,phase:'FINALIZING',replay:restoredReplay,activeMs:Math.max(0,Date.now()-started)});
    }
    if(signal.aborted)return 'INTERROMPIDO';
    const notes = await ingestNotes(this.prisma,this.workspace,this.logs,job, step, attempt.id, worktree, providerId, result.sessionId, outputs,lease);
    const treeAfter = await this.workspace.snapshotHash(worktree);
    if(repairBefore!==null&&verified&&result.exitCode===0&&!result.interrupted&&!result.resourceUnavailable){
      const after=await this.workspace.repairSourceHash(worktree);
      if(after===repairBefore){
        verified=false;
        result={...result,exitCode:1,sessionEnded:false,stopReason:'repair_no_change',error:'Reparo escreveu relatório, mas não alterou os arquivos de projeto necessários. O comando original não será repetido.'};
        await L(result.error!,'WARN',attempt.id);
      }
    }

    const classified=classifyExecutionResult(result,isAi,verified,sessionClosedNormally&&result.stopReason!=='repair_no_change');
    result=classified.result;
    const {attemptStatus}=classified;
    const failureEvidence=diagnoseAttempt({result,beforeVerification,verification:verification.skillVerification,environment:ambiente,credential:credencialFaltando,tool:faltaPrograma,media:falhaTecnicaDaMidia,isAi,verified,attemptStatus});
    if(failureEvidence&&contextStats)contextStats.failureEvidence=failureEvidence;
    const outputHash = normalizedOutputHash(result.output ?? '', result.error);
    if(contextStats?.skillManifest){
      contextStats.skillEvidence=skillExecutionEvidence({provider:providerId,model:effectiveModel??null,coverage:contextStats.skillCoverage??collectSkillCoverage(contextStats.skillManifest).snapshot(),verification:verification.skillVerification,attemptStatus,treeBefore,treeAfter,artifacts:[...outputs,...videos].map(a=>a.id)});
    }
    const persisted=await this.prisma.$transaction(async tx=>{
      await OrchestratorService.lockJob(tx,job.id);
      await assertStepLease(tx,task,workerId);
      const updated=await tx.attempt.updateMany({
        where: { id: attempt.id,status:'EXECUTANDO',workerId },
        data: {
          status: attemptStatus,
          executionState:await terminalAttemptJournal(tx,attempt.id,workerId,attemptStatus),
          ...(contextStats||failureEvidence?{contextStats:(contextStats??{failureEvidence}) as unknown as Prisma.InputJsonValue}:{}),
          exitCode: result.exitCode,
          output: (result.output ?? '').slice(-20000),
          outputHash,
          error: (result.error??(attemptStatus==='FALHA'?result.output?.trim().slice(-5000)||'Executor terminou sem diagnóstico (exit '+result.exitCode+')':undefined))?.slice(0,5000),
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
      });
      if(updated.count!==1)throw new LostStepLease();
      await tx.job.update({
        where: { id: job.id },
        data: { activeSeconds: { increment: elapsedSec } },
      });
      await tx.step.update({ where: { id: step.id }, data: { lastOutput: (result.output ?? '').slice(-4000) } });
      return true;
    }).catch(e=>{if(e instanceof LostStepLease)return false;throw e;});
    if(!persisted)return 'INTERROMPIDO';
    await L(`Tentativa #${number}: ${attemptStatus} (exit ${result.exitCode}, ${elapsedSec}s${result.costUsd ? `, US$ ${result.costUsd}` : ''})${result.error ? ` — ${result.error.slice(0, 300)}` : ''}`,
      attemptStatus === 'SUCESSO' ? 'INFO' : 'WARN', attempt.id);

    if(failureEvidence)await L(formatFailureEvidence(failureEvidence).slice(0,2200),'WARN',attempt.id);
    if (attemptStatus === 'INTERROMPIDA') {
      // Checkpoint primeiro: a etapa só volta a ser retomável depois que o estado está salvo.
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `interrompido na tentativa ${number}`, { tentativa: number, log: logArt.id },false,{task,workerId});
      await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,job.id);await assertStepLease(tx,task,workerId);await tx.step.updateMany({ where: { id: step.id, status: 'EXECUTANDO' }, data: { status: 'PENDENTE', statusDetail: 'tentativa interrompida' } });});
      await this.queue.complete(task.id, workerId, task.claims);
      // Se o usuário já retomou o job enquanto abortávamos, reagenda.
      await this.orchestrator.scheduleReady(job.id);
      return 'INTERROMPIDO';
    }

    if (attemptStatus === 'RECURSO_INDISPONIVEL') {
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'recurso indisponível após tentativa '+number,{tentativa:number,log:logArt.id,artefatos:outputs.map(a=>a.id),notas:notes},false,{task,workerId});
      this.registry.invalidate(providerId);
      return this.awaitResource(task, workerId, job, step, result.error ?? 'recurso indisponível', result.retryAfterMs,signal);
    }

    if(failureEvidence?.layer==='connector'&&attemptStatus!=='SUCESSO'){
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'falha do conector; arquivos preservados',{tentativa:number,log:logArt.id,notas:notes},false,{task,workerId});
      return this.blockJob(task,workerId,job,step,BlockedReason.FALHA_INFRAESTRUTURA,formatFailureEvidence(failureEvidence)+'. Corrija a instalação ou configuração do executor; não refaça o conteúdo do projeto.');
    }
    if (ambiente && attemptStatus !== 'SUCESSO') {
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `conferência sem ambiente na etapa ${step.key}`, { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `a conferência falhou por um problema do SERVIDOR do Nivoo, não do projeto (${ambiente}). O trabalho feito está salvo. Rode "nivoo update" no servidor (instala e arruma as ferramentas) e clique em "Tentar de novo"; se repetir, mande o diagnóstico`);
    }

    if (credencialFaltando && attemptStatus !== 'SUCESSO') {
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `conferência sem credencial na etapa ${step.key}`, { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `A credencial da conferência está indisponível ou foi recusada (${credencialFaltando}). O trabalho feito está salvo. Confira as contas vinculadas e as variáveis da conferência nos Ajustes do projeto, depois retome o mesmo trabalho.`);
    }

    if (faltaPrograma && attemptStatus !== 'SUCESSO') {
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `conferência impossível na etapa ${step.key}`, { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `a conferência automática desta etapa usa "${faltaPrograma}", que não existe no servidor; o trabalho feito até aqui está salvo. Peça na conversa para refazer o plano usando só comandos básicos`);
    }

    if(attemptStatus!=='SUCESSO'&&/MIDIA_DESTINO_EXISTENTE:/.test(result.error??'')){
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'conflito de destino; saída preservada',{tentativa:number},false,{task,workerId});
      return this.blockJob(task,workerId,job,step,BlockedReason.CRITERIOS_NAO_ATENDIDOS,'O destino da mídia já existe. Preserve o arquivo anterior e selecione um destino novo: '+(result.error??'').slice(-600));
    }
    const mediaFailure = classifyMediaFailure(providerId, attemptStatus, result);
    if (mediaFailure) {
      await L(mediaFailure.log, 'ERROR', attempt.id);
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, mediaFailure.checkpoint, { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.CRITERIOS_NAO_ATENDIDOS, mediaFailure.detail);
    }

    // Preserve the existing visual recapture/review path even when the
    // normal author session is now recorded as a failed verification.
    const visualRecovery=attemptStatus==='FALHA'&&isAi&&sessionClosedNormally&&!nativeVisual&&/^direcao-arte-/.test(step.key);
    if (attemptStatus === 'SESSAO_ENCERRADA'||visualRecovery) {
      const reprovacaoVisual = parecerVisualNaoAprovado(worktree, step.verifyCommand ?? '');
      if (reprovacaoVisual) {
        await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `parecer visual pendente na etapa ${step.key}`, { tentativa: number },false,{task,workerId});
        return this.blockJob(task, workerId, job, step, BlockedReason.CRITERIOS_NAO_ATENDIDOS, reprovacaoVisual);
      }
      return this.continueInNewSession(task, workerId, job, step, worktree, number, treeBefore, treeAfter, notes,visualRecovery);
    }

    if (attemptStatus === 'SUCESSO') {
      const commit = await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `etapa ${step.key} concluída (tentativa ${number})`, {
        tentativa: number,
        log: logArt.id,
        artefatos: [...outputs.map(a=>a.id),...videos.map(v=>v.id)],
        notas:notes,
      },true,{task,workerId});
      if(!commit)return this.blockJob(task,workerId,job,step,BlockedReason.FALHA_INFRAESTRUTURA,'Resultado verificado, mas o Git não confirmou o checkpoint. Arquivos preservados; corrija o Git antes de retomar. Não refaça o conteúdo.');
      await this.queue.complete(task.id, workerId, task.claims);
      await this.orchestrator.scheduleReady(job.id);
      return 'CONCLUIDO';
    }

    // Falha técnica real de MP4 não é motivo para repetir render/montagem às
    // cegas. Entregar diagnóstico e artefatos presentes; quem decide refazer
    // o vídeo é o usuário, após inspecionar o resultado.
    if (falhaTecnicaDaMidia) {
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, 'MP4 com problema técnico, preservado para avaliação', { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.CRITERIOS_NAO_ATENDIDOS,
        'A etapa produziu/esperava um vídeo, mas a inspeção técnica encontrou: ' + falhaTecnicaDaMidia +
        '. Nenhuma nova renderização será iniciada automaticamente. Consulte o vídeo já publicado e escolha se deseja corrigir.');
    }

    // Se a trilha de fato não existe (ou há opções ambíguas), não repetir
    // ffmpeg três vezes nem bloquear como "verificação impossível".
    // O trabalho AGUARDA a mídia, com MP4 e checkpoints intactos.
    if (!isAi && providerId === 'juntar-videos' &&
        /TRILHA_NAO_LOCALIZADA:|TRILHA_AMBIGUA:/.test(result.error ?? '')) {
      return this.aguardarTrilha(task, workerId, job, step, worktree, number,
        (result.error ?? '').slice(0, 2400));
    }

    // A montagem pode falhar por REFERÊNCIA ERRADA de áudio, sem que o
    // vídeo esteja inválido. O executor agora tenta recuperar a trilha no
    // catálogo do próprio projeto (sem escolher material ambíguo). Só então
    // a falha entra na regra COMUM de três ocorrências do MESMO erro.
    // Não abrir um trabalho novo nem repetir as etapas 3D já concluídas.
    if (!isAi && providerId === 'juntar-videos') {
      const detalhe = (result.error || result.output || 'O executor de vídeo não informou a causa').trim();
      await L('Montagem pendente; vídeo e checkpoints preservados. ' +
        'A recuperação automática da trilha foi tentada antes da montagem. ' +
        detalhe.slice(0, 1500), 'WARN', attempt.id);
    }

    // Uma chamada de imagem paga pode ter sido cobrada antes de uma falha de rede.
    // Não a repita automaticamente sem decisão do usuário.
    if (result.stopReason==='visual_asset_error' || (!isAi && providerId === 'gemini-image')) {
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'geração visual pendente',{tentativa:number},false,{task,workerId});
      return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,(result.error??result.output??'Geração de imagem não concluída').slice(0,2200));
    }
    // exit 127 significa comando inexistente: não repetir exatamente o mesmo Bash.
    if (!isAi && providerId === 'local-shell' && result.exitCode === 127) {
      const mensagem = (result.error || result.output || '').trim();
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `comando local inexistente na etapa ${step.key}`, { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        `Comando local inválido ou não instalado; não vou repetir sem alteração: ${mensagem.slice(0, 2200)}`);
    }
    // Erro corrigível de script no executor local: ANTES este trecho
    // bloqueava todo o trabalho na primeira falha. O teste é determinístico,
    // mas o CÓDIGO executado pode ser corrigido por uma nova etapa de IA.
    const diagnosticoScript = (result.output ?? '') + '\n' + (result.error ?? '');

    // Falha nova: a IA continua. A mesma falha (inclusive intercalada por
    // outras) na terceira ocorrência impede outra sessão improdutiva.
    const errosDaEtapa = await this.prisma.attempt.findMany({
      where: { stepId: step.id, status: 'FALHA', number: { gt: step.resumeFromAttempt } },
      select: { error: true },
      orderBy: { number: 'desc' },
    });
    const erroAtual=(failureEvidence&&failureEvidence.kind!=='unknown'?failureEvidence.detail:result.error??result.output?.trim().slice(-5000)??'').trim()||'Executor terminou sem diagnóstico (exit '+result.exitCode+')';
    const recovery=decideFailedAttempt(job,errosDaEtapa.map(a=>a.error),erroAtual.slice(0,5000),isAi?(step.verifyCommand??''):step.instructions+'\n'+(step.verifyCommand??''),providerId,isAi,diagnosticoScript);
    if(result.stopReason==='model_incompatible'){
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'modelo incompatível; arquivos preservados',{tentativa:number,log:logArt.id,notas:notes},false,{task,workerId});
      const switched=await this.tryReserve(task,workerId,job,step,erroAtual,signal,false);
      if(switched)return switched;
      if(signal.aborted)return 'INTERROMPIDO';
      return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,erroAtual+'; nenhuma reserva compatível encontrada.');
    }
    if(result.stopReason==='repair_no_change'||result.stopReason==='file_operation_postcondition'||(providerId==='arquivos-projeto'&&attemptStatus==='FALHA')||recovery.kind==='blocked'){
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'causa não corrigida; arquivos preservados',{tentativa:number,log:logArt.id,notas:notes},false,{task,workerId});
      return this.blockJob(task,workerId,job,step,BlockedReason.VERIFICACAO_IMPOSSIVEL,recovery.kind==='blocked'?recovery.detail:erroAtual);
    }
    if(recovery.kind==='limit'){
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'limite de tentativas; resultado parcial preservado',{tentativa:number,log:logArt.id,notas:notes},false,{task,workerId});
      return this.failStep(task,workerId,job,step,recovery.detail);
    }
    if(recovery.kind==='repeat'){
      await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'erro idêntico repetido na etapa '+step.key,{tentativa:number},false,{task,workerId});
      return this.blockJob(task,workerId,job,step,BlockedReason.REPETICAO_IMPRODUTIVA,recovery.detail);
    }
    if(recovery.kind==='repair')return this.agendarReparoDeScript(task,workerId,job,step,worktree,number,erroAtual);

    await saveCheckpoint(this.prisma,this.workspace,job.id,step,worktree,'falha antes da nova tentativa '+number,{tentativa:number,log:logArt.id,artefatos:outputs.map(a=>a.id),notas:notes},false,{task,workerId});
    const backoff = Math.min(60_000, 1000 * 2 ** (failures));
    const motivo = (result.error || result.output || 'executor não informou a causa').trim().slice(0, 600);
    await L(`NOVA TENTATIVA EXPLICADA: a etapa "${step.key}" será repetida em ${Math.ceil(backoff / 1000)}s porque a tentativa #${number} falhou. Causa: ${motivo}. Arquivos já entregues são preservados; o motivo precisa ser corrigido antes de reexecutar conteúdo caro.`, 'WARN', attempt.id);
    await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,job.id);await assertStepLease(tx,task,workerId);await tx.step.update({ where: { id: step.id }, data: { status: 'PENDENTE',
      statusDetail: `Tentativa #${number} falhou: ${motivo.slice(0, 250)}. Retomada em ${Math.ceil(backoff / 1000)}s.` } });});
    await this.queue.requeue(task.id, workerId, task.claims, new Date(Date.now() + backoff), result.error);
    return 'RETRY';
  }

  /**
   * Sessão terminou sem concluir a etapa: continua automaticamente em NOVA sessão (sem comando manual),
   * com o contexto reconstruído do banco. Limites: sessões por etapa, tempo, orçamento e falta de progresso.
   */
  private async continueInNewSession(
    task: ClaimedTask, workerId: string, job: Job, step: Step, worktree: string, number: number,
    treeBefore: string, treeAfter: string, notes: number,visualRecovery=false,
  ): Promise<StepOutcome> {
    await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `sessão ${number} encerrada sem concluir ${step.key}`, {
      tentativa: number, progresso: treeBefore !== treeAfter, notas: notes,
    },false,{task,workerId});
    // Contar a mesma falha antes de agendar outra recaptura: um agente que
    // altera a composição minimamente a cada volta não pode girar sem fim.
    const sessions = await this.prisma.attempt.findMany({
      where: { stepId: step.id, status: visualRecovery?{in:['SESSAO_ENCERRADA','FALHA']}:'SESSAO_ENCERRADA', number: { gt: step.resumeFromAttempt } },
      orderBy: { number: 'desc' },
    });
    const repeatedVerification=repeatedSessionVerification(sessions,step.verifyCommand??'');
    if(repeatedVerification)return this.blockJob(task,workerId,job,step,BlockedReason.REPETICAO_IMPRODUTIVA,repeatedVerification);
    const decision=decideSessionContinuation(job,sessions);
    if(decision.kind==='repeat')return this.blockJob(task,workerId,job,step,BlockedReason.REPETICAO_IMPRODUTIVA,decision.detail);
    if(decision.kind==='limit')return this.failStep(task,workerId,job,step,decision.detail,BlockedReason.LIMITE_SESSOES);
    // Se a direção de arte mudou HTML/JS após as capturas, a IA NÃO pode
    // aprovar um quadro obsoleto. Voltar aos executores locais automaticamente,
    // preservando a composição e as outras etapas concluídas.
    const etapas = await this.prisma.step.findMany({
      where: { jobId: job.id },
      select: { id: true, key: true, provider: true, instructions: true, status: true },
    });
    const vencidas = capturasParaRecuperar(worktree, step, etapas);
    if (vencidas.length) {
      await this.prisma.$transaction(async (tx) => {
        await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
        for (const key of vencidas) {
          const captura = etapas.find((e) => e.key === key);
          if (!captura) continue;
          await tx.step.updateMany({
            where: { id: captura.id, status: 'CONCLUIDO' },
            data: { status: 'PENDENTE', statusDetail: 'fonte alterada: recaptura automática' },
          });
        }
        await tx.step.update({
          where: { id: step.id },
          data: {
            status: 'PENDENTE',
            // Dependência explícita: a revisão não pode disputar a fila com
            // a recaptura de outro quadro do mesmo vídeo.
            dependsOn: [...new Set([...step.dependsOn, ...vencidas])],
            // Não redefinir resumeFromAttempt ao recapturar: a terceira
            // ocorrência do MESMO defeito deve continuar contando.
            statusDetail: 'aguardando novas capturas, sem refazer composição',
          },
        });
      });
      await this.logs.log(job.id,
        `Quadros desatualizados após alteração na composição: recapturar ${vencidas.join(', ')} antes de nova revisão visual; não repetir IA sobre imagens antigas.`,
        { stepId: step.id, source: 'worker' });
      await this.queue.complete(task.id, workerId, task.claims);
      await this.orchestrator.scheduleReady(job.id);
      return 'CONTINUA';
    }

    await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,job.id);await assertStepLease(tx,task,workerId);await tx.step.update({
      where: { id: step.id },
      data: { status: 'PENDENTE', statusDetail: `sessão ${number} encerrada sem concluir; continuação automática agendada` },
    });});
    await this.logs.log(job.id, `Continuação automática: nova sessão para "${step.key}" (${sessions.length}${job.maxSessionsPerStep > 0 ? `/${job.maxSessionsPerStep}` : ''} sessões usadas)`, {
      stepId: step.id, source: 'worker',
    });
    await this.queue.requeue(task.id, workerId, task.claims, new Date(), 'continuação em nova sessão');
    return 'CONTINUA';
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
    const changed=await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.step.update({ where: { id: step.id }, data: { status: 'BLOQUEADO', statusDetail: `${reason}: ${detail}` } });
      await tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'BLOQUEADO', blockedReason: reason, statusDetail: `etapa ${step.key}: ${detail}` },
      });
      return true;
    }).catch(e=>{if(e instanceof LostStepLease)return false;throw e;});
    if(!changed)return 'INTERROMPIDO';
    await this.logs.log(job.id, `Job BLOQUEADO (${reason}) na etapa ${step.key}: ${detail}`, { stepId: step.id, level: 'ERROR', source: 'worker' });
    await avisarConversaQueParou(this.prisma, job.id, `${reason}: ${detail}`);
    await this.limparAoFim(job);
    await recordLesson(this.prisma,job, step, reason, detail);
    await this.queue.complete(task.id, workerId, task.claims);
    return 'BLOQUEADO';
  }

  /** Nenhum áudio real corresponde ao nome usado no plano. Aguardar
   * entrada do usuário em vez de repetir testes ou criar novo trabalho. */
  private async aguardarTrilha(
    task: ClaimedTask, workerId: string, job: Job, step: Step,
    worktree: string, number: number, detalhe: string,
  ): Promise<StepOutcome> {
    await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `aguardando trilha na etapa ${step.key}`, {
      tentativa: number, motivo: detalhe.slice(0, 1000),
    },false,{task,workerId});
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.step.update({ where: { id: step.id }, data: {
        status: 'AGUARDANDO_RECURSO', statusDetail: detalhe,
      } });
      await tx.job.updateMany({ where: { id: job.id, status: 'EXECUTANDO' }, data: {
        status: 'AGUARDANDO_RECURSO', statusDetail: `etapa ${step.key}: ${detalhe}`.slice(0, 2000),
      } });
    });
    await this.logs.log(job.id,
      'Montagem aguardando o áudio correto, sem repetição automática e sem descartar o MP4 já renderizado: ' +
      detalhe.slice(0, 1600) + ' Após disponibilizar a mídia, use Continuar neste MESMO trabalho.',
      { stepId: step.id, level: 'WARN', source: 'worker' });
    await this.queue.complete(task.id, workerId, task.claims);
    return 'AGUARDANDO_RECURSO';
  }

  /**
   * Erro corrigível do local-shell (script/código): abrir uma única etapa
   * corretiva na MESMA execução. Nenhum trabalho novo é criado e as etapas
   * CONCLUIDAS (incluindo render 3D) permanecem intactas. O teste local é
   * executado novamente só depois de editar o código.
   */
  private async agendarReparoDeScript(
    task: ClaimedTask, workerId: string, job: Job & { project: { provider: string } },
    step: Step, worktree: string, number: number, diagnostico: string,
  ): Promise<StepOutcome> {
    const agente = job.project.provider;
    if (!this.registry.has(agente) || this.registry.get(agente).kind === 'executor') {
      await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `script falhou na etapa ${step.key}`, { tentativa: number },false,{task,workerId});
      return this.blockJob(task, workerId, job, step, BlockedReason.VERIFICACAO_IMPOSSIVEL,
        'O script precisa de reparo, mas este projeto não possui uma IA de código configurada. ' +
        diagnostico.slice(0, 850));
    }
    const chave = repairKey(step.key,number);
    const relatorio = `out/reparos/${chave}.md`;
    const instrucoes = [
      'REPARO AUTOMÁTICO DA ETAPA DO MESMO TRABALHO (NÃO CRIAR PROJETO OU PLANO NOVO).',
      `A etapa determinística "${step.key}" apresentou o erro abaixo.`,
      `Comando real: ${step.instructions.slice(0, 4500)}`,
      `Erro verificado pelo sistema: ${diagnostico.slice(0, 2600)}`,
      'Leia os arquivos envolvidos e CORRIJA no worktree a causa técnica.',
      'Use as ferramentas de arquivo realmente disponíveis na conexão atual. O executor do Nivoo rodará o comando depois de uma alteração real de código; só gravar o relatório não é reparo.',
      'Não finja que executou o comando se não tem terminal. Não apague vídeos, áudio, backups ou resultados anteriores.',
      'Se não houver arquivo ou recurso real para corrigir (por exemplo, música que nunca foi enviada),',
      'registre o impedimento no relatório; NÃO invente mídia nem substitua recursos aprovados.',
      `Grave um relatório breve em ${relatorio} com os arquivos alterados, a causa corrigida e as limitações restantes.`,
    ].join('\n');
    await saveCheckpoint(this.prisma,this.workspace,job.id, step, worktree, `erro de script: agendando reparo ${chave}`, {
      tentativa: number, diagnostico: diagnostico.slice(0, 1000),
    },false,{task,workerId});
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.step.upsert({
        where:{jobId_key:{jobId:job.id,key:chave}},update:{},
        create: {
          jobId: job.id, key: chave, order: step.order,
          title: `Corrigir o erro da etapa ${step.title}`.slice(0, 300),
          instructions: instrucoes, provider: agente,
          dependsOn: step.dependsOn.filter(k=>k!==chave), verifyCommand: `test -s '${relatorio}'`,
          providerOptions: {}, requiresApproval: false,
        },
      });
      await tx.step.update({
        where: { id: step.id },
        data: { status: 'PENDENTE', statusDetail: `reparo automático ${chave} antes de reexecutar`,
          dependsOn: [...new Set([...step.dependsOn, chave])] },
      });
    });
    await this.logs.log(job.id,
      `Script da etapa "${step.key}" falhou; reparo ${chave} com ${agente} agendado no MESMO trabalho, preservando etapas concluídas. Não executar o mesmo teste antes do reparo.`,
      { stepId: step.id, level: 'WARN', source: 'worker' });
    await this.queue.complete(task.id, workerId, task.claims);
    await this.orchestrator.scheduleReady(job.id);
    return 'CONTINUA';
  }

  private async failStep(task: ClaimedTask, workerId: string, job: Job, step: Step, detail: string, reason: string = BlockedReason.LIMITE_TENTATIVAS): Promise<StepOutcome> {
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.step.update({ where: { id: step.id }, data: { status: 'FALHOU', statusDetail: detail } });
      await tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'FALHOU', blockedReason: reason, statusDetail: `etapa ${step.key}: ${detail}` },
      });
    });
    await this.logs.log(job.id, `Job FALHOU na etapa ${step.key}: ${detail}`, { stepId: step.id, level: 'ERROR', source: 'worker' });
    await avisarConversaQueParou(this.prisma, job.id, detail);
    await this.limparAoFim(job);
    await recordLesson(this.prisma,job, step, reason, detail);
    await this.queue.complete(task.id, workerId, task.claims);
    return 'FALHOU';
  }

  private async awaitApproval(task: ClaimedTask, workerId: string, job: Job, step: Step, reasons: string[], descricao?: string): Promise<StepOutcome> {
    const subjectHash=stepHash({...step,provider:step.provider??job.defaultProvider});
    // Do not silently reuse an approval whose exact executor options changed.
    await this.prisma.approval.updateMany({where:{jobId:job.id,subjectId:step.id,kind:'ACAO_DESTRUTIVA',status:'PENDENTE',NOT:{subjectHash}},data:{status:'REJEITADO',decidedBy:'sistema',decidedAt:new Date(),reason:'Autorização anterior substituída por novo contrato de execução; operação não executada.'}});
    const pending = await this.prisma.approval.findFirst({ where: { jobId: job.id, subjectId: step.id, kind: 'ACAO_DESTRUTIVA', status: 'PENDENTE',subjectHash } });
    if (!pending) {
      await this.prisma.approval.create({
        data: {
          jobId: job.id,
          projectId: job.projectId,
          kind: 'ACAO_DESTRUTIVA',
          subjectId: step.id,
          subjectHash,
          description: descricao ?? `Etapa "${step.key}" contém ação potencialmente destrutiva: ${reasons.join('; ') || 'marcada como requer aprovação'}`,
        },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.step.update({ where: { id: step.id }, data: { status: 'AGUARDANDO_APROVACAO', statusDetail: 'ação destrutiva requer aprovação' } });
      await tx.job.updateMany({ where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } }, data: { status: 'AGUARDANDO_APROVACAO', statusDetail: `etapa ${step.key} aguarda aprovação` } });
    });
    await this.logs.log(job.id, `Etapa ${step.key} aguardando aprovação explícita (ação destrutiva)`, { stepId: step.id, level: 'WARN', source: 'worker' });
    await this.queue.complete(task.id, workerId, task.claims);
    return 'AGUARDANDO_APROVACAO';
  }

  private async tryReserve(task:ClaimedTask,workerId:string,job:Job&{project:{aiModels:unknown}},step:Step,detail:string,signal:AbortSignal,resourceFailure:boolean):Promise<StepOutcome|null>{
    if(signal.aborted)return 'INTERROMPIDO';
    const providerId=step.provider??job.defaultProvider;
    if(!tipoDe(providerId))return null;
    if(!resourceFailure){
      const status=await this.registry.status(providerId,15000);
      const model=assessModel(providerId,selectedModel(projectModel(job.project,providerId),step.providerOptions),status,step.providerOptions).model;
      markModelIncompatible(providerId,model);
    }
    const rejected:string[]=[];
    const reserva=await trocarEtapaParaReserva(this.prisma,this.registry,job.projectId,job.id,step.id,providerId,{
      options:step.providerOptions,pinnedReview:!!approvedGoldfish(job.approvedScope),preserveMcp:projectSessionMcp(providerId,job.projectId,'execution',{jobId:job.id}).length>0,
    },{taskId:task.id,workerId,claims:task.claims,signal,resourceFailure,onSkip:(id,reason)=>rejected.push(id+': '+reason)});
    if(rejected.length)await this.logs.log(job.id,'Reservas não selecionadas: '+rejected.join('; '),{stepId:step.id,level:'INFO',source:'worker'}).catch(()=>undefined);
    if(!reserva)return signal.aborted?'INTERROMPIDO':null;
    const aviso=reserva.anterior+' não pode continuar esta etapa ('+detail.slice(0,200)+'). Retomada com '+reserva.nome+' / '+(reserva.model??'modelo padrão')+'. Demais etapas e preferência do projeto preservadas.';
    await this.logs.log(job.id,aviso,{stepId:step.id,level:'WARN',source:'worker'}).catch(()=>undefined);
    const origem=await this.prisma.conversationMessage.findFirst({where:{jobId:job.id},select:{conversationId:true}});
    if(origem)await this.prisma.conversationMessage.create({data:{conversationId:origem.conversationId,role:'ASSISTENTE',status:'PRONTA',kind:'sistema',content:aviso,jobId:job.id}}).catch(()=>undefined);
    return 'CONTINUA';
  }

  private async awaitResource(task: ClaimedTask, workerId: string, job: Job&{project:{aiModels:unknown}}, step: Step, detail: string, retryAfterMs: number|undefined,signal:AbortSignal): Promise<StepOutcome> {
    const switched=await this.tryReserve(task,workerId,job,step,detail,signal,true);
    if(switched)return switched;
    const waits = await this.prisma.attempt.count({ where: { stepId: step.id, status: 'RECURSO_INDISPONIVEL',number:{gt:step.resumeFromAttempt} } });
    const rateLimit = isTransientRateLimit(detail);
    // HTTP 429 pode significar cota diária esgotada: não é defeito permanente.
    // Fica na fila com runAt persistido, sem insistir nas chamadas nem bloquear
    // definitivamente o trabalho após três verificações.
    if (!rateLimit && (task.resourceWaits >= MAX_RESOURCE_RECHECKS_PER_STEP || waits >= MAX_RESOURCE_RECHECKS_PER_STEP)) {
      return this.blockJob(task, workerId, job, step, BlockedReason.FALHA_INFRAESTRUTURA,
        `O recurso/conector continuou indisponível após ${Math.max(task.resourceWaits,waits)} verificações. Interrompido para evitar loop. Resolva a conexão ou ferramenta antes de iniciar outro trabalho: ${detail.slice(0,550)}`);
    }
    const delay = rateLimit
      ? resourceRateLimitDelayMs(task.resourceWaits, retryAfterMs)
      : RESOURCE_BACKOFF_MS[Math.min(task.resourceWaits, RESOURCE_BACKOFF_MS.length - 1)];
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertStepLease(tx,task,workerId);
      await tx.step.update({ where: { id: step.id }, data: { status: 'AGUARDANDO_RECURSO', statusDetail: detail.slice(0, 1000) } });
      await tx.job.updateMany({ where: { id: job.id, status: 'EXECUTANDO' }, data: { status: 'AGUARDANDO_RECURSO', statusDetail: `etapa ${step.key}: ${detail}`.slice(0, 2000) } });
    });
    await this.logs.log(job.id, `${rateLimit ? 'Limite HTTP 429 do provedor (sem chamadas durante a espera)' : 'Aguardando recurso'} (${detail}). Nova tentativa em ${Math.round(delay / 60_000)} min. Esperas anteriores: ${waits}`, {
      stepId: step.id,
      level: 'WARN',
      source: 'worker',
    });
    await this.queue.requeue(task.id, workerId, task.claims, new Date(Date.now() + delay), detail, true);
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

  async buildContext(job:Job,step:Step,profileText:string,worktree?:string):Promise<{text:string;stats:ContextStats}>{
    return buildExecutionContext(this.prisma,this.workspace,job,step,profileText,worktree);
  }
}

export { conversaComoTexto } from './executor/conversation';

/** Erro sem o que muda a cada execução (horários, durações, números, hashes): para comparar repetição. */
export function normalizarErro(e: string): string {
  return e
    .replace(/\b[0-9a-f]{7,40}\b/gi, 'H')
    .replace(/\d+([.,]\d+)?\s*(ms|s|seg|min|m|kb|mb)\b/gi, 'N')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}
