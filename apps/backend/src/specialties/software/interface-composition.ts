import type { Skill } from '../skills';

export const INTERFACE_COMPOSITION_SKILL:Skill={
  id:'software-composicao-interface',domain:'software',description:'Interfaces profissionais, composição e arquitetura da informação',
  source:'https://github.com/Leonxlnx/taste-skill/blob/d1a2bb41d927083ac7118f60cfc9cdf711810ea0/skills/taste-skill/references/layout-v4.md',
  sourceAttribution:'Design Taste Frontend — Leonxlnx (MIT)',
  action:'Organize a interface segundo a tarefa, hierarquia, navegação, componentes e responsividade; preserve funções e sistema visual.',
  body:[
    "Adaptação do Design Taste Frontend de Leonxlnx (MIT), voltada à composição e à arquitetura visual de interfaces. Parta da direção artística aprovada, dos requisitos, da finalidade de cada tela e dos componentes reais. Preserve marca, linguagem, stack, navegação, regras e contratos; não redesenhe além do escopo.",
    "Organize a informação por tarefas e importância. Identifique o que a pessoa precisa entender e fazer primeiro, as informações de apoio e os estados. Use cabeçalhos, espaço, alinhamento, contraste, tamanho e agrupamento para orientar leitura. Não faça todos os blocos competir por atenção ou repita grades de cards quando uma lista ou tabela representa melhor os dados.",
    "Use um sistema coerente de grade, margens, espaçamento, raios, tipografia e ações. Reutilize o design system e componentes do projeto; não imponha CSS, frameworks ou bibliotecas upstream. Em projetos novos, estabeleça tokens e variantes reutilizáveis proporcionais. Alinhe bordas e colunas, use proporções variadas quando úteis e evite caixas aninhadas sem função. Não force alturas iguais se conteúdo ou acessibilidade exigirem outra solução.",
    "Em páginas públicas, apresente uma proposta clara e uma ação principal consistente. Cada seção deve responder uma questão relevante do visitante, com texto e evidência pertinente; varie a composição sem perder unidade. Use imagens reais autorizadas, interface real ou demonstração identificada. Não force uma seção por viewport, contagem mínima de fotos, hero com efeito ou rodapé genérico. Não invente fatos, contatos, avaliações, preços, links nem ações.",
    "Em sistemas operacionais, ERP, CRM e dashboards, a tarefa e a densidade útil prevalecem sobre receitas de landing page. Preserve acesso aos filtros, busca, tabelas, paginação, operações e indicadores de estado. Escolha visualização apropriada ao dado; não substitua um fluxo funcional por mockup ou recorte ilustrativo. Evite cards para cada dado quando uma visão consolidada funciona melhor.",
    "Projete navegação e componentes conforme o fluxo real: menus, abas, breadcrumbs, ações primárias e secundárias, estados vazios, carregamento, erros, sucesso, permissões e foco. Reutilize handlers, contratos e estado real do frontend. Links, formulários, filtros e controles devem funcionar; não simule operações com placeholders. Demonstrações explícitas podem ilustrar o produto sem se passar por aplicação funcional.",
    "Adapte o layout ao conteúdo e às larguras relevantes, incluindo tablet quando fizer sentido. Reordene blocos preservando leitura e acesso a ações; não esconda controles essenciais, achate texto, force zoom ou corte conteúdo para caber. Tabelas largas podem ter rolagem local, com contexto e ações preservados. Verifique áreas seguras e teclado virtual quando pertinente; mantenha contraste, foco, semântica e zoom.",
    "Use a prévia e conferência de interface existentes do Nivoo para observar a renderização e exercitar as ações alteradas nas larguras pertinentes. Não declare teste visual, funcionamento ou acessibilidade sem evidência. Não importe scripts, assets, dealers, CSS, checker ou finish gate do Design Taste. Não crie etapas separadas para cada aspecto, outra sessão ou revisão automática. Movimento avançado e biblioteca externa são frentes complementares, não requisitos universais.",
  ].join('\n'),
};

