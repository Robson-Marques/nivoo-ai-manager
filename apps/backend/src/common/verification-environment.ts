import { ambienteDaConferencia, faltaCredencial, problemaDoAmbiente, portaLivre, type RunResult } from './exec';
import { prepararBancoDeTeste } from './banco-de-teste';
import { referenciasDaConferencia, variaveisDaConferencia } from '../accounts/secrets';
import { getGitAccount } from '../git/git-accounts';

export type VerificationProblem = { kind:'infrastructure'|'credential'|'tool'; detail:string };
type Prepared = {ok:true; env:NodeJS.ProcessEnv; redact:(s:string)=>string} | {ok:false; problem:VerificationProblem};

/** Same environment for slice checks and final criteria. No extra provider
 * call or preflight command: this replaces preparation at the existing check. */
export async function prepareVerificationEnvironment(projectId:string,jobId:string,outputDir:string,mediaDir:string):Promise<Prepared>{
  const vars:Record<string,string>={...variaveisDaConferencia(projectId)};
  for(const [name,account] of Object.entries(referenciasDaConferencia(projectId))){
    try { vars[name]=getGitAccount(account).token; }
    catch { return {ok:false,problem:{kind:'credential',detail:'A conta Git vinculada à variável da conferência '+name+' não está disponível.'}}; }
  }
  let banco:Awaited<ReturnType<typeof prepararBancoDeTeste>>;
  try { banco=await prepararBancoDeTeste(jobId); if(process.env.NIVOO_TESTES_PG_URL&&!banco)throw Error('configuração inválida'); }
  catch { return {ok:false,problem:{kind:'infrastructure',detail:'Não foi possível preparar o PostgreSQL descartável configurado no Nivoo. Confira o serviço e NIVOO_TESTES_PG_URL.'}}; }
  let porta:number;
  try { porta=await portaLivre(); }
  catch { return {ok:false,problem:{kind:'infrastructure',detail:'Não foi possível reservar uma porta local para a conferência.'}}; }
  const env=ambienteDaConferencia({...vars,NIVOO_JOB_ID:jobId,NIVOO_OUTPUT_DIR:outputDir,NIVOO_PORTA_TESTE:String(porta),NIVOO_MIDIA_DIR:mediaDir,...(banco?.env??{})});
  const secrets=[...Object.values(vars),...Object.entries(banco?.env??{}).filter(([k])=>/PASSWORD|URL/.test(k)).map(([,v])=>v)];
  // Redact exact configured values in persisted command output. This does
  // not claim isolation against arbitrary code or transformed secret values.
  const values=[...new Set(secrets.filter(v=>v.length>0))].sort((a,b)=>b.length-a.length);
  return {ok:true,env,redact:(s:string)=>values.reduce((out,value)=>out.split(value).join('[SEGREDO]'),s)};
}

/** Only classify failures attributable to platform/credentials or a directly
 * invoked missing tool. A missing dependency inside npm test is project code. */
export function verificationProblem(r:Pick<RunResult,'exitCode'|'stdout'|'stderr'|'aborted'|'timedOut'|'spawnError'>,command:string):VerificationProblem|null{
  if(r.aborted||r.timedOut)return null;
  if(r.spawnError)return {kind:'infrastructure',detail:'Não foi possível iniciar o processo de verificação: '+r.spawnError.slice(0,300)};
  if(r.exitCode===0)return null;
  const output=r.stdout+'\n'+r.stderr;
  const infra=problemaDoAmbiente(output);
  if(infra)return {kind:'infrastructure',detail:infra};
  // Require package-manager context; a 401 from the application under test
  // must not be mistaken for a missing package-registry credential.
  const credential=/(?:npm (?:error|ERR!) code E40[13]|ERR_PNPM_FETCH_40[13]|(?:pip|yarn)[^\n]*(?:40[13]|Unauthorized|Forbidden)|(?:registry|packages?\/npm|artifactory|nexus)[^\n]*(?:40[13]|Unauthorized|Forbidden))/i.test(output)?faltaCredencial(output):null;
  if(credential)return {kind:'credential',detail:credential};
  if(r.exitCode===127){
    const missing=/(?:^|[\s:])([A-Za-z0-9_./-]+): (?:command not found|comando não encontrado|not found)/m.exec(output)?.[1];
    const direct=command.split(/&&|\|\||;|\|/).map(s=>s.trim().replace(/^\(+\s*/,'').split(/\s+/)[0]);
    if(missing&&!missing.startsWith('.')&&(!missing.includes('/')||/^\/(?:usr\/local\/bin|usr\/bin|bin)\//.test(missing))&&direct.includes(missing))return {kind:'tool',detail:missing};
  }
  return null;
}
export function redactVerificationResult(r:RunResult,redact:(s:string)=>string):RunResult{
  return {...r,stdout:redact(r.stdout),stderr:redact(r.stderr),...(r.spawnError?{spawnError:redact(r.spawnError)}:{})};
}
export function verificationPassed(r:Pick<RunResult,'exitCode'|'timedOut'|'aborted'|'spawnError'>,expected=0):boolean{
  return r.exitCode===expected&&!r.timedOut&&!r.aborted&&!r.spawnError;
}
