import { minimalEnv,runProcess } from '../../../common/exec';
import { goldfishSource,type GoldfishDispatch,type GoldfishReference } from './review-pipeline';
import { type EgmBaseline } from './lite-routing';
import { validRelative } from './review-http';

export type LiteMode='lite-spec'|'lite-diff';
export type LiteIntake={mode:LiteMode;sourceId:string;revision:string;target:GoldfishReference};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const sha=(s:string)=>/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
const MAX_INPUT=100*1024;
export function liteRequest(text:string):{mode:LiteMode;id:string}|null{
  const m=/^\/goldfish-lite(?:\s+(spec|diff))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if(!m)return null;
  if(!m[1]||!m[2]||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m[2].trim()))throw Error('Use /goldfish-lite spec <id do plano> ou /goldfish-lite diff <id do trabalho>.');
  return {mode:m[1].toLowerCase()==='spec'?'lite-spec':'lite-diff',id:m[2].trim()};
}
function boundedTarget(content:string):GoldfishReference{
  if(!content.trim()||Buffer.byteLength(content)>MAX_INPUT)throw Error('Entrada Lite excede 100 KiB ou está vazia; cobertura não será truncada.');
  return {path:'lite-review.md',content};
}
/** Only structured plan data, not chat, memory, author reasoning or the
 * planner's narrative. No source tree or diff for the specification reviewer. */
export function litePlanTarget(plan:unknown,requirements:string):GoldfishReference{
  if(!obj(plan)||typeof plan.objective!=='string'||!Array.isArray(plan.steps)||!plan.steps.length||!Array.isArray(plan.criteria)||!plan.criteria.length)throw Error('Checklist persistido inválido.');
  const steps=plan.steps.map(s=>{
    if(!obj(s)||typeof s.key!=='string'||typeof s.instructions!=='string')throw Error('Etapa inválida.');
    return {key:s.key,instructions:s.instructions,dependsOn:s.dependsOn??[],verifyCommand:s.verifyCommand??null};
  });
  const criteria=plan.criteria.map(c=>{
    if(!obj(c)||typeof c.key!=='string'||typeof c.kind!=='string')throw Error('Critério inválido.');
    return {key:c.key,kind:c.kind,description:c.description,config:c.config};
  });
  return boundedTarget(['# Requisitos do usuário (dados)',requirements,'# Checklist a avaliar',JSON.stringify({objective:plan.objective,steps,criteria},null,2)].join('\n'));
}
async function gitText(repo:string,args:string[],signal:AbortSignal,maxBuffer=1024*1024){
  const r=await runProcess('git',['-C',repo,...args],{cwd:repo,env:minimalEnv({GIT_OPTIONAL_LOCKS:'0'}),signal,timeoutMs:60000,maxBuffer});
  if(r.exitCode!==0||r.aborted||r.timedOut||r.spawnError||Buffer.byteLength(r.stdout)>=maxBuffer)throw Error('Não foi possível obter integralmente a evidência Git.');
  return r.stdout;
}
/** A completed squash commit is the exact published result. Only accept
 * the recorded clean baseline as its sole parent; do not conflate other jobs,
 * uncommitted prior edits, ignored files, or a rebased tree with task changes. */