type Focus="hierarquia"|"composicao"|"navegacao"|"componentes"|"produto"|"adaptacao"|"evidencia";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"hierarquia",match:/\b(?:hierarquia|hierarchy|prioridade|prioridades|escaneabilidade|leitura|foco visual|informac\w*|densidade|dashboard|dashboards)\b/,rule:"Hierarquia: priorize a tarefa principal, agrupe conteúdo relacionado, use títulos e espaço para guiar leitura. Em dashboards, destaque métricas que orientam decisões e mantenha tabelas, filtros e ações acessíveis; não transforme tudo em cards."},
  {id:"composicao",match:/\b(?:composic\w*|composition|layout|grid|bento|colunas?|columns?|alinhamento|margens?|proporc\w*|ritmo|espacamento|sections?|secoes?)\b/,rule:"Composição: use grade e margens coerentes com os tokens existentes; alinhe bordas, controles e títulos, varie proporções segundo o conteúdo. Evite caixas aninhadas decorativas, repetição automática de grades e altura fixa que corte conteúdo."},
  {id:"navegacao",match:/\b(?:navegac\w*|navigation|menus?|sidebar|sidebars?|breadcrumbs?|abas?|tabs?|header|footer|fluxos?|rotas?)\b/,rule:"Navegação: preserve a arquitetura de informação, localização atual, rótulos e rotas reais. Diferencie navegação e ação principal; mantenha retorno, foco e acesso a funções essenciais em telas estreitas."},
  {id:"componentes",match:/\b(?:cards?|cartoes?|componentes?|components?|paineis?|panels?|tabelas?|tables?|formularios?|forms?|listas?|lists?|graficos?|charts?|widgets?)\b/,rule:"Componentes: reutilize variantes reais do design system e selecione cards, listas, tabelas ou gráficos conforme a tarefa. Evite reduzir interfaces reais a miniaturas ilegíveis; mantenha estados, permissões, handlers e dados efetivos."},
  {id:"produto",match:/\b(?:hero|landing pages?|website|site|sites|pagina institucional|pagina de produto|app[- ]frame|vitrine|preview|demonstrac\w*|produto)\b/,rule:"Apresentação: nas páginas públicas, organize uma mensagem principal por bloco e uma ação clara, mostrando o produto ou serviço com evidências autorizadas. Use a UI real ou demonstração identificada; não invente funcionalidade, prova social, preço, links ou controles."},
  {id:"adaptacao",match:/\b(?:responsiv\w*|mobile|celular|tablet|desktop|viewport|breakpoints?|overflow|zoom|safe area|teclado virtual|touch)\b/,rule:"Adaptação: reorganize a leitura e os controles conforme a largura e conteúdo, incluindo desktop, tablet e celular pertinentes. Evite zoom artificial, rolagem horizontal da página e cortes; tabelas extensas podem rolar em região própria. Não force uma seção por viewport."},
  {id:"evidencia",match:/\b(?:acessib\w*|a11y|contraste|focus|foco|teclado|screenshot|capturas?|previa|browser|navegador|testes? visuais?|validac\w* visual)\b/,rule:"Evidência: use semântica, foco visível, contraste, rótulos e alvos de toque adequados; preserve leitura e zoom. Aproveite a prévia e conferência existentes para inspecionar dimensões e interações relevantes. Não declare captura, teste ou conformidade que não realizou."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:composicao (?:de interfaces?|visual|de telas?|de paginas?|do dashboard|do frontend)|interface composition|interfaces? profissiona(?:l|is)|professional ui|layout profissional|layout de dashboard|layout responsivo|hierarquia (?:visual|de informac\w*)|information hierarchy|arquitetura de informacao)\b/,
  /\b(?:criar|crie|desenvolver|desenvolva|construir|construa|projetar|projete|desenhar|desenhe|redesenh\w*|redesign|estruturar|estruture|montar|monte)\b.{0,80}\b(?:dashboard|dashboards|landing pages?|website|site|sites|pagina institucional|pagina de produto|pagina web|loja virtual|interface (?:web|do sistema)|telas? (?:do sistema|de um sistema)|painel administrativo|admin dashboard)\b/,
  /\b(?:organizar|organize|reorganizar|reorganize|ajustar|ajuste|melhorar|melhore|refinar|refine|corrigir|corrija)\b.{0,70}\b(?:composicao|hierarquia visual|layout|grade|grid|alinhamento|distribuicao de componentes|arquitetura de informacao)\b.{0,70}\b(?:interface|frontend|dashboard|tela|pagina web|site|website|ui)\b/,
  /\b(?:dashboard|tela|interface|frontend|site|website|pagina web)\b.{0,75}\b(?:composicao|layout responsivo|hierarquia visual|hierarquia de informacoes|grade de componentes)\b/,
];
export function interfaceCompositionIntent(text:string):boolean{
  return INTENT.some(r=>r.test(normalize(text)));
}
export function interfaceCompositionFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function interfaceCompositionContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(interfaceCompositionFocus(text));
  return [
    '## Composição de interfaces — tarefa, hierarquia e estrutura',
    phase==='planner'?"No plano, identifique a finalidade da tela, hierarquia de informação, navegação, composição e componentes reais ou necessários. Preserve o sistema visual e contratos, escolha padrões conforme a tarefa e organize adaptação por largura e critérios observáveis na conferência existente.":"Na etapa atual, implemente composição e componentes na estrutura real do projeto, preserve estado, rotas e ações funcionais. Ajuste hierarquia, alinhamento e responsividade sem forçar receitas de landing page; confira renderização e interações pertinentes.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Reutilize nivoo-previa.json, nivoo-roteiros e nivoo-conferir-telas quando pertinentes e disponíveis; não importe CSS, scripts, dealers ou gate upstream. Não invente evidências, nem crie nova sessão, dependência ou revisão obrigatória.",
  ];
}
