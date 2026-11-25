import { createHash } from 'node:crypto';
import type { ExecutionResult } from '../../../providers/provider.interface';
import { measuredUsage } from '../../../worker/token-benchmark';
import { GOLDFISH_SOURCE_REVISION,type GoldfishDispatch,type GoldfishReviewerRequest,type GoldfishReviewerResult,type GoldfishPreset,type GoldfishReference } from './review-pipeline';

export type ReviewBinding={projectId:string;conversationId:string;messageId:string;providerId:string;model:string|null;revision:string;preset:GoldfishPreset;targetHash:string;sourceRevision:string};
type Usage=ReturnType<typeof measuredUsage>;
type Entry={key:string;fingerprint:string;stage:number;role:string;attempt:1|2;startedAt:string;finishedAt?:string;result?:GoldfishReviewerResult;usage?:Usage};
export type GoldfishCheckpoint={version:1;binding:ReviewBinding;entries:Entry[]};
export type ReviewTotals={costUsd:number;costKnown:boolean;inputTokens:number;outputTokens:number;tokensKnown:boolean;uncertain:number;calls:number};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reviewBinding(input:Omit<ReviewBinding,'targetHash'|'sourceRevision'>,target:GoldfishReference,baseline:readonly GoldfishReference[]):ReviewBinding{
  return {...input,targetHash:hash({target,baseline}),sourceRevision:GOLDFISH_SOURCE_REVISION};
}
export function createReviewCheckpoint(binding:ReviewBinding):GoldfishCheckpoint{return {version:1,binding,entries:[]};}
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function str(v:unknown):v is string{return typeof v==='string'&&!!v.trim();}
function validNumber(v:unknown):boolean{return v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0;}
function validUsage(v:unknown):v is Usage{
  return object(v)&&['inputTokens','outputTokens','cacheReadInputTokens','cacheWriteInputTokens','inputTotal','costUsd'].every(k=>validNumber(v[k]))&&['inputExcludesCache','partial','complete','costEstimated'].every(k=>typeof v[k]==='boolean');
}
function validResult(v:unknown):v is GoldfishReviewerResult{
  if(!object(v))return false;
  if(v.status==='completed')return str(v.report)&&object(v.receipt)&&str(v.receipt.sessionId)&&v.receipt.freshContext===true&&v.receipt.readOnly===true&&['document-only','authorized-baseline'].includes(String(v.receipt.access));
  return ['failed','unavailable','interrupted'].includes(String(v.status))&&typeof v.reason==='string';
}
/** Data is internal and versioned. Reject corrupted or mismatched checkpoint
 * rather than treating it as an empty run and spending again. */
