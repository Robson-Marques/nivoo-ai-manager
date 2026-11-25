import type { Skill } from '../skills';

export const FRONTEND_SKILL:Skill={
  id:'software-frontend',domain:'software',description:'Interfaces, componentes, interação e integração com o backend',
  source:'https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/fastgen-develop',
  action:'Leia a tela, seus componentes, estado e contrato real da API. Entregue interação funcional, consistente e responsiva, não apenas aparência.',
  body:[
    'Identifique a rota, o componente responsável, a tela equivalente, os componentes compartilhados, o estado e o cliente de API reais. Leia os consumidores antes de alterar interfaces compartilhadas. Use o framework, a biblioteca de componentes, os tokens e as convenções já presentes; não imponha React, um design system ou outra dependência.',
    'Preserve a hierarquia visual, a navegação, os controles e os padrões do projeto. Reutilize componentes existentes quando adequados, mas não transforme uma correção pontual em redesenho geral. Uma tela nova deve seguir o padrão real do sistema, sem inventar elementos desconectados da função.',
    'Cada ação deve executar a operação contratada: vincule controles a handlers e serviços reais, trate carregamento, estado vazio, erro recuperável e sucesso confirmado. Não simule dados, permissões ou sucesso com placeholders, mocks permanentes, setTimeout ou atualização visual sem efeito no backend.',
    'Respeite a fonte de verdade e o ciclo de vida de cada estado. Evite duplicação entre estado local, cache e servidor. Em mudanças de rota, sessão ou seleção, descarte respostas obsoletas, cancele solicitações quando suportado e preserve o contexto correto. Não aplique resultado de um usuário, cliente ou conversa a outro.',
    'Formulários: preserve digitação, foco, seleção, validação, mensagens e campos preenchidos quando houver erro. Evite envio duplicado, perda de rascunho e controles travados. Só informe sucesso após confirmação compatível com a operação; se houver atualização otimista, trate reversão e reconciliação.',
    'Layout: adapte conteúdo à largura disponível e ao dispositivo, respeite áreas seguras, teclado virtual e viewport móvel quando pertinentes. Não esconda funcionalidade essencial para resolver overflow. Preserve hierarquia, contraste, semântica, rótulos, navegação por teclado e foco visível. Para comportamento dependente de plataforma, diferencie emulação de navegador de teste em aparelho real.',
    'Use a conferência existente do projeto e as ferramentas de navegador autorizadas pelo Nivoo quando aplicáveis. Exercite a ação alterada e seu resultado observável, além da aparência; para mutações, confirme o efeito após recarregar ou por outro mecanismo de teste real, quando pertinente. Use dados descartáveis de teste. Não invente rotas, seletores, credenciais ou afirmações de validação.',
    'Quando mudar visual, utilize as evidências de tela no computador e no celular conforme o contrato atual. Para alteração de interação, escreva ou atualize o roteiro existente, com condições observáveis e casos relevantes. Reutilize a mesma conferência técnica, sem instalar outro navegador, criar outra sessão de IA ou repetir a mesma captura sem necessidade.',
  ].join('\n'),
};

