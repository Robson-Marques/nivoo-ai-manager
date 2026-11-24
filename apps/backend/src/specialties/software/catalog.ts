import type { Skill } from '../skills';
import { BACKEND_SKILL,backendIntent } from './backend';
import { FRONTEND_SKILL,frontendIntent } from './frontend';
import { DATA_SKILL,dataIntent } from './data';

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
  {id:'software-integracoes',domain:'software',description:'Contratos de integração, APIs e eventos',source:upstream+'nemo-relay-instrument-typed-wrappers',
    action:'Confirme o contrato real de cada integração; valide entradas, respostas, erros e efeitos de repetição.',
    body:'Leia a documentação da versão efetivamente usada e os adaptadores existentes. Mantenha conversões de tipos nas fronteiras, preserve campos necessários e trate falhas explicitamente. Considere autenticação, idempotência, paginação e reentrega conforme o protocolo. Não invente endpoints, parâmetros ou credenciais.'},
  {id:'software-seguranca',domain:'software',description:'Segurança, autorização e isolamento',
    action:'Preserve os limites de acesso, valide entradas e verifique autorização no componente que executa a operação.',
    body:'Não confunda autenticação com autorização. Respeite a política existente, escopo de dados e isolamento. Evite segredos em logs, código e contexto. Use APIs parametrizadas e validação adequada ao projeto. Não desative controles de segurança para contornar uma falha.'},
  {id:'software-qualidade',domain:'software',description:'Sintaxe, tipagem, compilação e testes',source:upstream+'mcore-testing',
    action:'Use os testes e comandos de validação existentes, proporcionais à mudança; diferencie inspeção, compilação e execução.',
    body:'Leia os testes e comandos reais do projeto, incluindo configurações do compilador. Corrija a causa de falhas sem remover critérios. Inclua regressão quando o comportamento mudar; aproveite a conferência técnica do executor, sem criar CI ou revisão de IA. Declare somente validações realmente executadas.'},
  {id:'software-manutencao',domain:'software',description:'Manutenção, desempenho e observabilidade',source:upstream+'nemo-relay-plugin-observability',
    action:'Rastreie o fluxo que falhou e meça o custo relevante antes de refatorar ou otimizar.',
    body:'Preserve interfaces e resultados; identifique a origem do custo ou erro com evidência. Use logs estruturados e identificadores já existentes, sem duplicar instrumentação. Não adicione cache, tentativas ou verificações para mascarar defeitos. Diferencie hipótese de medição.'},
] as const satisfies readonly Skill[];

const routes:ReadonlyArray<readonly [string,RegExp]> = [
  ['software-arquitetura',/\b(arquitetur\w*|blueprint|dependencias?|modulariz\w*|estrutura do (?:codigo|projeto|sistema)|refator\w*)\b/],
  ['software-integracoes',/\b(integrac\w*|webhooks?|oauth\w*|api externa|apis externas|api rest|graphql|grpc|idempotenc\w*|contratos? de api|sdk)\b/],
  ['software-seguranca',/\b(seguranca|autenticac\w*|autorizac\w*|permissoes|permissao|credenciais?|vulnerabil\w*|csrf|xss|sql injection|controle de acesso)\b/],
  ['software-qualidade',/\b(testes?|testar|testing|jest|pytest|vitest|lint\w*|typecheck|tipagem|compil\w*|build|regressao|ts\d{4})\b/],
  ['software-manutencao',/\b(refator\w*|manutencao|desempenho|performance|observabilidade|telemetria|profil\w*|logs?|latencia|gargalos?|otimiz\w*)\b/],
];

/** Input is the normalized current task, never historical conversation or
 * a provider-supplied instruction. Domain authorization belongs to caller. */
export function selectSoftwareSkillIds(text:string):string[]{
  const ids=routes.filter(([,pattern])=>pattern.test(text)).map(([id])=>id);
  if(backendIntent(text))ids.push('software-backend');
  if(frontendIntent(text))ids.push('software-frontend');
  if(dataIntent(text))ids.push('software-dados');
  return ids;
}
