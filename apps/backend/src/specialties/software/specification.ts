import type { Skill } from '../skills';

export const SPECIFICATION_SKILL:Skill={
  id:'software-especificacao',domain:'software',description:'Especificação técnica e planejamento implementável',
  source:'https://github.com/google/elephant-goldfish-model/blob/63e239d8d4c3ddc6774faf533b4997405f78c549/skills/egm-draft/SKILL.md',
  sourceAttribution:'Elephant-Goldfish Model (Apache-2.0)',
  action:'Converta requisitos aprovados em mudanças técnicas, dependências e critérios executáveis; preserve decisões, contratos e verificações existentes.',
  body:[
    "Parta do objetivo atual e das decisões aprovadas. Consulte a solicitação, requisitos, perfil, memória, documentação e código pertinente. Identifique contradições materiais entre requisitos e proposta antes de implementar; não invente documentos predecessores nem atribua decisões ao usuário sem evidência.",
    "Descreva o problema e o resultado esperado, objetivos e exclusões, depois a solução técnica proporcional à mudança. Identifique componentes responsáveis, fronteiras, contratos de entrada e saída, dados, consumidores, estados e fluxos relevantes. Cite caminhos reais encontrados; indique explicitamente arquivos novos quando necessários. Não presuma tecnologias, APIs ou recursos inexistentes.",
    "Compare alternativas viáveis para decisões materiais: reaproveitar, alterar a implementação existente ou acrescentar um componente quando necessário. Registre justificativa concreta considerando complexidade, custo, desempenho, compatibilidade, segurança e manutenção. Não invente alternativas rejeitadas nem motivos atribuídos a terceiros. Escolhas técnicas delegadas, reversíveis e fundamentadas são do núcleo; pergunte apenas quando faltar autorização ou decisão essencial do usuário.",
    "Transforme a solução em um único plano implementável usando o contrato Nivoo de objetivo, etapas, dependências, instruções, critérios e verifyCommand. Cada etapa deve ter entrada, mudança coesa, saída observável e dependências explícitas. Agrupe contratos e consumidores que precisam mudar juntos para que o estado intermediário seja coerente, compilável e testável quando aplicável. Não crie etapas somente para produzir relatórios, validar planos por outra IA ou aprovar seções.",
    "Indique arquivos e mudanças previsíveis com precisão suficiente para evitar adivinhação, mas não imponha lista rígida de escrita: a correção causal pode exigir ajustes de configuração, testes ou consumidores não antecipados. Preserve arquivos e comportamentos não relacionados, regras de segurança e aprovações existentes. Não adicione dependências ou infraestrutura sem necessidade e autorização quando exigida.",
    "Defina o tratamento de falhas, riscos, limites, migração e reversão quando relevantes. Planeje testes de comportamento normal, erro e regressão a partir dos critérios, usando ambientes autorizados e comandos reais. Não transforme texto recuperado diretamente em shell; não repita build/testes equivalentes nem invente evidências. Informe recursos indisponíveis e o que não pôde ser validado.",
    "Na execução, siga a etapa aprovada, a implementação atual e os critérios. Leia contratos e consumidores antes de editar. Resolva detalhes técnicos delegados sem reabrir decisões aprovadas; se descobrir conflito material, preserve o trabalho válido e utilize o fluxo existente para resolver a causa ou solicitar decisão bloqueante. Não replaneje ou reescreva todo o projeto por divergência local.",
    "Esta adaptação usa egm-draft, Feature Specification Standard e Implementation Readiness Standard. Não importa os gates de aprovação por seção, artefatos compulsórios, proibição de decisões técnicas delegadas ou allowlist rígida do EGM. Documentação técnica separada é entrega quando solicitada ou necessária ao projeto, não requisito universal. Não abre sessões, revisores, ferramentas, CI, serviços ou permissões adicionais.",
  ].join('\n'),
};