type Focus='componentes'|'estado'|'formularios'|'api'|'responsividade'|'acessibilidade';
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:'componentes',match:/\b(?:component\w*|react|vue|angular|svelte|design system|layout|telas?|paginas?|menus?|abas?|cards?|navegac\w*|rotas?|css|tsx)\b/,rule:'Componentes: leia a tela irmã e os componentes compartilhados, suas propriedades e consumidores. Preserve contexto de navegação, padrões visuais e funcionalidades não solicitadas.'},
  {id:'estado',match:/\b(?:estados?|state|hooks?|stores?|cache|loading|carreg\w*|sess\w*|conversas?|seleca\w*|sincroniz\w*|race condition|resposta atrasada|recarreg\w*)\b/,rule:'Estado: trace a origem do dado e os eventos que o modificam. Diferencie carregando, vazio, erro e sucesso; não aplique resposta obsoleta a outra sessão ou seleção.'},
  {id:'formularios',match:/\b(?:formularios?|inputs?|campos?|digita\w*|foco|focus|cadastros?|salvar|submit|envios?|validac\w*|rascunhos?|botoes|botao)\b/,rule:'Formulários e ações: preserve valor e foco durante digitação, trate validação, Enter, erros e envios duplicados. Confirme o efeito real e mantenha dados editáveis após falha.'},
  {id:'api',match:/\b(?:apis?|endpoints?|backend|fetch|axios|requests?|requisic\w*|integrac\w*|http|graphql|websocket|sse|rede|salvar|envios?)\b/,rule:'API: leia o cliente e o endpoint/contrato efetivo. Use dados reais, trate erros e requisições concorrentes; não transforme falha em sucesso visual. Confirme efeitos persistentes com a evidência existente.'},
  {id:'responsividade',match:/\b(?:responsiv\w*|mobile|celular|desktop|viewport|overflow|teclado|keyboard|pwa|ios|android|scroll|safe area|layout|css)\b/,rule:'Responsividade: use dimensões, áreas seguras e comportamento de teclado compatíveis com a plataforma. Não corrija overflow ocultando ações. Aproveite o navegador de teste e fotos computador/celular; emulação não prova funcionamento no iOS real.'},
  {id:'acessibilidade',match:/\b(?:acessib\w*|a11y|aria|contraste|teclado|keyboard|foco|focus|semant\w*|leitor de tela|rotulos?|formularios?)\b/,rule:'Acessibilidade: preserve elementos semânticos, nomes acessíveis, rótulos e foco visível. Exercite teclado e controles desabilitados; não substitua botão real por elemento visual inerte.'},
];

const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');

/** Explicit interface intent, not generic design or a TypeScript interface. */
export function frontendIntent(text:string):boolean{
  const t=normalize(text);
  return /\b(?:frontend|front-end|react|vue|angular|svelte|next\.js|componentes? (?:react|de interface)|interface (?:web|do sistema)|responsiv\w*|formularios?|telas? do sistema|design system|acessibilidade|a11y|viewport|pwa|teclado virtual)\b/.test(t)
    || /\b[\w./-]+\.(?:tsx|jsx|vue|svelte)\b/.test(t)
    || /\b(?:app|pages|components|views|screens|frontend|web)\/[\w./-]+\.(?:html|css|scss|sass|less|[cm]?[jt]s)\b/.test(t)
    || (/\b(?:mostrar|exibir|apresentar|ocultar|adicionar|remover)\b.{0,75}\b(?:linhas?|colunas?|botoes?|botao|cards?|cartoes?|tabelas?|campos?|abas?)\b/.test(t)&&!/\b(?:terminal|stdout|stderr|console|linha de comando|select sql)\b/.test(t))
    || /\b(?:corrigir|ajustar|criar|alterar|implementar|desenvolver|refatorar)\b.{0,100}\b(?:tela|pagina web|menu|botao|navegacao|layout da interface|foco do campo)\b/.test(t);
}
export function frontendFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}

/** Context for the existing planning/execution session. No new work item. */
export function frontendEngineeringContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(frontendFocus(text));
  return [
    '## Engenharia de frontend — interação funcional',
    phase==='planner'
      ? 'No plano, identifique a tela/fluxo e a referência real do sistema, os contratos alterados e o resultado observável da interação. Use a conferência de interface já disponível apenas onde a mudança exigir; preserve as regras de evidência existentes.'
      : 'Na etapa atual, leia a tela, os componentes, o estado, o cliente de API e os consumidores pertinentes. Implemente a ação real e preserve o padrão visual e a navegação. Não entregue botão, estado ou confirmação apenas ilustrativos.',
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    'Para evidência, reaproveite nivoo-previa.json, nivoo-roteiros e nivoo-conferir-telas quando pertinentes e disponíveis no projeto; confira os comandos e seletores reais. Não acrescente nova revisão, outro navegador ou uma conferência duplicada. Uma captura de tela não comprova persistência nem funcionamento da ação.',
  ];
}
