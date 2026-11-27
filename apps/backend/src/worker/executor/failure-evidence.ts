import type { ExecutionResult } from '../../providers/provider.interface';
import type { SkillVerification } from '../../specialties/skill-evidence';

export type FailureLayer='connector'|'provider'|'verification-environment'|'verification'|'executor'|'session'|'postcondition';
export type FailureKind='interrupted'|'resource'|'model'|'spawn'|'connector-exception'|'sandbox'|'credential'|'tool'|'infrastructure'|'timeout'|'check-failed'|'postcondition'|'incomplete-session'|'execution-error'|'unknown';
export type FailureEvidence={version:1;layer:FailureLayer;kind:FailureKind;detail:string;exitCode:number;stopReason?:string;verification?:SkillVerification};
export type ConnectorFailure={kind:'spawn'|'connector-exception'|'sandbox';detail:string};
type Input={result:ExecutionResult;beforeVerification:ExecutionResult;verification?:SkillVerification;environment?:string|null;credential?:string|null;tool?:string|null;media?:string|null;isAi:boolean;verified:boolean;attemptStatus:string};
const clip=(s:string)=>s.trim().slice(0,5000);
/** Attribute failures to the observed stage, not words in assistant output.
 * No probe, command, AI call or autonomous repair runs here. Unknown stays unknown. */
export function diagnoseAttempt(i:Input):FailureEvidence|null{
  const {result:r,beforeVerification:b}=i;
  if(i.attemptStatus==='SUCESSO')return null;
  const make=(layer:FailureLayer,kind:FailureKind,detail:string):FailureEvidence=>({
    version:1,layer,kind,detail:clip(detail)||'Causa não identificada pelo executor.',exitCode:r.exitCode,
    ...(r.stopReason?{stopReason:r.stopReason}:{}),...(i.verification?{verification:i.verification}:{})
  });
  const actual=r.error||'Executor não informou causa (exit '+r.exitCode+').';
  if(r.interrupted)return make(i.verification?.state==='interrupted'?'verification':'session','interrupted',actual);
  if(b.connectorFailure){
    const c=b.connectorFailure;
    return make('connector',c.kind,c.detail);
  }
  if(b.stopReason==='model_incompatible')return make('provider','model',b.error||actual);
  if(b.resourceUnavailable)return make('provider','resource',b.error||actual);
  if(i.credential)return make('verification-environment','credential',i.credential);
  if(i.environment)return make('verification-environment','infrastructure',i.environment);
  if(i.tool)return make('verification-environment','tool',i.tool);
  if(i.media)return make('postcondition','postcondition',i.media);
  if(['repair_no_change','file_operation_postcondition','visual_asset_error'].includes(r.stopReason??''))return make('postcondition','postcondition',actual);
  if(i.verification?.state==='failed')return make('verification',i.verification.timedOut?'timeout':'check-failed',actual);
  if(b.sessionEnded)return make('session','incomplete-session',actual);
  if(!i.isAi)return make('executor',/^timeout após \d+ ms$/.test(b.error??'')?'timeout':'execution-error',actual);
  if(!i.verified&&b.exitCode===0)return make('postcondition','postcondition',actual);
  return make('provider','unknown',actual);
}
export function formatFailureEvidence(e:FailureEvidence):string{
  return 'Origem observada: '+e.layer+' / '+e.kind+' — '+e.detail;
}
