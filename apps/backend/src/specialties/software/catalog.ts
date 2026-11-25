import type { Skill } from '../skills';
import { architectureContext } from './architecture-context';
import { BACKEND_SKILL,backendIntent,backendEngineeringContext } from './backend';
import { FRONTEND_SKILL,frontendIntent,frontendEngineeringContext } from './frontend';
import { DATA_SKILL,dataIntent,dataEngineeringContext } from './data';
import { INTEGRATION_SKILL,integrationIntent,integrationEngineeringContext } from './integration';
import { SECURITY_SKILL,securityIntent,securityEngineeringContext } from './security';
import { QUALITY_SKILL,qualityIntent,qualityEngineeringContext } from './quality';
import { MAINTENANCE_SKILL,maintenanceIntent,maintenanceEngineeringContext } from './maintenance';
import { REQUIREMENTS_SKILL,requirementsIntent,requirementsEngineeringContext } from './requirements';
import { SPECIFICATION_SKILL,specificationIntent,specificationEngineeringContext } from './specification';

const upstream='https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/';

type EngineeringInput={
  phase:'planner'|'execution';
  text:string;
  worktree?:string;
  testDbConfigured:()=>boolean;
  previousError?:boolean;
};
type EngineeringSection={key:string;lines:string[]};
type Specialist={
  skill:Skill;
  matches:(text:string)=>boolean;
  guidance?:(input:EngineeringInput)=>string[];
  section?:string;
};

/** Single ordered registry: stable skill ID, selection and phase-specific
 * guidance. Architecture navigation also serves the general codigo skill. */
const specialists:readonly Specialist[]=[
  {skill:
    {id:'software-arquitetura',domain:'software',description:'Arquitetura e compreensão de dependências',source:upstream+'fastgen-develop',
    action:'Localize o componente responsável, leia sua implementação, contratos e consumidores antes de modificar a estrutura.',
    body:'Trabalhe sobre a revisão real do workspace. Consulte contexto/acervo/arquitetura-indice.md quando disponibilizado; ele é um índice, não prova de leitura ou de completude. Identifique pontos de entrada, componente dono, interfaces, consumidores e persistência/efeitos quando pertinentes. Leia manifestos, configurações de aliases e implementações completas relevantes antes de editar. Trace uma operação desde a entrada até o resultado, incluindo caminhos de erro. Confirme os consumidores de contratos alterados, inclusive referências dinâmicas não visíveis no mapa. Preserve o comportamento não solicitado e altere conjuntamente os contratos afetados. Não invente arquitetura nem crie um serviço paralelo para contornar uma falha. Faça a análise durante a mesma sessão produtiva, sem relatório obrigatório ou nova revisão.'},
    matches:text=>/\b(arquitetur\w*|blueprint|dependencias?|modulariz\w*|estrutura do (?:codigo|projeto|sistema)|refator\w*)\b/.test(text)},
  {skill:BACKEND_SKILL,matches:backendIntent,section:'engenharia-backend',guidance:input=>backendEngineeringContext(input.phase,input.text)},
  {skill:FRONTEND_SKILL,matches:frontendIntent,section:'engenharia-frontend',guidance:input=>frontendEngineeringContext(input.phase,input.text)},
  {skill:DATA_SKILL,matches:dataIntent,section:'engenharia-dados',guidance:input=>dataEngineeringContext(input.phase,input.text,input.testDbConfigured())},
  {skill:INTEGRATION_SKILL,matches:integrationIntent,section:'engenharia-integracoes',guidance:input=>integrationEngineeringContext(input.phase,input.text)},
  {skill:SECURITY_SKILL,matches:securityIntent,section:'engenharia-seguranca',guidance:input=>securityEngineeringContext(input.phase,input.text)},
  {skill:QUALITY_SKILL,matches:qualityIntent,section:'engenharia-qualidade',guidance:input=>qualityEngineeringContext(input.phase,input.text)},
  {skill:MAINTENANCE_SKILL,matches:maintenanceIntent,section:'engenharia-manutencao',guidance:input=>maintenanceEngineeringContext(input.phase,input.text,input.previousError)},
  {skill:REQUIREMENTS_SKILL,matches:requirementsIntent,section:'engenharia-requisitos',guidance:input=>requirementsEngineeringContext(input.phase,input.text)},
  {skill:SPECIFICATION_SKILL,matches:specificationIntent,section:'engenharia-especificacao',guidance:input=>specificationEngineeringContext(input.phase,input.text)},
];

export const SOFTWARE_SKILLS:readonly Skill[]=specialists.map(s=>s.skill);

/** Input is the normalized current task, never historical conversation or
 * a provider-supplied instruction. Domain authorization belongs to caller. */
export function selectSoftwareSkillIds(text:string):string[]{
  return specialists.filter(s=>s.matches(text)).map(s=>s.skill.id);
}

/** Both composition roots consume these same sections in the same order.
 * No new session or validation; only guidance for already selected skills. */
export function softwareEngineeringSections(skills:readonly Pick<Skill,'id'>[],input:EngineeringInput):EngineeringSection[]{
  const ids=new Set(skills.map(s=>s.id));
  const result:EngineeringSection[]=[];
  if(ids.has('codigo')){
    const lines=architectureContext(input.worktree,input.text);
    if(lines.length)result.push({key:'arquitetura-workspace',lines});
  }
  for(const specialist of specialists){
    if(!ids.has(specialist.skill.id)||!specialist.guidance||!specialist.section)continue;
    const lines=specialist.guidance(input);
    if(lines.length)result.push({key:specialist.section,lines});
  }
  return result;
}