export function readReviewCheckpoint(raw:unknown):GoldfishCheckpoint{
  if(!object(raw)||raw.version!==1||!object(raw.binding)||!Array.isArray(raw.entries)||raw.entries.length>20)throw Error('Checkpoint Goldfish inválido; nenhuma chamada será repetida.');
  const b=raw.binding;
  if(!['projectId','conversationId','messageId','providerId','revision','targetHash','sourceRevision'].every(k=>str(b[k]))||!(b.model===null||typeof b.model==='string')||!['uninterrupted','feature_spec','implementation',5,6,7,8,9].includes(b.preset as GoldfishPreset))throw Error('Vínculo Goldfish inválido.');
  const keys=new Set<string>();
  for(const e of raw.entries){
    if(!object(e)||!str(e.key)||!str(e.fingerprint)||!str(e.role)||![5,6,7,8,9].includes(Number(e.stage))||(e.attempt!==1&&e.attempt!==2)||e.key!==e.stage+':'+e.role+':'+e.attempt||keys.has(e.key)||!str(e.startedAt))throw Error('Tentativa Goldfish inválida.');
    keys.add(e.key);
    if(e.finishedAt!==undefined){if(!str(e.finishedAt)||!validResult(e.result)||(e.usage!==undefined&&!validUsage(e.usage)))throw Error('Resultado Goldfish inválido.');}
    else if(e.result!==undefined||e.usage!==undefined)throw Error('Checkpoint Goldfish inconsistente.');
  }
  return raw as unknown as GoldfishCheckpoint;
}
export function assertReviewBinding(saved:GoldfishCheckpoint,binding:ReviewBinding):void{
  const keys=Object.keys(binding) as (keyof ReviewBinding)[];
  if(keys.some(k=>saved.binding[k]!==binding[k]))throw Error('Documento, revisão, projeto, provedor ou modelo mudou; checkpoint preservado sem repetir chamadas.');
}
export function reviewTotals(checkpoint:GoldfishCheckpoint):ReviewTotals{
  let costUsd=0,inputTokens=0,outputTokens=0,costKnown=true,tokensKnown=true,uncertain=0;
  for(const e of checkpoint.entries){
    const u=e.usage;
    if(!e.finishedAt)uncertain++;
    if(!u||u.costUsd===null||u.costEstimated)costKnown=false;
    if(u?.costUsd!==null&&u?.costUsd!==undefined)costUsd+=u.costUsd;
    if(!u?.complete)tokensKnown=false;
    inputTokens+=u?.inputTotal??0;outputTokens+=u?.outputTokens??0;
  }
  return {costUsd:Math.round(costUsd*10000)/10000,costKnown,inputTokens,outputTokens,tokensKnown,uncertain,calls:checkpoint.entries.length};
}
function fingerprint(req:GoldfishReviewerRequest):string{
  const {signal,...data}=req;
  return hash(data);
}
type Options={checkpoint:GoldfishCheckpoint;dispatch:GoldfishDispatch;save:(next:GoldfishCheckpoint)=>Promise<boolean>;canContinue:()=>boolean};
/** Serialize durable attempts even if a stage schedules parallel reviewers.
 * A receipt and its usage are committed together. A crash between dispatch and
 * commit is deliberately ambiguous: do not resend that request. */
export function checkpointedGoldfishDispatch(opts:Options){
  let checkpoint=opts.checkpoint,tail:Promise<unknown>=Promise.resolve(),halted=false;
  let usage:Usage|undefined;
  const onUsage=(result:ExecutionResult)=>{usage=measuredUsage(result);};
  const dispatch:GoldfishDispatch=req=>{
    const run=async():Promise<GoldfishReviewerResult>=>{
      if(req.signal.aborted||!opts.canContinue())return {status:'interrupted',reason:'Revisão interrompida.'};
      if(halted)return {status:'unavailable',reason:'Checkpoint não pôde ser confirmado.'};
      const key=req.stage+':'+req.role+':'+req.attempt,fp=fingerprint(req);
      const previous=checkpoint.entries.find(e=>e.key===key);
      if(previous){
        if(previous.fingerprint!==fp){halted=true;return {status:'unavailable',reason:'Entrada do revisor mudou; checkpoint preservado.'};}
        if(previous.result&&previous.finishedAt)return previous.result;
        halted=true;return {status:'unavailable',reason:'Tentativa anterior com resultado incerto; não repetida automaticamente.'};
      }
      const entry:Entry={key,fingerprint:fp,stage:req.stage,role:req.role,attempt:req.attempt,startedAt:new Date().toISOString()};
      const started={...checkpoint,entries:[...checkpoint.entries,entry]};
      try{
        if(!await opts.save(started)){halted=true;return {status:'interrupted',reason:'Lease ou mensagem perdeu autorização.'};}
      }catch{halted=true;return {status:'unavailable',reason:'Não foi possível registrar a tentativa antes da chamada.'};}
      checkpoint=started;
      usage=undefined;
      let result:GoldfishReviewerResult;
      try{result=await opts.dispatch(req);}
      catch{halted=true;return {status:'unavailable',reason:'Resultado da chamada incerto; não será repetida.'};}
      const finished={...checkpoint,entries:checkpoint.entries.map(e=>e.key===key?{...e,finishedAt:new Date().toISOString(),result,...(usage?{usage}: {})}:e)};
      try{
        if(!await opts.save(finished)){halted=true;return {status:'interrupted',reason:'Não foi possível confirmar o resultado no checkpoint.'};}
      }catch{halted=true;return {status:'unavailable',reason:'Resultado não confirmado; nenhuma repetição automática.'};}
      checkpoint=finished;
      return result;
    };
    const p=tail.then(run);tail=p.catch(()=>undefined);return p;
  };
  return {dispatch,onUsage,state:()=>checkpoint,totals:()=>reviewTotals(checkpoint)};
}