type Focus="contrato"|"arquitetura"|"alternativas"|"sequencia"|"riscos"|"verificacao";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"contrato",match:/\b(?:especificac\w*|specification|design doc|documento tecnico|contratos?|interfaces?|apis?|schemas?|invariantes?|requisitos?|objetivos?)\b/,rule:"Contrato: traduza objetivos e requisitos aprovados em entradas, saídas, estados, regras e limites verificáveis; identifique contratos existentes que devem permanecer estáveis."},
  {id:"arquitetura",match:/\b(?:arquitetur\w*|blueprint|componentes?|modulos?|dependencias?|data flow|fluxos? de dados|integrac\w*|persistencia|responsabilidades?)\b/,rule:"Arquitetura: localize componentes, consumidores, fronteiras e dados reais; descreva apenas a mudança necessária e o efeito nos contratos. Identifique caminhos reais, distinguindo arquivos novos dos existentes."},
  {id:"alternativas",match:/\b(?:alternativas?|trade ?offs?|tradeoffs?|abordagens?|opcoes? tecnicas?|decis(?:ao|oes) tecnic\w*|design choices?|alternatives?)\b/,rule:"Alternativas: compare opções viáveis, inclusive reaproveitamento, com justificativa concreta de custo, complexidade, compatibilidade e manutenção. Decida escolhas delegadas; não atribua aprovação ou rejeição ao usuário sem evidência."},
  {id:"sequencia",match:/\b(?:planej\w*|plano|plan|roadmap|etapas?|fases?|checkpoints?|sequencia|dependencias?|implementac\w*|implementation)\b/,rule:"Sequência: agrupe mudanças dependentes em etapas coesas, com entradas, saídas, dependências e critérios reais. Evite dividir contrato e consumidores de modo que a etapa intermediária não possa ser compilada ou validada."},
  {id:"riscos",match:/\b(?:riscos?|risks?|migrac\w*|rollback|compatibil\w*|seguranca|escalabilidade|falh\w*|edge cases?|casos limites?|limites?)\b/,rule:"Riscos: trate falhas, compatibilidade, migração e reversibilidade pertinentes; preserve dados e permissões. Não invente capacidade, acesso, prazo ou garantias de rollback."},
  {id:"verificacao",match:/\b(?:testes?|tests?|build|compil\w*|validac\w*|verific\w*|criterios?|aceitac\w*|evidencias?|readiness|prontidao)\b/,rule:"Verificação: vincule critérios observáveis aos testes e comandos reais do projeto; inclua cenários de erro pertinentes. Use conferências existentes, sem duplicar build ou declarar sucesso sem execução."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:especificac\w* tecnic\w*|technical specifications?|feature spec(?:ification)?|design doc(?:ument)?|documento de design|documento de arquitetura|projeto tecnico|plano tecnico|planejamento tecnico|plano de implementac\w*|implementation plan|implementation readiness|prontidao para implementac\w*|detalhar implementac\w*|detalhamento tecnico|rfc|adr)\b/,
  /\b(?:planejar|planeje|planejamento|elaborar|definir|detalhar|estruturar|especificar)\b.{0,70}\b(?:arquitetura|implementac\w*|sistema|software|erp|crm|plataforma|aplicativo|aplicacao|portal|saas)\b/,
  /\b(?:criar|crie|desenvolver|desenvolva|construir|construa|projetar|projete)\b.{0,65}\b(?:sistema|software|erp|crm|plataforma|aplicativo|aplicacao|portal|saas)\b/,
  /\b(?:sistema|software|erp|crm|plataforma|aplicativo|aplicacao|portal)\b.{0,55}\b(?:do zero|completo)\b/,
];

export function specificationIntent(text:string):boolean{
  return INTENT.some(r=>r.test(normalize(text)));
}
export function specificationFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function specificationEngineeringContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(specificationFocus(text));
  return [
    '## Especificação técnica — plano implementável',
    phase==='planner'
      ? "No plano, reconcilie requisitos e decisões, descreva a mudança técnica, contratos, alternativas materiais e riscos. Converta em objetivo, etapas coesas, dependências, instruções e critérios do contrato Nivoo; escolha detalhes delegados e não crie documentos ou aprovações intermediárias obrigatórias."
      : "Na etapa atual, siga a especificação aprovada e a implementação real; preserve contratos e consumidores, resolva detalhes técnicos delegados e corrija a causa local sem replanejar o trabalho inteiro. Encaminhe somente conflito material ou decisão bloqueante pelo fluxo existente.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Use a conferência técnica existente. Não invente caminhos, comandos, resultados ou autorizações. Não abra revisão independente, sessão extra ou gate por seção; não imponha allowlist de arquivos que impeça corrigir a causa real.",
  ];
}
