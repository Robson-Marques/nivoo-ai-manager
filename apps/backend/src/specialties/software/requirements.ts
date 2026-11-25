import type { Skill } from '../skills';

export const REQUIREMENTS_SKILL:Skill={
  id:'software-requisitos',domain:'software',description:'Engenharia de requisitos e descoberta de produto',
  source:'https://github.com/google/elephant-goldfish-model/blob/63e239d8d4c3ddc6774faf533b4997405f78c549/skills/egm-brainstorm/SKILL.md',
  sourceAttribution:'Elephant-Goldfish Model (Apache-2.0)',
  action:'Identifique o problema, usuários, escopo e critérios observáveis; resolva dúvidas técnicas no contexto e pergunte apenas decisões bloqueantes.',
  body:[
    "Parta da necessidade e do resultado pretendido, não da tecnologia sugerida. Leia a solicitação atual, as decisões aprovadas, o perfil, os requisitos e as fontes reais disponíveis. Identifique o problema, como é resolvido hoje, quem usa ou recebe o resultado e o impacto pretendido. Não invente fatos sobre o negócio ou o sistema.",
    "Delimite objetivos e não objetivos, papéis, operações, regras de negócio, restrições obrigatórias, preferências e decisões técnicas delegadas. Para sistemas existentes, preserve comportamentos, dados e contratos não abrangidos pelo pedido. Para um pedido de produto novo, descubra a menor entrega completa que satisfaça o objetivo, sem adicionar módulos não solicitados.",
    "Converta necessidades em cenários e critérios observáveis: situação inicial, ação, resultado esperado, falhas e limites pertinentes. Não invente metas numéricas, prazos, SLAs, autorizações ou capacidades externas. Reutilize os critérios, objetivos e verificações reais do Nivoo; não crie um formato paralelo ou documento obrigatório.",
    "Considere alternativas reais, inclusive reaproveitamento e não implementação quando apropriado. Avalie complexidade, custo, consumo de recursos, usabilidade, compatibilidade, segurança e manutenção de forma proporcional ao risco. Explique os trade-offs materiais sem elogiar ou confirmar hipóteses sem evidência.",
    "Separe requisitos confirmados, inferências, hipóteses reversíveis e decisões que exigem o usuário. Resolva dúvidas técnicas nas fontes autorizadas; assuma padrões reversíveis quando seguros e indique a escolha. Só pergunte quando faltar decisão realmente bloqueante, com o mecanismo de perguntas existente. Não imponha entrevistas, formulários, múltiplos turnos ou gate de prontidão.",
    "Durante o planejamento, utilize o contrato existente de proposta, aprovação, objetivo, etapas e critérios. Durante a execução, preserve o resultado aprovado, trate ambiguidades locais sem ampliar o escopo e encaminhe bloqueios reais pelo fluxo existente. Não replaneje todo o trabalho por uma dúvida local. Somente registre decisões confirmadas na memória conforme as regras do projeto.",
    "Esta é uma adaptação da descoberta de requisitos do Elephant-Goldfish e dos critérios Heilmeier. Não é uma revisão Goldfish independente: não inicia subagentes, revisão automática, nova sessão, CI, ferramenta, API ou relatório compulsório. Não muda a política de aprovação, os limites ou as permissões do Nivoo.",
  ].join('\n'),
};

