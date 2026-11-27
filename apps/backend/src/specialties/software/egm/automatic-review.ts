import { capabilityReference } from '../../../jobs/workflow/capability-criteria';
import { readApprovedScope } from '../../../jobs/approved-scope';
import { softwareInterfaceEnabled } from '../../scope';
import { goldfishTransportSupported,validRelative } from './review-http';
import type { AreaScope } from '../../media/scope';

export const AUTOMATIC_GOLDFISH_KIND='goldfish-automatic';
export type AutoReviewRequest={version:1;jobId:string;projectId:string;conversationId:string;revision:string;targetPath:string;providerId:string;model:string|null;preset:7};
type Criterion={key:string;kind:string;config:unknown};
type Change={status:string;path:string;de?:string};
type Decision={kind:'skip';reason:string}|{kind:'review';targetPath:string;preset:7};
type Input={projectId:string;area:AreaScope;approvedScope:unknown;criteria:readonly Criterion[];passedKeys:ReadonlySet<string>;files:readonly Change[];revision:string|null;providerType:string|null;budgetConfigured:boolean;specialtyHandoff:boolean};
const codePath=/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|sql|prisma|proto|vue|svelte|swift|cpp|h|c)$/i;
const commit=(v:unknown):v is string=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=256;
const skip=(reason:string):Decision=>({kind:'skip',reason});

/** Deterministic, proportionate selection for the first automatic post-delivery
 * audit. No inference from the model's claim of risk, title or number of steps.
 * Only a changed versioned capability contract plus changed project code and
 * passed structural/acceptance criteria qualifies. One target, one phase.
 * Never audit a remediation again automatically or delay an ordinary job. */
export function automaticGoldfishDecision(input:Input):Decision{
  if(!softwareInterfaceEnabled(input.area))return skip('fora do domínio de software');
  const scope=readApprovedScope(input.approvedScope,input.projectId);
  if(!scope)return skip('sem escopo aprovado vinculado');
  if(scope.egmResolution)return skip('correção Goldfish: nova rodada requer decisão explícita');
  if(input.specialtyHandoff)return skip('criação de especialidade, pedido original ainda pendente');
  if(!commit(input.revision))return skip('sem revisão Git incorporada verificável');
  if(input.budgetConfigured)return skip('limite financeiro configurado; custo máximo da revisão não assegurado');
  if(!goldfishTransportSupported(input.providerType))return skip('transporte independente indisponível');
  if(!input.files.some(f=>validRelative(f.path)&&codePath.test(f.path)&&['A','M','R','D'].includes(f.status)))return skip('sem mudança de código versionado');
  const groups=new Map<string,{structural:boolean;acceptance:boolean}>();
  for(const c of input.criteria){
    const ref=capabilityReference(c.config);
    if(!ref||!validRelative(ref.contract)||!/\.md$/i.test(ref.contract)||!input.passedKeys.has(c.key))continue;
    const key=ref.id+'\0'+ref.contract;
    const phases=groups.get(key)??{structural:false,acceptance:false};
    if(ref.phase==='structural')phases.structural=true;
    if(ref.phase==='acceptance'&&c.kind==='COMMAND')phases.acceptance=true;
    groups.set(key,phases);
  }
  const paths=[...new Set([...groups.entries()].filter(([,p])=>p.structural&&p.acceptance).map(([k])=>k.split('\0')[1]).filter(p=>input.files.some(f=>f.path===p&&['A','M','R'].includes(f.status))))];
  if(!paths.length)return skip('nenhum contrato estrutural Markdown alterado com aceitação comprovada; execução técnica existente é suficiente para este gatilho');
  if(paths.length!==1)return skip('mais de um contrato elegível; não selecionar arbitrariamente nem multiplicar sessões');
  return {kind:'review',targetPath:paths[0],preset:7};
}

export function readAutoReview(value:unknown):AutoReviewRequest{
  const v=record(value)?value.automaticRequest:undefined;
  if(!record(v)||v.version!==1||!text(v.jobId)||!text(v.projectId)||!text(v.conversationId)||!commit(v.revision)||!text(v.targetPath)||!validRelative(v.targetPath)||!/\.md$/i.test(v.targetPath)||!text(v.providerId)||!(v.model===null||text(v.model))||v.preset!==7)throw Error('Solicitação automática Goldfish inválida.');
  return v as unknown as AutoReviewRequest;
}

export function automaticReviewMatches(req:AutoReviewRequest,actual:{jobId:string;projectId:string;conversationId:string;revision:string|null;providerId:string;model:string|null;budgetConfigured:boolean}):boolean{
  return !actual.budgetConfigured&&req.jobId===actual.jobId&&req.projectId===actual.projectId&&req.conversationId===actual.conversationId&&req.revision===actual.revision&&req.providerId===actual.providerId&&req.model===actual.model;
}
