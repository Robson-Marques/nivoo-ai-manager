import { MAX_OCORRENCIAS_MESMA_FALHA,repeticoesDoMesmoErro } from '../../jobs/recovery-signature';
import { falhaLocalCorrigivel } from '../deterministic-media-errors';
import { sha256 } from '../../common/hash';

type FailureJob={maxAttemptsPerStep:number};
type SessionJob={repetitionWindow:number;maxSessionsPerStep:number};
type Session={error:string|null;treeBefore:string|null;treeAfter:string|null;notesIngested:number};
export function decideFailedAttempt(job:FailureJob,errors:Array<string|null>,current:string,command:string,providerId:string,isAi:boolean,diagnostic:string){
  const repetitions=repeticoesDoMesmoErro(errors,current,command);
  if(current.trim()&&job.maxAttemptsPerStep>0&&job.maxAttemptsPerStep<MAX_OCORRENCIAS_MESMA_FALHA&&repetitions>=job.maxAttemptsPerStep)
    return {kind:'limit' as const,repetitions,detail:'limite configurado de '+job.maxAttemptsPerStep+' tentativa(s) para o mesmo erro atingido'};
  if(current.trim()&&repetitions>=MAX_OCORRENCIAS_MESMA_FALHA)
    return {kind:'repeat' as const,repetitions,detail:'o mesmo erro ocorreu '+repetitions+' vezes nesta etapa; interrompido para não repetir indefinidamente: '+current.slice(-700)};
  if(!isAi&&providerId==='local-shell'&&falhaLocalCorrigivel(diagnostic))return {kind:'repair' as const,repetitions};
  return {kind:'retry' as const,repetitions};
}
export function repeatedSessionVerification(sessions:Session[],command:string):string|null{
  const current=sessions[0]?.error??'';
  const errors=sessions.map(a=>a.error).filter((e):e is string=>!!e&&e.startsWith('verificação da etapa falhou'));
  return current.startsWith('verificação da etapa falhou')&&repeticoesDoMesmoErro(errors,current,command)>=MAX_OCORRENCIAS_MESMA_FALHA
    ? 'a mesma conferência da etapa falhou três vezes (sem contar erros distintos): '+current.slice(-600):null;
}
export function decideSessionContinuation(job:SessionJob,sessions:Session[]){
  const recent=sessions.slice(0,MAX_OCORRENCIAS_MESMA_FALHA);
  if(recent.length>=MAX_OCORRENCIAS_MESMA_FALHA&&recent.every(a=>a.treeBefore===a.treeAfter&&a.notesIngested===0))
    return {kind:'repeat' as const,detail:'as últimas '+recent.length+' sessões terminaram sem alterar nenhum arquivo e sem anotar progresso'};
  const window=Math.max(8,job.repetitionWindow*4);
  if(sessions.length>=window&&sessions.slice(0,window).every(a=>a.treeBefore===a.treeAfter))
    return {kind:'repeat' as const,detail:'as últimas '+window+' sessões só anotaram progresso, sem alterar nenhum arquivo do trabalho'};
  if(job.maxSessionsPerStep>0&&sessions.length>=job.maxSessionsPerStep)
    return {kind:'limit' as const,detail:'limite de '+job.maxSessionsPerStep+' sessões sem concluir a etapa'};
  return {kind:'continue' as const};
}
/** Stable, distinct key for long step names; a retry of the same attempt is idempotent. */
export function repairKey(key:string,number:number):string{
  const stem=key.replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase();
  return 'reparo-'+stem.slice(0,20)+'-'+sha256(key).slice(0,8)+'-'+number;
}
