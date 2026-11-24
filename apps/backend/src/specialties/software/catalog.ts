import type { Skill } from '../skills';
import { BACKEND_SKILL,backendIntent } from './backend';
import { FRONTEND_SKILL,frontendIntent } from './frontend';
import { DATA_SKILL,dataIntent } from './data';
import { INTEGRATION_SKILL,integrationIntent } from './integration';
import { SECURITY_SKILL,securityIntent } from './security';
import { QUALITY_SKILL,qualityIntent } from './quality';
import { MAINTENANCE_SKILL,maintenanceIntent } from './maintenance';

const upstream='https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/';

/** Initial specialist contracts. Later engineering fronts deepen these rules
 * without changing their stable IDs or creating independent agents. */
export const SOFTWARE_SKILLS = [
  {id:'software-arquitetura',domain:'software',description:'Arquitetura e compreensão de dependências',source:upstream+'fastgen-develop',
    action:'Localize o componente responsável, leia sua implementação, contratos e consumidores antes de modificar a estrutura.',
    body:'Trabalhe sobre a revisão real do workspace. Consulte contexto/acervo/arquitetura-indice.md quando disponibilizado; ele é um índice, não prova de leitura ou de completude. Identifique pontos de entrada, componente dono, interfaces, consumidores e persistência/efeitos quando pertinentes. Leia manifestos, configurações de aliases e implementações completas relevantes antes de editar. Trace uma operação desde a entrada até o resultado, incluindo caminhos de erro. Confirme os consumidores de contratos alterados, inclusive referências dinâmicas não visíveis no mapa. Preserve o comportamento não solicitado e altere conjuntamente os contratos afetados. Não invente arquitetura nem crie um serviço paralelo para contornar uma falha. Faça a análise durante a mesma sessão produtiva, sem relatório obrigatório ou nova revisão.'},
  BACKEND_SKILL,
  FRONTEND_SKILL,
  DATA_SKILL,
  INTEGRATION_SKILL,
  SECURITY_SKILL,
  QUALITY_SKILL,
  MAINTENANCE_SKILL,
] as const satisfies readonly Skill[];

const routes:ReadonlyArray<readonly [string,RegExp]> = [
  ['software-arquitetura',/\b(arquitetur\w*|blueprint|dependencias?|modulariz\w*|estrutura do (?:codigo|projeto|sistema)|refator\w*)\b/],
];

/** Input is the normalized current task, never historical conversation or
 * a provider-supplied instruction. Domain authorization belongs to caller. */
export function selectSoftwareSkillIds(text:string):string[]{
  const ids=routes.filter(([,pattern])=>pattern.test(text)).map(([id])=>id);
  if(backendIntent(text))ids.push('software-backend');
  if(frontendIntent(text))ids.push('software-frontend');
  if(dataIntent(text))ids.push('software-dados');
  if(integrationIntent(text))ids.push('software-integracoes');
  if(securityIntent(text))ids.push('software-seguranca');
  if(qualityIntent(text))ids.push('software-qualidade');
  if(maintenanceIntent(text))ids.push('software-manutencao');
  return ids;
}