export async function liteDiffTarget(repo:string,baseline:EgmBaseline,revision:string,checklist:GoldfishReference,signal:AbortSignal):Promise<GoldfishReference>{
  if(!baseline.complete||!baseline.commit||baseline.dirty.length||!sha(baseline.commit)||!sha(revision)||baseline.commit===revision)throw Error('Base inicial limpa e resultado incorporado distinto não comprovados; não é possível revisar o diff integral.');
  const parents=(await gitText(repo,['rev-list','--parents','-n','1',revision],signal)).trim().split(/\s+/);
  if(parents.length!==2||parents[0]!==revision||parents[1]!==baseline.commit)throw Error('A incorporação não tem a base original como pai único; alterações de outros trabalhos não serão atribuídas a este.');
  const list=await gitText(repo,['diff','--name-only','--no-renames','-z',baseline.commit,revision,'--'],signal);
  if(!list.endsWith('\0'))throw Error('Inventário incompleto ou sem alterações.');
  const paths=list.split('\0').filter(Boolean);
  if(!paths.length||paths.some(p=>!validRelative(p)))throw Error('Diff inclui arquivo protegido ou não autorizado; cobertura integral indisponível.');
  // Reject binary changes and non-regular files, including symlinks and submodules.
  const stat=await gitText(repo,['diff','--numstat','--no-renames','-z',baseline.commit,revision,'--'],signal);
  if(stat.split('\0').some(s=>/^-	-	/.test(s)))throw Error('Diff contém alterações binárias; revisão Lite textual indisponível.');
  const raw=await gitText(repo,['diff','--raw','--no-renames','--no-abbrev',baseline.commit,revision,'--'],signal);
  if(raw.split('\n').filter(Boolean).some(s=>!/^:(?:000000|100644|100755) (?:000000|100644|100755) /.test(s)))throw Error('Diff contém tipo de arquivo não regular; cobertura integral indisponível.');
  const patch=await gitText(repo,['-c','core.quotePath=true','diff','--no-ext-diff','--no-textconv','--no-renames','--full-index','--unified=1000000',baseline.commit,revision,'--'],signal);
  if(!patch.trim()||/^(?:Binary files .* differ|GIT binary patch)$/m.test(patch))throw Error('Diff textual integral indisponível.');
  return boundedTarget([checklist.content,'# Base e resultado incorporado',baseline.commit+' → '+revision,'# Inventário de alterações',JSON.stringify(paths),'# Diff completo dos arquivos alterados',patch].join('\n'));
}
export type LiteResult={status:'lgtm'|'findings'|'incomplete';mode:LiteMode;sourceId:string;revision:string;report:string;sessionId?:string};
export function parseLiteResult(report:string):LiteResult['status']{
  const t=report.trim();
  if(t==='[✅ LGTM]')return 'lgtm';
  if(!t||/\bLGTM\b/i.test(t)||/NIVOO_LITE_INCOMPLETE/.test(t))return 'incomplete';
  return /(?:^|\n)\s*(?:[-*]\s*)?\[P[0-3]\]\s+\S/.test(t)?'findings':'incomplete';
}
export async function runLiteReview(intake:LiteIntake,dispatch:GoldfishDispatch,signal:AbortSignal):Promise<LiteResult>{
  const base={mode:intake.mode,sourceId:intake.sourceId,revision:intake.revision};
  if(signal.aborted)return {...base,status:'incomplete',report:'Revisão interrompida.'};
  const spec=intake.mode==='lite-spec';
  const original=goldfishSource('skills/egm-lite/SKILL.md');
  const rubric=spec?original.slice(original.indexOf('### 2B.'),original.indexOf('## 3. EXEC PROTOCOL')):original.slice(original.indexOf('## 4. ADVERSARIAL DIFF REVIEW'),original.indexOf('## 5. POST-REVIEW RESOLUTION GATE'));
  if(!rubric.trim())throw Error('Rubrica original Lite não localizada.');
  const result=await dispatch({stage:spec?7:9,role:intake.mode,attempt:1,revision:intake.revision,persona:[rubric,'Você é o revisor independente, não o orquestrador. O Nivoo já delegou a sessão. Não invoque agentes, não altere arquivos. '+(spec?'Avalie somente a especificação; não solicite AST nem diff.':'Avalie o diff e checklist completos fornecidos, incluindo testes e limites.'),'Contrato binário: responda exclusivamente [✅ LGTM] se estritamente zero achados; caso contrário somente achados materiais, cada um em linha iniciada por [P0], [P1], [P2] ou [P3], com evidência e proposta. Se entrada insuficiente, responda NIVOO_LITE_INCOMPLETE e a limitação.'].join('\n'),target:{path:intake.target.path,ranges:[{start:1,end:intake.target.content.split('\n').length,text:intake.target.content}]},baseline:[],priorReports:[],access:'document-only',signal});
  if(result.status!=='completed')return {...base,status:'incomplete',report:result.reason};
  if(!result.receipt.sessionId||result.receipt.freshContext!==true||result.receipt.readOnly!==true||result.receipt.access!=='document-only')return {...base,status:'incomplete',report:'Recibo independente inválido.'};
  return {...base,status:parseLiteResult(result.report),report:result.report,sessionId:result.receipt.sessionId};
}
export function renderLiteResult(result:LiteResult):string{
  return ['# Goldfish Lite — '+(result.mode==='lite-spec'?'especificação':'diff incorporado'),'Origem '+result.sourceId+'; revisão '+result.revision,'Resultado: '+result.status,result.report,result.status==='lgtm'?'Parecer do revisor, não comprovação de ausência de defeitos nem autorização de execução.':result.status==='findings'?'Avalie os achados no contexto Elephant e aprove qualquer ajuste em novo plano. Nenhuma correção automática iniciada.':'Cobertura incompleta. Não interpretar como aprovação.'].join('\n\n');
}
