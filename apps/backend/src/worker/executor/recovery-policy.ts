import { MAX_OCORRENCIAS_MESMA_FALHA,repeticoesDoMesmoErro } from '../../jobs/recovery-signature';
import { falhaLocalCorrigivel } from '../deterministic-media-errors';
import { sha256 } from '../../common/hash';

type FailureJob={maxAttemptsPerStep:number};
type SessionJob={repetitionWindow:number;maxSessionsPerStep:number};
type Session={error:string|null;treeBefore:string|null;treeAfter:string|null;notesIngested:number};
export function isRepairStep(key:string):boolean{return /^reparo-[a-z0-9_-]+-\d+$/.test(key);}
export function immutableCommandFailure(diagnostic:string):boolean{
  return /command not found|comando não encontrado|permission denied|permissão negada|(?:unrecognized|unknown) (?:arguments?|options?)|the following arguments are required:|invalid option|opção inválida|syntax error near unexpected token/i.test(diagnostic);
}
export function decideFailedAttempt(job:FailureJob,errors:Array<string|null>,current:string,command:string,providerId:string,isAi:boolean,diagnostic:string){
  const repetitions=repeticoesDoMesmoErro(errors,current,command);
  // Um TIMEOUT não é "repetição improdutiva de conteúdo": é problema de tempo.
  // Repeti-lo não deve virar REPETICAO_IMPRODUTIVA — quem governa é o orçamento
  // de tempo do job (maxDurationSec → LIMITE_TEMPO) e o teto de tentativas. Senão
  // 3 timeouts seguidos bloqueariam como "repetição" antes de o tempo total estourar.
  const ehTimeout=/^timeout após \d+\s*ms$/.test(current.trim());
  // Limite configurado baixo (< 3) é um teto de TOTAL de tentativas da etapa, não
  // de "mesmo erro": vale mesmo quando as falhas variam a cada tentativa. (errors já
  // inclui a tentativa FALHA atual, então errors.length é o total de tentativas.)
  if(current.trim()&&job.maxAttemptsPerStep>0&&job.maxAttemptsPerStep<MAX_OCORRENCIAS_MESMA_FALHA&&errors.length>=job.maxAttemptsPerStep)
    return {kind:'limit' as const,repetitions,detail:'limite configurado de '+job.maxAttemptsPerStep+' tentativa(s) na etapa atingido'};
  if(current.trim()&&!ehTimeout&&repetitions>=MAX_OCORRENCIAS_MESMA_FALHA)
    return {kind:'repeat' as const,repetitions,detail:'o mesmo erro ocorreu '+repetitions+' vezes nesta etapa; interrompido para não repetir indefinidamente: '+current.slice(-700)};
  if(!isAi&&providerId==='local-shell'&&immutableCommandFailure(diagnostic))return {kind:'blocked' as const,repetitions,detail:'Comando, argumento ou ambiente inválido; repetir sem corrigir a causa não resolve: '+current.slice(-1000)};
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
  // Sessões improdutivas (sem alterar arquivo e sem anotar progresso) param na
  // janela de repetição CONFIGURADA do job (repetitionWindow, padrão 2), não num
  // valor fixo: é o controle que o pedido/limites do trabalho definem.
  const janela=Math.max(2,job.repetitionWindow||2);
  const recent=sessions.slice(0,janela);
  const unchanged=(a:Session)=>!!a.treeBefore&&!!a.treeAfter&&a.treeBefore===a.treeAfter;
  if(recent.length>=janela&&recent.every(a=>unchanged(a)&&a.notesIngested===0))
    return {kind:'repeat' as const,detail:'as últimas '+recent.length+' sessões terminaram sem alterar nenhum arquivo e sem anotar progresso'};
  const window=Math.max(8,job.repetitionWindow*4);
  if(sessions.length>=window&&sessions.slice(0,window).every(unchanged))
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
