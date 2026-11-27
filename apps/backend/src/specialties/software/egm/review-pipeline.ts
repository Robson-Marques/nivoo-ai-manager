import planning from './planning-upstream.json';
import review from './review-upstream.json';
import { createHash } from 'node:crypto';

export type GoldfishStage=5|6|7|8|9;
export type GoldfishPreset='uninterrupted'|'feature_spec'|'implementation'|GoldfishStage;
type TargetRange='full'|'feature'|'detailed'|'both';
type ReviewerSpec={role:string;persona:string;standard?:string};
export type GoldfishPhase={stage:GoldfishStage;range:TargetRange;baseline:boolean;report:string;reviewers:readonly ReviewerSpec[]};

const STANDARD='resources/document_standards/';
const phaseSpecs:readonly GoldfishPhase[]=[
  {stage:5,range:'full',baseline:true,report:'zoom_out_report.md',reviewers:[
    {role:'egm-zoom-out',persona:'agents/zoom_out.md',standard:STANDARD+'zoom-out-standard.md'},
    {role:'egm-inventive-catalyst',persona:'agents/inventive_catalyst.md'}]},
  {stage:6,range:'both',baseline:false,report:'comprehension_report.md',reviewers:[
    {role:'egm-comprehension',persona:'agents/comprehension.md'}]},
  {stage:7,range:'feature',baseline:true,report:'critic_report.md',reviewers:[
    {role:'egm-design',persona:'agents/design_critic.md',standard:STANDARD+'feature-spec-standard.md'},
    {role:'egm-structural',persona:'agents/structural.md',standard:STANDARD+'feature-spec-standard.md'},
    {role:'egm-style',persona:'agents/style.md'}]},
  {stage:8,range:'full',baseline:true,report:'intermediate_zoom_out_report.md',reviewers:[
    {role:'egm-zoom-out',persona:'agents/zoom_out.md',standard:STANDARD+'zoom-out-standard.md'}]},
  {stage:9,range:'detailed',baseline:true,report:'implementation_readiness_report.md',reviewers:[
    {role:'egm-implementation-readiness',persona:'agents/implementation_readiness.md',standard:STANDARD+'implementation-readiness-standard.md'},
    {role:'egm-codebase-details',persona:'agents/codebase_details.md',standard:STANDARD+'implementation-readiness-standard.md'},
    {role:'egm-style',persona:'agents/style.md'}]},
];
const sources=new Map([...planning.files,...review.files].map(f=>[f.path,f] as const));
export const GOLDFISH_SOURCE_REVISION=review.revision;
export function goldfishSource(path:string):string{
  if(planning.revision!==review.revision)throw Error('Revisões EGM divergentes.');
  const f=sources.get(path);
  if(!f)throw Error('Fonte original EGM ausente: '+path);
  const b=Buffer.from(f.content,'utf8');
  const sha=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
  if(sha!==f.sha)throw Error('Fonte original EGM alterada: '+path);
  return f.content;
}

export type DocumentRange={start:number;end:number;text:string};
type DocumentSplit={full:DocumentRange;feature:DocumentRange;detailed:DocumentRange|null};
const implementationHeading=/^ {0,3}##[ \t]+(?:detailed implementation plan|implementation plan|work breakdown|implementation steps|plano detalhado de implementa[cç][aã]o|plano de implementa[cç][aã]o|etapas de implementa[cç][aã]o)[ \t]*#*[ \t]*$/i;

/** Preserve line numbers. Ignore examples inside fenced Markdown blocks.
 * Never guess which of multiple implementation headings is authoritative. */
export function splitGoldfishDocument(document:string,explicitBoundary?:number):DocumentSplit{
  if(!document.trim())throw Error('Documento de revisão vazio.');
  const lines=document.split(/\r?\n/);
  const range=(start:number,end:number):DocumentRange=>({start,end,text:lines.slice(start-1,end).join('\n')});
  const full=range(1,lines.length);
  const matches:number[]=[];
  let fence:{char:string;length:number}|null=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],m=/^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if(m){
      if(!fence)fence={char:m[1][0],length:m[1].length};
      else if(m[1][0]===fence.char&&m[1].length>=fence.length&&!m[2].trim())fence=null;
      continue;
    }
    if(!fence&&implementationHeading.test(line))matches.push(i+1);
  }
  if(explicitBoundary!==undefined&&(!Number.isInteger(explicitBoundary)||explicitBoundary<2||explicitBoundary>lines.length))throw Error('Limite semântico inválido.');
  if(explicitBoundary===undefined&&matches.length>1)throw Error('Limite semântico ambíguo; informe a linha de implementação.');
  const boundary=explicitBoundary??matches[0];
  if(boundary===undefined)return {full,feature:full,detailed:null};
  if(boundary<2||!lines.slice(boundary-1).some(s=>s.trim()))throw Error('Faixa de implementação inválida.');
  return {full,feature:range(1,boundary-1),detailed:range(boundary,lines.length)};
}

