import { createHash } from 'node:crypto';
import type { ResolutionDecision } from './review-resolution';
import { runProcess,minimalEnv } from '../../../common/exec';

type CriterionSpec={key:string;kind:string;config:unknown};
export type GoldfishProof={actionId:string;criterionKey:string;scenario:string;command:string};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const meaningful=(s:string)=>!!s.trim()&&!/^(?:true|:|exit 0|echo\s+.*|printf\s+.*|test\s+-[fdes]\s+.*)$/i.test(s.trim());
export function bindGoldfishProofs(decisions:readonly ResolutionDecision[],criteria:readonly CriterionSpec[],steps:readonly {verifyCommand?:string|null}[]):GoldfishProof[]{
  return decisions.filter(d=>d.category==='PROPOSE FIX').map(d=>{
    const c=criteria.find(c=>c.key===d.criterionKey);
    if(!d.criterionKey||!d.scenario?.trim()||!c||c.kind!=='COMMAND'||!obj(c.config)||typeof c.config.command!=='string'||!meaningful(c.config.command)||![undefined,0].includes(c.config.expectExitCode as number|undefined))throw Error('Achado '+d.actionId+' exige critério COMMAND final e cenário de regressão específico.');
    const command=c.config.command.trim();
    if(steps.some(s=>s.verifyCommand?.trim()===command))throw Error('Não duplique a suíte final de '+d.actionId+' na conferência de etapa.');
    return {actionId:d.actionId,criterionKey:d.criterionKey,scenario:d.scenario,command};
  });
}
export function assertGoldfishProofContracts(proofs:readonly GoldfishProof[],criteria:readonly CriterionSpec[]):void{
  for(const p of proofs){
    const c=criteria.find(c=>c.key===p.criterionKey);
    if(!c||c.kind!=='COMMAND'||!obj(c.config)||typeof c.config.command!=='string'||c.config.command.trim()!==p.command||![undefined,0].includes(c.config.expectExitCode as number|undefined))throw Error('Critério de regressão alterado ou ausente: '+p.actionId);
  }
}
export function goldfishProofEvidence(stdout:string,proofs:readonly GoldfishProof[]){
  const accepted=new Set<string>(),invalid=new Set<string>();
  for(const line of stdout.split(/\r?\n/)){
    const prefix='NIVOO_EGM_EVIDENCE ';
    if(!line.startsWith(prefix))continue;
    let item:unknown;try{item=JSON.parse(line.slice(prefix.length));}catch{continue;}
    if(!obj(item)||typeof item.actionId!=='string')continue;
    const p=proofs.find(p=>p.actionId===item.actionId);
    if(!p)continue;
    if(item.passed!==true||item.scenario!==p.scenario)invalid.add(p.actionId);
    else accepted.add(p.actionId);
  }
  return {observed:proofs.filter(p=>accepted.has(p.actionId)&&!invalid.has(p.actionId)).map(p=>({actionId:p.actionId,scenario:p.scenario})),missing:proofs.filter(p=>!accepted.has(p.actionId)||invalid.has(p.actionId)).map(p=>p.actionId)};
}
export type GitDrift={status:'unchanged'|'changed'|'unavailable';base:string;current:string|null;paths:string[];targetChanged:boolean|null;detail:string};
/** Git-level drift, not semantic analysis of the design. Never infer that
 * unlisted dependencies are unaffected or that implementation conforms. */
export async function detectGoldfishGitDrift(repo:string,base:string,targetPath:string,signal?:AbortSignal):Promise<GitDrift>{
  const unavailable=(detail:string,current:string|null=null):GitDrift=>({status:'unavailable',base,current,paths:[],targetChanged:null,detail});
  if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base))return unavailable('Base inválida.');
  const options={cwd:repo,env:minimalEnv(),timeoutMs:60000,signal,maxBuffer:4*1024*1024};
  const current=await runProcess('git',['-C',repo,'rev-parse','--verify','main^{commit}'],options);
  if(current.exitCode!==0||current.aborted||current.timedOut)return unavailable('Não foi possível consultar main.');
  const head=current.stdout.trim();
  if(head===base)return {status:'unchanged',base,current:head,paths:[],targetChanged:false,detail:'Identidade Git preservada; não comprova conformidade semântica.'};
  const diff=await runProcess('git',['-C',repo,'diff','--name-only','--no-renames','-z',base,head,'--'],options);
  if(diff.exitCode!==0||diff.aborted||diff.timedOut)return unavailable('Não foi possível listar alterações entre as revisões.',head);
  const paths=diff.stdout.split('\0').filter(Boolean);
  return {status:'changed',base,current:head,paths:paths.slice(0,200),targetChanged:paths.includes(targetPath),detail:'Base mudou; '+paths.length+' caminho(s) alterado(s). '+(paths.length>200?'Lista limitada a 200. ':'')+'A ausência do documento na lista não exclui divergência semântica.'};
}
export function renderGoldfishGitDrift(drift:GitDrift):string{
  return ['EGM — divergência de revisão Git (não é parecer semântico): '+drift.status,'Base '+drift.base+' / atual '+(drift.current??'indisponível'),drift.detail,...drift.paths.map(p=>'- '+JSON.stringify(p))].join('\n');
}
export function proofSetHash(proofs:readonly GoldfishProof[]):string{return createHash('sha256').update(JSON.stringify(proofs)).digest('hex');}
