import { createHash } from 'node:crypto';
import type { ResolutionDecision,ResolutionLedger } from './review-resolution';
import { bindGoldfishProofs,type GoldfishProof } from './resolution-proof';

type StepSpec={key:string;instructions:string;verifyCommand?:string|null;provider?:string|null};
type BoundAction={id:string;findingIds:string[];severity:string;scope:string;decision:ResolutionDecision};
export type ApprovedGoldfishResolution={version:1;reviewMessageId:string;revision:string;targetPath:string;actions:BoundAction[];steps:{key:string;fingerprint:string;verifyCommand:string}[];proofs?:GoldfishProof[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint=(s:StepSpec)=>hash([s.key,s.instructions.trim(),s.verifyCommand?.trim()||null,s.provider?.trim()||null]);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(v);
const meaningful=(s:string)=>!!s.trim()&&!/^(?:true|:|exit 0|echo\s+.*)$/i.test(s.trim());

export function bindApprovedGoldfish(reviewMessageId:string,ledger:ResolutionLedger,decisions:readonly ResolutionDecision[],steps:readonly StepSpec[],criteria?:readonly {key:string;kind:string;config:unknown}[]):ApprovedGoldfishResolution{
  if(!sha(ledger.revision)||!ledger.ready||!reviewMessageId)throw Error('Revisão Goldfish não vinculável.');
  const bound=steps.map(s=>{
    if(!s.verifyCommand||!meaningful(s.verifyCommand))throw Error('Correção Goldfish sem comando de verificação significativo: '+s.key);
    return {key:s.key,fingerprint:fingerprint(s),verifyCommand:s.verifyCommand.trim()};
  });
  return {version:1,reviewMessageId,revision:ledger.revision,targetPath:ledger.targetPath,
    actions:ledger.actions.map(a=>{
      const decision=decisions.find(d=>d.actionId===a.id);
      if(!decision)throw Error('Achado sem decisão.');
      return {id:a.id,findingIds:[...a.findingIds],severity:a.severity,scope:a.scope,decision:{...decision}};
    }),steps:bound,...(criteria?{proofs:bindGoldfishProofs(decisions,criteria,steps)}:{})};
}

/** Missing field is a legacy non-EGM job. Invalid field must never silently
 * downgrade a bound repair to an ordinary job. */
export function approvedGoldfish(raw:unknown):ApprovedGoldfishResolution|null{
  if(!obj(raw)||raw.egmResolution===undefined)return null;
  const b=raw.egmResolution;
  if(!obj(b)||b.version!==1||!sha(b.revision)||typeof b.reviewMessageId!=='string'||!b.reviewMessageId||typeof b.targetPath!=='string'||!Array.isArray(b.actions)||!Array.isArray(b.steps)||!b.steps.length||!b.actions.length)throw Error('Vínculo Goldfish aprovado inválido.');
  const result=b as unknown as ApprovedGoldfishResolution;
  const stepKeys=new Set<string>();
  for(const s of result.steps){
    if(!obj(s)||typeof s.key!=='string'||stepKeys.has(s.key)||typeof s.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(s.fingerprint)||typeof s.verifyCommand!=='string'||!meaningful(s.verifyCommand))throw Error('Etapa Goldfish aprovada inválida.');
    stepKeys.add(s.key);
  }
  const actions=new Set<string>(),used=new Set<string>();
  for(const a of result.actions){
    if(!obj(a)||typeof a.id!=='string'||actions.has(a.id)||!Array.isArray(a.findingIds)||!a.findingIds.length||typeof a.scope!=='string'||!['Blocker','Major','Nit'].includes(a.severity)||!obj(a.decision)||a.decision.actionId!==a.id||!['PROPOSE FIX','CONTEST','ESCALATE','DECLINE'].includes(a.decision.category))throw Error('Ação Goldfish aprovada inválida.');
    actions.add(a.id);
    if(a.decision.category==='PROPOSE FIX'){
      if(!a.decision.stepKey||!stepKeys.has(a.decision.stepKey))throw Error('Ação sem etapa aprovada.');
      used.add(a.decision.stepKey);
    }
  }
  if(used.size!==stepKeys.size)throw Error('Etapa sem ação vinculada.');
  if(result.proofs!==undefined){
    if(!Array.isArray(result.proofs))throw Error('Contrato de regressão Goldfish inválido.');
    const fixed=result.actions.filter(a=>a.decision.category==='PROPOSE FIX');
    const proved=new Set<string>();
    for(const p of result.proofs){
      if(!obj(p)||typeof p.actionId!=='string'||proved.has(p.actionId)||typeof p.criterionKey!=='string'||typeof p.scenario!=='string'||!p.scenario.trim()||typeof p.command!=='string'||!meaningful(p.command))throw Error('Prova Goldfish inválida.');
      const a=fixed.find(a=>a.id===p.actionId);
      if(!a||a.decision.criterionKey!==p.criterionKey||a.decision.scenario!==p.scenario)throw Error('Prova não corresponde à decisão aprovada.');
      proved.add(p.actionId);
    }
    if(proved.size!==fixed.length)throw Error('Há correção sem contrato de regressão.');
  }
  return result;
}

export function checkApprovedGoldfishStep(binding:ApprovedGoldfishResolution,step:StepSpec):void{
  const expected=binding.steps.find(s=>s.key===step.key);
  if(!expected||fingerprint(step)!==expected.fingerprint)throw Error('Etapa '+step.key+' diverge do contrato aprovado Goldfish.');
}

type ExecutionStep={id:string;key:string;status:string;verifyCommand:string|null;instructions:string;provider?:string|null;attemptCount:number};
type AttemptEvidence={id:string;stepId:string;number:number;status:string;exitCode:number|null;treeAfter:string|null};
type CheckpointEvidence={id:string;stepId:string|null;gitCommit:string|null;state:unknown;seq:number};
export function summarizeGoldfishExecution(binding:ApprovedGoldfishResolution,steps:readonly ExecutionStep[],attempts:readonly AttemptEvidence[],checkpoints:readonly CheckpointEvidence[],mergedCommit:string|null,jobStatus:string):string[]{
  const rows=binding.actions.map(a=>{
    const d=a.decision;
    if(d.category!=='PROPOSE FIX')return '- '+a.id+' ['+a.severity+'] '+d.category+' — decisão aprovada, não correção comprovada. '+a.findingIds.join(', ');
    const step=steps.find(s=>s.key===d.stepKey);
    if(!step)return '- '+a.id+' — etapa não localizada; pendente.';
    try{checkApprovedGoldfishStep(binding,step);}catch{return '- '+a.id+' — contrato de etapa divergente; pendente.';}
    const attempt=attempts.find(x=>x.stepId===step.id&&x.number===step.attemptCount);
    const cp=checkpoints.filter(c=>c.stepId===step.id&&c.gitCommit&&obj(c.state)&&c.state.tentativa===attempt?.number&&obj(c.state.etapas)&&c.state.etapas[step.key]==='CONCLUIDO').sort((a,b)=>b.seq-a.seq)[0];
    if(step.status!=='CONCLUIDO'||attempt?.status!=='SUCESSO'||attempt.exitCode!==0||!attempt.treeAfter||!cp)return '- '+a.id+' — correção sem recibo técnico completo; etapa '+step.status+'.';
    return '- '+a.id+' — etapa e checkpoint confirmados; verificação '+step.verifyCommand+'; tentativa '+attempt.id+'; checkpoint '+cp.id+'; commit '+cp.gitCommit+'. Correção semântica individual ainda não comprovada por esta associação.';
  });
  return ['## Rastreabilidade de execução Goldfish','Revisão original '+binding.reviewMessageId+' / '+binding.revision,'Estado do job: '+jobStatus+'; commit integrado: '+(mergedCommit??'não integrado'),...rows,'Não declare todos os defeitos resolvidos com base somente em etapas concluídas. Contestação e evidência semântica por achado requerem avaliação específica.'];
}
