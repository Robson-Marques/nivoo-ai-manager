import { randomUUID } from 'node:crypto';
import type { ExecutionResult } from '../providers/provider.interface';

/** Operator-only, exact project UUID. Never interpret chat as benchmark configuration. */
export function benchmarkVariant(projectId:string,reference=process.env.NIVOO_BENCHMARK_REFERENCE_PROJECT_ID):'reference'|'optimized'{
  return !!reference&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)&&projectId===reference?'reference':'optimized';
}
export function tokenCount(value:unknown):number|null{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
}
/** Provider-native counters. Claude final input excludes cache counters; its
 * interrupted-stream estimate is partial and must not be compared as complete. */
export function measuredUsage(result:ExecutionResult){
  const input=tokenCount(result.inputTokens),output=tokenCount(result.outputTokens);
  const cacheRead=tokenCount(result.cacheReadInputTokens),cacheWrite=tokenCount(result.cacheWriteInputTokens);
  const partial=!!result.usagePartial||!!result.interrupted||!!result.costEstimated;
  const inputTotal=result.inputExcludesCache?(input===null||cacheRead===null||cacheWrite===null?null:input+cacheRead+cacheWrite):input;
  const cost=typeof result.costUsd==='number'&&Number.isFinite(result.costUsd)&&result.costUsd>=0?result.costUsd:null;
  return {inputTokens:input,outputTokens:output,cacheReadInputTokens:cacheRead,cacheWriteInputTokens:cacheWrite,
    inputExcludesCache:!!result.inputExcludesCache,inputTotal,partial,complete:!partial&&inputTotal!==null&&output!==null,
    costUsd:cost,costEstimated:!!result.costEstimated};
}
type Call={projectId:string;provider:string;model?:string;phase:'planner'|'repair'|'execution'|'goldfish';messageId?:string;jobId?:string;stepId?:string;attemptId?:string;skillsVersion:string;skillIds?:readonly string[];promptChars?:number};
/** Exactly one underlying call. Start/end records make missing outcomes visible
 * (worker crash, exception, interruption); do not log prompts, errors or secrets. */
export async function measureAiCall(meta:Call,run:()=>Promise<ExecutionResult>):Promise<ExecutionResult>{
  const id=randomUUID(),started=Date.now();
  const common={...meta,model:meta.model??null,variant:benchmarkVariant(meta.projectId),callId:id};
  const emit=(event:string,extra:Record<string,unknown>)=>console.info('[NIVOO_TOKEN_BENCH] '+JSON.stringify({...common,event,at:new Date().toISOString(),...extra}));
  emit('start',{});
  try{
    const result=await run();
    emit('finish',{...measuredUsage(result),durationMs:Date.now()-started,exitCode:result.exitCode,interrupted:!!result.interrupted,resourceUnavailable:!!result.resourceUnavailable});
    return result;
  }catch(e){
    emit('finish',{...measuredUsage({exitCode:-1,output:'',usagePartial:true}),durationMs:Date.now()-started,exitCode:-1,exception:true});
    throw e;
  }
}