type Focus="problema"|"usuarios"|"escopo"|"aceitacao"|"riscos"|"decisoes";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"problema",match:/\b(?:problemas?|necessidades?|objetivos?|proposito|dor|gargalos?|motivac\w*|problem|goals?)\b/,rule:"Problema: identifique o resultado esperado, o cenário atual e a diferença que a mudança deve produzir; não confunda solução sugerida com necessidade comprovada."},
  {id:"usuarios",match:/\b(?:usuarios?|clientes?|atores?|perfis?|personas?|consumidores?|stakeholders?|operadores?|users?|roles?)\b/,rule:"Usuários: identifique quem inicia, utiliza ou recebe o resultado, suas permissões e o cenário de uso. Não invente papéis ou regras de negócio."},
  {id:"escopo",match:/\b(?:escopo|scope|requisitos?|requirements?|funcionalidades?|features?|restric\w*|constraints?|limites?|nao objetivos?|non goals?)\b/,rule:"Escopo: separe resultado obrigatório, preferências, restrições, exclusões e escolhas técnicas delegadas. Preserve requisitos aprovados; não acrescente módulos ou funcionalidades só por conveniência."},
  {id:"aceitacao",match:/\b(?:aceitac\w*|criterios?|success criteria|metricas?|metrics|validac\w*|testes?|resultado|sucesso|sla|slo|invariantes?)\b/,rule:"Aceitação: traduza resultados em comportamento observável, entradas, saídas, estados e limites pertinentes. Use critérios existentes; não invente SLA, números ou testes já executados."},
  {id:"riscos",match:/\b(?:riscos?|risks?|alternativas?|trade offs?|tradeoffs?|custo|custos|costs?|migrac\w*|legado|compatibil\w*|seguranca|escalabilidade|manutencao|edge cases?|casos limites?)\b/,rule:"Riscos: avalie alternativas, reaproveitamento, impacto em dados e consumidores, custo e complexidade quando relevantes. Declare incertezas e escolhas; não transforme cada risco em nova etapa ou infraestrutura."},
  {id:"decisoes",match:/\b(?:ambigu\w*|duvidas?|pendencias?|decis(?:ao|oes)|decisions?|hipoteses?|assumptions?|premissas?|briefing|brainstorm\w*|levantamento|elicitation)\b/,rule:"Decisões: consulte conversa, regras, memória e fontes reais. Separe fato confirmado, hipótese reversível e decisão bloqueante. Pergunte apenas o indispensável ao usuário; não registre hipóteses como fatos aprovados."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:requisitos?|requirements?|levantamento de necessidades|levantamento funcional|historia de usuario|historias de usuarios|user stories|user story|criterios? de aceitacao|acceptance criteria|escopo funcional|escopo do (?:projeto|sistema|produto)|engenharia de produto|product discovery|elicitation|briefing funcional|definir funcionalidades|brainstorm(?:ing)? (?:de|do|da|para) (?:software|sistema|produto|funcionalidade))\b/,
  /\b(?:criar|crie|desenvolver|desenvolva|construir|construa|projetar|projet[e]|planejar|planeje|montar|monte|idealizar)\b.{0,65}\b(?:sistema|software|erp|crm|plataforma|aplicativo|aplicacao|portal|saas)\b/,
  /\b(?:sistema|software|erp|crm|plataforma|aplicativo|aplicacao|portal)\b.{0,55}\b(?:do zero|completo|novo projeto|nova versao)\b/,
];

export function requirementsIntent(text:string):boolean{
  const t=normalize(text);
  return INTENT.some(r=>r.test(t));
}
export function requirementsFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function requirementsEngineeringContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(requirementsFocus(text));
  return [
    '## Engenharia de requisitos — necessidade, escopo e aceitação',
    phase==='planner'
      ? "No plano, extraia problema, público, objetivo observável, escopo e restrições do pedido e do contexto autorizado. Separe fatos, hipóteses e decisões bloqueantes; considere reaproveitamento e riscos pertinentes. Use objetivos, etapas e critérios do contrato existente, perguntando somente o que impede uma decisão segura."
      : "Na etapa atual, preserve o objetivo e os requisitos aprovados. Leia regras e consumidores reais, resolva ambiguidades técnicas locais e mantenha os critérios de aceitação. Não amplie o escopo nem converta uma hipótese em requisito aprovado.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "A orientação não abre entrevistas, revisões ou sessões extras. Não declare revisão Goldfish independente, nem invente critérios, decisões ou validações.",
  ];
}