export function goldfishPhases(preset:GoldfishPreset,split:DocumentSplit):GoldfishPhase[]{
  const valid:readonly GoldfishPreset[]=['uninterrupted','feature_spec','implementation',5,6,7,8,9];
  if(!valid.includes(preset))throw Error('Modo de revisão EGM inválido.');
  const stages=preset==='uninterrupted'?[5,6,7,8,9]:preset==='feature_spec'?[5,6,7,8]:preset==='implementation'?[9]:[preset];
  if(stages.includes(9)&&!split.detailed)throw Error('Plano de implementação ausente; use revisão apenas da especificação ou informe a fronteira.');
  return phaseSpecs.filter(p=>stages.includes(p.stage));
}

export type GoldfishReference={path:string;content:string};
export type GoldfishReviewerRequest={
  stage:GoldfishStage;role:string;attempt:1|2;revision:string;
  persona:string;standard?:string;
  target:{path:string;ranges:readonly DocumentRange[]};
  baseline:readonly GoldfishReference[];
  priorReports:readonly GoldfishReference[];
  access:'document-only'|'authorized-baseline';
  signal:AbortSignal;
};
export type GoldfishReviewerResult=
  |{status:'completed';report:string;receipt:{sessionId:string;freshContext:true;readOnly:true;access:GoldfishReviewerRequest['access']}}
  |{status:'failed'|'unavailable'|'interrupted';reason:string};
/** The transport, NOT the model's text, supplies the receipt. The adapter must
 * enforce fresh context, actual read-only isolation and filesystem access. */
export type GoldfishDispatch=(request:GoldfishReviewerRequest)=>Promise<GoldfishReviewerResult>;
export type GoldfishReviewerRecord={role:string;attempts:number;status:'completed'|'not-run';report?:string;sessionId?:string;reason?:string};
export type GoldfishPhaseRecord={stage:GoldfishStage;reportPath:string;status:'complete'|'incomplete';reviewers:GoldfishReviewerRecord[];markdown:string};
export type GoldfishRunResult={status:'complete'|'incomplete'|'interrupted'|'unavailable';preset:GoldfishPreset;revision:string;phases:GoldfishPhaseRecord[];pendingStages:GoldfishStage[];coverage:'full-design'|'feature-only'|'implementation-only'|'single-stage';approved:false};
type RunInput={
  preset:GoldfishPreset;revision:string;target:GoldfishReference;
  baseline?:readonly GoldfishReference[];explicitBoundary?:number;
  /** An independently persisted stage 5 report is required for standalone 8. */
  initialZoomOutReport?:GoldfishReference;
  signal:AbortSignal;dispatch:GoldfishDispatch;
  onPhase?:(phase:GoldfishPhaseRecord)=>Promise<void>|void;
};
const coverage=(p:GoldfishPreset):GoldfishRunResult['coverage']=>p==='uninterrupted'?'full-design':p==='feature_spec'?'feature-only':p==='implementation'?'implementation-only':'single-stage';
const nonempty=(s:unknown):s is string=>typeof s==='string'&&!!s.trim();
const comprehensionComplete=(text:string)=>/What this proposes/i.test(text)&&/How the existing system works, per this document/i.test(text);

/** One uninterrupted pass of the upstream five-stage protocol. Stage ordering,
 * isolated requests, one retry for failed reviewers, explicit failure coverage.
 * It does not implement interactive remediation, claim approval, or start jobs.
 * No transport has been validated merely by calling this function. */
