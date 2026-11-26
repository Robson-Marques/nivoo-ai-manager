import { Prisma,type Job,type Step } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutionResult } from '../../providers/provider.interface';
import type { ContextStats } from '../context-builder';
import type { verifyExecution } from './verification';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClaimedTask } from '../../queue/queue.service';
import { OrchestratorService } from '../../jobs/orchestrator.service';
import { assertStepLease,LostStepLease } from './lease';

export type AttemptPhase='PREPARED'|'DISPATCHING'|'RETURNED'|'VERIFYING'|'VERIFIED'|'PUBLISHING'|'RESTORING'|'FINALIZING'|'TERMINAL';
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
export interface FinalizationPlan {
  logId:string;outputIds:string[];videoIds:string[];
  remove:string[];docs:[string,string][];
  sourceHash:string|null;
}
export interface AttemptJournal {
  version:1;phase:AttemptPhase;costKnown?:boolean;activeMs?:number;replay?:ReplayEnvelope|null;
  finalization?:FinalizationPlan;
  result?:ExecutionResult;providerResult?:ExecutionResult;verification?:unknown;verified?:boolean;outcome?:string;
}
const phases:AttemptPhase[]=['PREPARED','DISPATCHING','RETURNED','VERIFYING','VERIFIED','PUBLISHING','RESTORING','FINALIZING','TERMINAL'];
const successors:Partial<Record<AttemptPhase,AttemptPhase>>={PREPARED:'DISPATCHING',DISPATCHING:'RETURNED',RETURNED:'VERIFYING',VERIFYING:'VERIFIED',VERIFIED:'PUBLISHING',PUBLISHING:'RESTORING',RESTORING:'FINALIZING',FINALIZING:'TERMINAL'};
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
export function canReplayAttempt(state:AttemptJournal|null):state is AttemptJournal&{phase:'RETURNED'|'VERIFIED'|'PUBLISHING'|'RESTORING'|'FINALIZING';replay:ReplayEnvelope}{
  if(!state||!['RETURNED','VERIFIED','PUBLISHING','RESTORING','FINALIZING'].includes(state.phase)||!state.replay)return false;
  if((state.phase==='RESTORING'||state.phase==='FINALIZING')&&!validFinalizationPlan(state.finalization))return false;
  const r=state.replay,i=r.input;
  return [r.contract,r.head,r.tree,r.notes,r.context,r.knowledge].every(x=>typeof x==='string'&&x.length>0)
    &&!!i&&typeof i.providerId==='string'&&typeof i.isAi==='boolean'&&typeof i.nativeVisual==='boolean'
    &&Array.isArray(i.repoHarness)&&Array.isArray(i.docsPendentes)&&Array.isArray(i.mediaBefore)
    &&typeof i.treeBefore==='string'&&Number.isFinite(i.activeMs)&&i.activeMs>=0
    &&Number.isFinite(i.failures)&&!!i.result&&typeof i.result.exitCode==='number'&&typeof i.result.output==='string'
    &&(state.phase==='RETURNED'||!!i.verification&&!!i.beforeVerification&&typeof i.verified==='boolean'&&typeof i.sessionClosedNormally==='boolean');
}
export function validFinalizationPlan(p:FinalizationPlan|undefined):p is FinalizationPlan{
  return !!p&&typeof p.logId==='string'&&Array.isArray(p.outputIds)&&p.outputIds.every(x=>typeof x==='string')
    &&Array.isArray(p.videoIds)&&p.videoIds.every(x=>typeof x==='string')
    &&Array.isArray(p.remove)&&p.remove.every(x=>typeof x==='string')
    &&Array.isArray(p.docs)&&p.docs.every(x=>Array.isArray(x)&&x.length===2&&typeof x[0]==='string'&&typeof x[1]==='string')
    &&typeof p.sourceHash==='string'&&p.sourceHash.length>0;
}
/** Hash exact auxiliary file bytes; bound cost and refuse symlinks or
 * oversized inputs rather than falsely certifying an incomplete snapshot. */
export async function replayAuxFingerprint(root:string):Promise<string|null>{
  const hash=createHash('sha256');
  let files=0,bytes=0;
  async function walk(dir:string,rel:string):Promise<boolean>{
    const st=await fs.lstat(dir);
    if(!st.isDirectory()||st.isSymbolicLink())return false;
    hash.update(JSON.stringify(['dir',rel]));
    const entries=await fs.readdir(dir,{withFileTypes:true});
    for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const p=path.join(dir,e.name),name=rel?rel+'/'+e.name:e.name;
      if(++files>5000)return false;
      if(e.isDirectory()){if(!await walk(p,name))return false;continue;}
      if(!e.isFile()||e.isSymbolicLink())return false;
      const before=await fs.lstat(p);
      if(!before.isFile()||bytes+before.size>32*1024*1024)return false;
      const content=await fs.readFile(p);
      const after=await fs.lstat(p);
      if(content.length!==before.size||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)return false;
      bytes+=content.length;
      hash.update(JSON.stringify(['file',name,content.length,createHash('sha256').update(content).digest('hex')]));
    }
    return true;
  }
  try{
    try{await fs.lstat(root);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return hash.update('absent').digest('hex');throw e;}
    return await walk(root,'')?hash.digest('hex'):null;
  }catch{return null;}
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
    const journal={...old,...next,replay:['PUBLISHING','RESTORING'].includes(next.phase)?old.replay??null:next.replay??null,
      ...(result?{result:resultSummary(result)}:{}),...(returned&&result?{costKnown:cost!==null,providerResult:resultSummary(result)}:{})};
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

/** Persist the optional replay envelope AFTER the minimal result/cost receipt.
 * A failure here cannot roll back accounting or falsely authorize redispatch. */
export async function attachAttemptReplay(prisma:PrismaService,task:ClaimedTask,workerId:string,attemptId:string,phase:'RETURNED'|'VERIFIED',replay:ReplayEnvelope){
  await prisma.$transaction(async tx=>{
    await OrchestratorService.lockJob(tx,task.jobId!);
    await assertStepLease(tx,task,workerId);
    const where={id:attemptId,jobId:task.jobId!,stepId:task.stepId!,status:'EXECUTANDO' as const,workerId};
    const previous=await tx.attempt.findFirst({where,select:{executionState:true}});
    const old=readAttemptJournal(previous?.executionState);
    if(old?.phase!==phase||old.replay)throw new LostStepLease();
    const changed=await tx.attempt.updateMany({where,data:{executionState:json({...old,replay})}});
    if(changed.count!==1)throw new LostStepLease();
  });
}
/** Used inside the same fenced transaction that closes the attempt and
 * records time. Preserve known/unknown cost and original provider receipt. */
export async function terminalAttemptJournal(tx:Prisma.TransactionClient,attemptId:string,workerId:string,outcome:string):Promise<Prisma.InputJsonValue>{
  const old=readAttemptJournal((await tx.attempt.findFirst({where:{id:attemptId,workerId,status:'EXECUTANDO'},select:{executionState:true}}))?.executionState);
  if(old?.phase!=='FINALIZING')throw new LostStepLease();
  return json({...old,phase:'TERMINAL',outcome,replay:null,finalization:undefined});
}
