import { processIdentity } from '../../common/process-identity';
import { Prisma,type Job,type Step } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LogService } from '../../jobs/log.service';
import type { ProviderRegistry } from '../../providers/provider-registry.service';
import type { AiProvider,ExecutionResult,ExecutionRequest } from '../../providers/provider.interface';
import { measureAiCall } from '../token-benchmark';
import { collectSkillCoverage } from '../../specialties/skill-evidence';
import { SKILLS_VERSION } from '../../specialties/skills';
import type { ContextStats } from '../context-builder';
import { registrarErro } from '../../diagnostico/erros';
import { projectModel } from '../../providers/project-model';
import { selectedModel } from '../../providers/model-capabilities';
import { projectSessionMcp } from '../../mcp/session-policy';
import { hasMotionCommand } from '../../jobs/motion/command';

export function executionTimeoutMs(job:Pick<Job,'maxDurationSec'|'activeSeconds'|'stepTimeoutSec'>,providerId:string,instructions:string):number{
  const remaining=job.maxDurationSec>0?Math.max(1,job.maxDurationSec-job.activeSeconds):Infinity;
  const stepSeconds=providerId==='local-shell'&&hasMotionCommand(instructions)?Math.max(job.stepTimeoutSec,3600):job.stepTimeoutSec;
  return Math.min(stepSeconds,remaining)*1000;
}

/** Dispatch exactly once. The caller owns attempt creation, outcome and retry. */
export async function dispatchExecution(prisma:PrismaService,logs:LogService,registry:ProviderRegistry,provider:AiProvider,providerId:string,job:Job&{project:{aiModels:unknown}},step:Step,attempt:{id:string},worktree:string,outputDir:string,projectMediaDir:string,context:string,profileText:string,timeoutMs:number,signal:AbortSignal,started:number,contextStats?:ContextStats|null):Promise<ExecutionResult>{
  const isAi=provider.kind!=='executor';
  const skillCoverage=collectSkillCoverage(contextStats?.skillManifest??[]);
    let result: ExecutionResult;
    // Logs do provedor são gravados em ordem, sem bloquear a execução.
    let logChain = Promise.resolve();
    let ultimoEvento = Date.now();
    const progresso = setInterval(() => {
      const tempo = Math.floor((Date.now() - started) / 1000);
      const inatividade = Math.floor((Date.now() - ultimoEvento) / 1000);
      const detail = `Sessão ativa há ${tempo}s; último evento do executor há ${inatividade}s (sem presumir avanço)`;
      logChain = logChain.then(async () => {
        await prisma.step.updateMany({ where: { id: step.id, status: 'EXECUTANDO' }, data: { statusDetail: detail } }).catch(() => undefined);
        await logs.log(job.id, detail, { stepId: step.id, attemptId: attempt.id, source: `provider:${providerId}` }).catch(() => undefined);
      });
    }, 60_000);
    try {
      const request:ExecutionRequest = {
        jobId: job.id,
        stepId: step.id,
        attemptId: attempt.id,
        instructions: step.instructions,
        context,
        cwd: worktree,
        outputDir,
        projectMediaDir: projectMediaDir,
        systemPrompt: isAi ? profileText : undefined,
        timeoutMs,
        signal,
        // Modelo: o da etapa (se definido) ou o escolhido para esta IA no projeto; senão, o padrão da IA.
        options: {
          ...((step.providerOptions ?? {}) as { model?: string; maxTurns?: number }),
          model:selectedModel(projectModel(job.project,providerId),step.providerOptions),
          // Sem corte arbitrário em 20 turnos: a sessão já tem timeout controlado.
          // Só encaminha um teto se o plano/projeto o configurou explicitamente.
          ...((step.providerOptions as { maxTurns?: number } | null)?.maxTurns ? { maxTurns: (step.providerOptions as { maxTurns: number }).maxTurns } : {}),
        },
        // Ferramentas MCP liberadas para este projeto (Conexões → Ferramentas).
        ...(isAi ? { mcp:projectSessionMcp(providerId,job.projectId,'execution',{jobId:job.id}) } : {}),
        onSkillRead: event=>skillCoverage.observe(event),
        onSpawn: (pid) => {
          const identity=processIdentity(pid);
          logChain = logChain.then(() => prisma.attempt.updateMany({ where: { id: attempt.id,status:'EXECUTANDO' }, data: { pid,processIdentity:identity??Prisma.DbNull } }).then(() => undefined).catch(() => undefined));
        },
        onLog: (line, level = 'INFO') => {
          ultimoEvento = Date.now();
          logChain = logChain.then(() =>
            logs.log(job.id, line, { stepId: step.id, attemptId: attempt.id, level, source: `provider:${providerId}` }).catch(() => undefined),
          );
        },
      };
      result=isAi?await measureAiCall({projectId:job.projectId,provider:providerId,model:request.options?.model,phase:'execution',jobId:job.id,stepId:step.id,attemptId:attempt.id,skillsVersion:SKILLS_VERSION,skillIds:contextStats?.skillIds,promptChars:contextStats?.promptChars},()=>provider.execute(request)):await provider.execute(request);
    } catch (e: any) {
      result = { exitCode: -1, output: '', error: `erro do conector: ${e?.message ?? e}`,connectorFailure:{kind:'connector-exception',detail:String(e?.message??e).slice(0,5000)} };
      registrarErro('worker', `erro do conector ${providerId} (trabalho ${job.id}, etapa ${step.key}): ${e?.message ?? e}`, e);
    } finally {
      clearInterval(progresso);
    }
    await logChain;
    if(contextStats?.skillManifest)contextStats.skillCoverage=skillCoverage.snapshot();
    // Login recusado de verdade (token expirado/revogado) marca a conexão para a tela pedir "Reconecte".
    if (isAi) registry.registrarResultado(providerId, result.exitCode === 0 && !result.resourceUnavailable, result.error); // só o canal de erro, nunca o texto da IA (código e logs do projeto citam 401…)


  return result;
}
