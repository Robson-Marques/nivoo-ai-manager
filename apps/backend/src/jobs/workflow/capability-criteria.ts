import { validateAdoptionCriteria } from './adoption-contract';
import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../../common/path-guard';

type Phase='construction'|'structural'|'acceptance'|'decision';
export interface CapabilityReference {id:string;contract:string;phase:Phase}
type Criterion={key:string;kind:string;config:unknown};
const phases:Phase[]=['construction','structural','acceptance','decision'];
function record(v:unknown):Record<string,unknown>|null{return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}
export function capabilityReference(config:unknown):CapabilityReference|null{
  const raw=record(record(config)?.capability);
  if(!raw||typeof raw.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(raw.id)||typeof raw.contract!=='string'||caminhoDoProjeto(raw.contract)!==raw.contract||/^(?:out|midia)(?:\/|$)/.test(raw.contract)||!phases.includes(raw.phase as Phase))return null;
  return {id:raw.id,contract:raw.contract,phase:raw.phase as Phase};
}
export function validateCapabilityCriteria(criteria:Criterion[],steps:ReadonlyArray<{verifyCommand?:string|null}>=[]):void{
  validateAdoptionCriteria(criteria);
  const groups=new Map<string,Array<{c:Criterion;ref:CapabilityReference}>>();
  for(const c of criteria){
    const cfg=record(c.config);
    if(cfg?.capability===undefined)continue;
    const ref=capabilityReference(cfg);
    if(!ref)throw new BadRequestException('Critério '+c.key+': referência de Capability inválida (id, contract e phase).');
    if((ref.phase==='structural'||ref.phase==='acceptance')&&c.kind!=='COMMAND')throw new BadRequestException('Critério '+c.key+': '+ref.phase+' exige COMMAND com evidência real, não existência de arquivo.');
    if(ref.phase==='decision'&&c.kind!=='MANUAL_APPROVAL')throw new BadRequestException('Critério '+c.key+': decision exige MANUAL_APPROVAL.');
    if(ref.phase==='construction'&&c.kind==='MANUAL_APPROVAL')throw new BadRequestException('Critério '+c.key+': construção não equivale a aceite da Capability.');
    if(ref.phase==='structural'||ref.phase==='acceptance'){
      if(cfg?.expectExitCode!==undefined&&cfg.expectExitCode!==0)throw new BadRequestException('Critério '+c.key+': a verificação de Capability deve retornar 0 em caso de sucesso.');
      const cmd=String(cfg?.command??'').trim();
      if(!cmd||/^(?:true|:|exit\s+0|echo\b[^\n;&|]*|test\s+-(?:e|f|s|d)\s+[^;&|\n]+)$/.test(cmd))throw new BadRequestException('Critério '+c.key+': use verificação semântica do contrato ou fluxo integrado, não um comando de presença/sucesso incondicional.');
      if(ref.phase==='acceptance'&&steps.some(s=>s.verifyCommand?.trim()===cmd))throw new BadRequestException('Critério '+c.key+': a aceitação integrada pertence à avaliação final, não repita o mesmo comando na conferência de slice.');
    }
    const group=groups.get(ref.id)??[];
    group.push({c,ref});groups.set(ref.id,group);
  }
  for(const [id,group] of groups){
    if(new Set(group.map(g=>g.ref.contract)).size!==1)throw new BadRequestException('Capability '+id+': preserve a referência ao mesmo contrato.');
    const stages=new Set(group.map(g=>g.ref.phase));
    if([...stages].some(p=>p!=='construction')&&(!stages.has('structural')||!stages.has('acceptance')||!stages.has('decision')))throw new BadRequestException('Capability '+id+': aceitação integrada requer critério estrutural, teste integrado e decisão explícita no mesmo plano. Se ainda em construção, use apenas construction.');
  }
}

/** The engine orders existing checks, not the development slices. A failed
 * structural check defers acceptance of that capability; a human decision is
 * requested only after all technical checks in the job passed. */
export function orderedCapabilityCriteria<T extends Criterion>(criteria:T[]):T[]{
  if(!criteria.some(c=>capabilityReference(c.config)))return criteria;
  const rank=(c:Criterion)=>{
    const phase=capabilityReference(c.config)?.phase;
    if(c.kind==='MANUAL_APPROVAL')return 3;
    return phase==='acceptance'?2:phase==='structural'?1:0;
  };
  return [...criteria].sort((a,b)=>rank(a)-rank(b));
}
export function deferredCapabilityCriterion(c:Criterion,results:ReadonlyMap<string,boolean>,criteria:Criterion[]):string|null{
  const ref=capabilityReference(c.config);
  if(c.kind==='MANUAL_APPROVAL'&&criteria.some(x=>capabilityReference(x.config))&&criteria.some(x=>x.kind!=='MANUAL_APPROVAL'&&results.get(x.key)!==true))return 'aguarda critérios técnicos do trabalho';
  if(ref?.phase==='acceptance'&&criteria.some(x=>{
    const other=capabilityReference(x.config);
    return !!other&&other.id===ref.id&&(other.phase==='structural'||other.phase==='construction')&&results.get(x.key)!==true;
  }))return 'aguarda completude estrutural e critérios de construção de '+ref.id;
  return null;
}