export async function runGoldfishReview(input:RunInput):Promise<GoldfishRunResult>{
  if(!nonempty(input.revision)||!nonempty(input.target.path))throw Error('Alvo ou revisão ausente.');
  // The upstream feature-only preset bypasses semantic split discovery.
  if(!input.target.content.trim())throw Error('Documento de revisão vazio.');
  const full={start:1,end:input.target.content.split(/\r?\n/).length,text:input.target.content};
  const effective=input.preset==='feature_spec'?{full,feature:full,detailed:null}:splitGoldfishDocument(input.target.content,input.explicitBoundary);
  const phases=goldfishPhases(input.preset,effective);
  if(input.preset===8&&!nonempty(input.initialZoomOutReport?.content))throw Error('A fase 8 isolada exige o parecer inicial da fase 5.');
  const results:GoldfishPhaseRecord[]=[];
  const sessions=new Set<string>();
  let stopped:'interrupted'|'unavailable'|null=null;
  for(const phase of phases){
    if(input.signal.aborted){stopped='interrupted';break;}
    const ranges=phase.range==='full'?[effective.full]:phase.range==='feature'?[effective.feature]:phase.range==='detailed'?[effective.detailed!]:[effective.feature,...(effective.detailed?[effective.detailed]:[])];
    const previous:GoldfishReference[]=phase.stage===8?[
      ...(input.initialZoomOutReport&&input.preset===8?[input.initialZoomOutReport]:[]),
      ...results.filter(p=>p.stage>=5&&p.stage<=7).map(p=>({path:p.reportPath,content:p.markdown})),
    ]:[];
    // Independent reviewer calls within a phase may run in parallel. The
    // caller's adapter owns quotas and cancellation; never send parent context.
    const records=await Promise.all(phase.reviewers.map(async spec=>{
      const req={stage:phase.stage,role:spec.role,revision:input.revision,
        persona:goldfishSource(spec.persona),...(spec.standard?{standard:goldfishSource(spec.standard)}:{}),
        target:{path:input.target.path,ranges:ranges.map(r=>({...r}))},
        baseline:phase.baseline?(input.baseline??[]).map(r=>({...r})):[],
        priorReports:previous.map(r=>({...r})),
        access:phase.baseline?'authorized-baseline' as const:'document-only' as const,signal:input.signal};
      let reason='Sem resposta do revisor.';
      for(const attempt of [1,2] as const){
        if(input.signal.aborted||stopped){return {role:spec.role,attempts:attempt-1,status:'not-run' as const,reason:input.signal.aborted?'Interrompido.':'Provedor indisponível.'};}
        let response:GoldfishReviewerResult;
        try{response=await input.dispatch({...req,attempt});}
        catch(e){response={status:'failed',reason:e instanceof Error?e.message:String(e)};}
        if(input.signal.aborted||response.status==='interrupted'){stopped='interrupted';return {role:spec.role,attempts:attempt,status:'not-run' as const,reason:'Interrompido.'};}
        if(response.status==='unavailable'){stopped=stopped??'unavailable';return {role:spec.role,attempts:attempt,status:'not-run' as const,reason:response.reason};}
        if(response.status==='completed'){
          const r=response.receipt;
          if(!r||r.freshContext!==true||r.readOnly!==true||r.access!==req.access||!nonempty(r.sessionId)||sessions.has(r.sessionId)){
            // Security boundary: do not retry through a transport whose isolation
            // has not been established, and do not retain the untrusted report.
            stopped=stopped??'unavailable';
            return {role:spec.role,attempts:attempt,status:'not-run' as const,reason:'Isolamento do revisor não comprovado pelo executor.'};
          }
          sessions.add(r.sessionId);
          if(nonempty(response.report)&&(phase.stage!==6||comprehensionComplete(response.report))){
            return {role:spec.role,attempts:attempt,status:'completed' as const,report:response.report,sessionId:r.sessionId};
          }
          reason=phase.stage===6?'Parecer de compreensão sem as duas paráfrases exigidas.':'Parecer vazio.';
        }else reason=response.reason;
      }
      return {role:spec.role,attempts:2,status:'not-run' as const,reason};
    }));
    const status=records.every(r=>r.status==='completed')?'complete':'incomplete';
    const markdown=['# Goldfish — fase '+phase.stage,'Revisão: '+input.revision,'Cobertura: '+status,...records.flatMap(r=>['','## '+r.role,r.status==='completed'?r.report!:'NÃO EXECUTADO: '+r.reason])].join('\n');
    const record:GoldfishPhaseRecord={stage:phase.stage,reportPath:phase.report,status,reviewers:records,markdown};
    results.push(record);
    await input.onPhase?.(record);
    if(stopped||input.signal.aborted)break;
  }
  const pendingStages=phases.filter(p=>!results.some(r=>r.stage===p.stage&&r.status==='complete')).map(p=>p.stage);
  return {status:input.signal.aborted?'interrupted':stopped??(pendingStages.length?'incomplete':'complete'),preset:input.preset,revision:input.revision,phases:results,pendingStages,coverage:coverage(input.preset),approved:false};
}
