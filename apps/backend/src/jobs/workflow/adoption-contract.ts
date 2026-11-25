import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../../common/path-guard';
import { LIQUI_UPSTREAM_COMMIT } from '../../projects/liquid-glass-template';
import { selectedVisualStyleId } from '../../projects/visual-profile';
import { softwareInterfaceEnabled } from '../../specialties/scope';
import type { AreaScope } from '../../specialties/media/scope';

type Criterion={key:string;kind:string;config:unknown};
type Dict=Record<string,unknown>;
const record=(v:unknown):Dict|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Dict:null;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=500;
const rel=(v:unknown):v is string=>typeof v==='string'&&caminhoDoProjeto(v)===v&&!/^(?:out|midia|node_modules)(?:\/|$)/.test(v);
const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=100&&v.every(id)&&new Set(v).size===v.length;
export interface Adoption {
  artifact:string;source:string;revision:string;mode:'pilot'|'rollout'|'complete';
  manifest:string;families:string[];pending:string[];
  packagePath?:string;
}
export const LIQUI_FAMILIES=['shell','navigation','controls','forms','data','feedback'] as const;
export function adoptionOf(config:unknown):Adoption|null{
  const a=record(record(config)?.adoption);
  if(!a||!id(a.artifact)||!text(a.source)||!text(a.revision)||!['pilot','rollout','complete'].includes(String(a.mode))||!rel(a.manifest)||!ids(a.families)||!a.families.length||!ids(a.pending)||a.families.some(f=>(a.pending as string[]).includes(f)))return null;
  if(a.mode==='complete'?a.pending.length!==0:a.pending.length===0)return null;
  if(a.artifact==='liquid-glass'&&(!rel(a.packagePath)||a.source!=='https://github.com/leefanv/liqui-design'||a.revision!==LIQUI_UPSTREAM_COMMIT))return null;
  return a as unknown as Adoption;
}
function cap(c:Criterion){return record(record(c.config)?.capability);}
function error(message:string):never{throw new BadRequestException(message);}
export function validateAdoptionCriteria(criteria:readonly Criterion[]):void{
  const groups=new Map<string,Adoption>();
  for(const c of criteria){
    const cfg=record(c.config);
    if(cfg?.adoption===undefined)continue;
    const a=adoptionOf(cfg),ref=cap(c);
    if(!a||!ref||typeof ref.id!=='string'||!ref.id||ref.phase!=='structural'||c.kind!=='COMMAND')error('Critério '+c.key+': adoção exige contrato válido no critério estrutural da Capability.');
    if(groups.has(ref.id))error('Use um contrato de adoção por Capability.');
    groups.set(ref.id,a);
  }
  for(const c of criteria){
    const cfg=record(c.config);
    if(cfg?.adoptionFamilies===undefined)continue;
    const ref=cap(c),a=typeof ref?.id==='string'?groups.get(ref.id):undefined;
    if(!a||ref?.phase!=='acceptance'||c.kind!=='COMMAND'||!ids(cfg.adoptionFamilies)||!cfg.adoptionFamilies.length||cfg.adoptionFamilies.some(f=>!a.families.includes(f)))error('Critério '+c.key+': adoptionFamilies deve apontar famílias do contrato estrutural na mesma Capability.');
  }
  for(const [key,a] of groups){
    const group=criteria.filter(c=>cap(c)?.id===key);
    const covered=new Set(group.flatMap(c=>{const v=record(c.config)?.adoptionFamilies;return ids(v)?v:[];}));
    const missing=a.families.filter(f=>!covered.has(f));
    if(missing.length)error('Adoção '+a.artifact+': faltam verificações integradas para '+missing.join(', ')+'.');
    if(!group.some(c=>cap(c)?.phase==='decision'&&c.kind==='MANUAL_APPROVAL'))error('Adoção '+a.artifact+': falta decisão explícita da etapa de adoção.');
  }
}

/** Require a structured contract for explicit adoption and full UI deliveries
 * with a persisted Liquid Glass selection. Do not force migration on local
 * backend maintenance or the prerequisite specialty registration. */
export function requireAdoptionContract(plan:{title:string;objective:string;steps:unknown;criteria:readonly Criterion[]},area?:AreaScope,profile?:unknown,request=''):void{
  if(!softwareInterfaceEnabled(area))return;
  const title=plan.title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const objective=plan.objective.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(?:catalogar|criar|registrar)\b.{0,60}\bespecialidade\b/.test(title)&&!plan.criteria.some(c=>cap(c)?.phase==='acceptance'))return;
  const intent=(title+' '+objective+' '+request).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const explicit=/\b(?:adot\w*|migrar|migracao|incorporar|integrar)\b.{0,100}\b(?:design system|liquid glass|elephant.goldfish|studio workflow|framework|biblioteca|metodologia)\b/.test(intent);
  const ui=/\b(?:interface|frontend|dashboard|formularios?|telas?|painel|navegacao|responsiv\w*)\b/.test(objective+' '+JSON.stringify(plan.steps).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
  const newProduct=/\b(?:criar|crie|implementar|desenvolver|desenvolva|construir|entregar)\b.{0,70}\b(?:sistema|software|aplicativo|aplicacao|erp|crm|plataforma|portal)\b/.test(title+' '+objective);
  const fullUi=ui&&(newProduct||plan.criteria.some(c=>cap(c)?.phase==='acceptance'))&&selectedVisualStyleId(profile)==='liquid-glass';
  if(!explicit&&!fullUi)return;
  const adoptions=plan.criteria.map(c=>adoptionOf(c.config)).filter((a):a is Adoption=>!!a);
  if(!adoptions.length)error('A adoção precisa de config.adoption no critério estrutural e adoptionFamilies nas verificações integradas; declare origem, revisão, inventário, famílias e pendências.');
  if(fullUi||explicit&&/\bliquid glass\b/.test(intent)){
    const a=adoptions.find(x=>x.artifact==='liquid-glass');
    if(!a)error('O perfil Liquid Glass aprovado exige o contrato do registry original, não somente cards.');
    const all=new Set([...a.families,...a.pending]);
    const missing=LIQUI_FAMILIES.filter(f=>!all.has(f));
    if(missing.length)error('Adoção Liquid Glass: mapear também '+missing.join(', ')+'. Não crie funcionalidade fora do escopo: o inventário explica famílias sem callsites pertinentes.');
  }
}
export function adoptionSummaries(criteria:readonly Criterion[]):string[]{
  return criteria.flatMap(c=>{
    const a=adoptionOf(c.config);if(!a)return [];
    return ['Adoção '+a.artifact+' — '+(a.mode==='complete'?'integral no escopo declarado':'etapa '+a.mode+'; adoção ainda INCOMPLETA')+'; origem '+a.source+' @ '+a.revision+'; famílias: '+a.families.join(', ')+(a.pending.length?'; pendentes: '+a.pending.join(', '):'')+'.'];
  });
}
