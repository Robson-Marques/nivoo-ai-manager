import { Prisma,type Job,type Step } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ExecutionResult } from '../../providers/provider.interface';
import type { ContextStats } from '../context-builder';
import type { verifyExecution } from './verification';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClaimedTask } from '../../queue/queue.service';
import { OrchestratorService } from '../../jobs/orchestrator.service';
import { assertStepLease,LostStepLease } from './lease';

export type AttemptPhase='PREPARED'|'DISPATCHING'|'RETURNED'|'VERIFYING'|'VERIFIED'|'FINALIZING'|'TERMINAL';
export interface AttemptReplayInput {
  providerId:string;isAi:boolean;nativeVisual:boolean;protectedBefore:string|null;repoHarness:string[];
  docsPendentes:[string,string][];treeBefore:string;repairBefore:string|null;contextStats:ContextStats|null;
  effectiveModel:string|null;failures:number;mediaBefore:[string,string|null][];result:ExecutionResult;activeMs:number;
  beforeVerification?:ExecutionResult;verification?:Awaited<ReturnType<typeof verifyExecution>>;
  verified?:boolean;sessionClosedNormally?:boolean;
}
export interface ReplayEnvelope {
  contract:string;head:string;tree:string;notes:string;context:string;knowledge:string;input:AttemptReplayInput;
}
export interface AttemptJournal {
  version:1;phase:AttemptPhase;costKnown?:boolean;activeMs?:number;replay?:ReplayEnvelope|null;
  result?:ExecutionResult;verification?:unknown;verified?:boolean;outcome?:string;
}
const phases:AttemptPhase[]=['PREPARED','DISPATCHING','RETURNED','VERIFYING','VERIFIED','FINALIZING','TERMINAL'];
const successors:Partial<Record<AttemptPhase,AttemptPhase>>={PREPARED:'DISPATCHING',DISPATCHING:'RETURNED',RETURNED:'VERIFYING',VERIFYING:'VERIFIED',VERIFIED:'FINALIZING',FINALIZING:'TERMINAL'};
function canonical(v:unknown):unknown{
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));
  return v;
}
export function attemptContract(job:Pick<Job,'id'|'approvedScope'|'defaultProvider'>,step:Pick<Step,'id'|'key'|'instructions'|'verifyCommand'|'provider'|'providerOptions'|'requiresApproval'|'resumeFromAttempt'>,providerId:string){
  return createHash('sha256').update(JSON.stringify(canonical([job.id,job.approvedScope,job.defaultProvider,step.id,step.key,step.instructions,step.verifyCommand,step.provider,step.providerOptions,step.requiresApproval,step.resumeFromAttempt,providerId]))).digest('hex');
}
export function readAttemptJournal(value:unknown):AttemptJournal|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const state=value as AttemptJournal;
  return state.version===1&&phases.includes(state.phase)?state:null;
}
export function makeReplayEnvelope(value:Omit<ReplayEnvelope,'head'>&{head:string|null}):ReplayEnvelope|null{
  if(!value.head||Buffer.byteLength(JSON.stringify(value),'utf8')>2*1024*1024)return null;
  return {...value,head:value.head};
}
export function canReplayAttempt(state:AttemptJournal|null):state is AttemptJournal&{phase:'RETURNED'|'VERIFIED';replay:ReplayEnvelope}{
  if(!state||!['RETURNED','VERIFIED'].includes(state.phase)||!state.replay)return false;
  const r=state.replay,i=r.input;
  return [r.contract,r.head,r.tree,r.notes,r.context,r.knowledge].every(x=>typeof x==='string'&&x.length>0)
    &&!!i&&typeof i.providerId==='string'&&typeof i.isAi==='boolean'&&typeof i.nativeVisual==='boolean'
    &&Array.isArray(i.repoHarness)&&Array.isArray(i.docsPendentes)&&Array.isArray(i.mediaBefore)
    &&typeof i.treeBefore==='string'&&Number.isFinite(i.activeMs)&&i.activeMs>=0
    &&Number.isFinite(i.failures)&&!!i.result&&typeof i.result.exitCode==='number'&&typeof i.result.output==='string'
    &&(state.phase!=='VERIFIED'||!!i.verification&&!!i.beforeVerification&&typeof i.verified==='boolean'&&typeof i.sessionClosedNormally==='boolean');
}
function json(value:unknown):Prisma.InputJsonValue{return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;}
function resultSummary(result:ExecutionResult){
  return {...result,output:(result.output??'').slice(-20000),...(result.error?{error:result.error.slice(0,5000)}:{})};
}
/** The returned receipt and its cost are committed together under the lease.
 * Subsequent verification/terminal writes never charge that receipt again.
 * Keep previous facts when moving phases, even if replay is unavailable. */
export async function writeAttemptPhase(prisma:PrismaService,task:ClaimedTask,workerId:string,attemptId:string,expected:AttemptPhase,next:AttemptJournal){
  if(successors[expected]!==next.phase)throw Error('Transição de tentativa inválida: '+expected+' → '+next.phase);
  await prisma.$transaction(async tx=>{
    await OrchestratorService.lockJob(tx,task.jobId!);
    await assertStepLease(tx,task,workerId);
    const previous=await tx.attempt.findFirst({where:{id:attemptId,jobId:task.jobId!,stepId:task.stepId!,status:'EXECUTANDO',workerId},select:{executionState:true}});
    const old=readAttemptJournal(previous?.executionState);
    if(old?.phase!==expected)throw new LostStepLease();
    const returned=next.phase==='RETURNED';
    const result=next.result;
    if(returned&&!result)throw Error('Recibo do provedor ausente.');
    const cost=returned&&result&&typeof result.costUsd==='number'&&Number.isFinite(result.costUsd)&&result.costUsd>=0?result.costUsd:null;
    // A large replay envelope is omitted, not silently truncated into a replayable result.
    const journal={...old,...next,replay:next.replay??null,
      ...(result?{result:resultSummary(result)}:{}),...(returned?{costKnown:cost!==null}:{})};
    const changed=await tx.attempt.updateMany({where:{id:attemptId,status:'EXECUTANDO',workerId},data:{
      executionState:json(journal),
      ...(['RETURNED','VERIFIED'].includes(next.phase)?{pid:null,processIdentity:Prisma.DbNull}:{}),
      ...(returned&&result?{exitCode:result.exitCode,output:(result.output??'').slice(-20000),error:result.error?.slice(0,5000),
        sessionId:result.sessionId,stopReason:result.stopReason,numTurns:result.numTurns,
        inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:cost??0,costEstimated:!!result.costEstimated}:{}),
    }});
    if(changed.count!==1)throw new LostStepLease();
    if(returned&&cost!==null)await tx.job.update({where:{id:task.jobId!},data:{costSpentUsd:{increment:cost}}});
  });
}
