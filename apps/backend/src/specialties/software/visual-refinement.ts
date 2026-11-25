import type { Skill } from '../skills';

export const VISUAL_REFINEMENT_SKILL:Skill={
  id:'software-refinamento-visual',domain:'software',description:'Refinamento visual e anti-slop de interfaces',
  source:'https://github.com/heydamir/unslop/blob/620163eedb3529d9cd23a3994ed8d287d06f760d/skills/unslop/SKILL.md',
  sourceAttribution:'Unslop — Damir Sokolovsky (@heydamir), CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
  action:'Refine interfaces com identidade própria, hierarquia, coerência visual e preservação das funcionalidades; use evidências de tela existentes.',
  body:[
    "Adaptação do Unslop de Damir Sokolovsky, CC BY 4.0, para refinamento de interfaces de software. O objetivo é melhorar qualidade visual e identidade própria sem substituir o produto, suas funções, conteúdo, regras, integrações ou controles. Respeite a marca aprovada, incluindo suas cores, tipografia, logo e linguagem. Não imponha uma estética universal ou proíba efeitos que sejam parte deliberada da marca.",
    "Observe a interface atual e as fontes que a renderizam. Quando o ambiente permitir, use as prévias, capturas e ferramentas de navegador já autorizadas pelo Nivoo para avaliar o que realmente aparece em desktop e celular. Se não houver prévia acessível, diferencie avaliação do código de inspeção visual. Não invente capturas nem instale scripts upstream, navegadores ou serviços extras.",
    "Classifique o escopo pelo diagnóstico: se a interface funciona e tem poucas inconsistências, corrija apenas esses pontos; se existem problemas generalizados e o usuário autorizou redesign, aplique o refinamento amplo; se a tela já é adequada, não mude apenas para parecer diferente. Quando a mudança envolver decisão de marca não delegada, utilize a aprovação existente, sem criar novo gate.",
    "Defina uma direção curta a partir do produto e de seus usuários: finalidade, personalidade, referências do universo do produto, um ou dois pontos de destaque e detalhe distintivo quando pertinente. Concentre riqueza visual no conteúdo importante e mantenha controles claros. Não copie composição ou ativos de terceiros, não invente marca e não transforme sistemas administrativos em páginas promocionais.",
    "Trabalhe os nove aspectos do Unslop na ordem lógica: espaçamento, cores, ícones, texto, tipografia, layout, detalhes, visuais e movimento. Aplique apenas os que forem pertinentes; a sequência é uma técnica de composição, não nove jobs, etapas, revisões ou sessões. Reutilize tokens e componentes reais, e preserve acessibilidade, ações, estado, contratos e ordem de leitura.",
    "Use escalas consistentes, contraste suficiente, pesos tipográficos legíveis, ícones semânticos, agrupamento e proporções adequadas. Evite gradientes, brilhos, pílulas, emojis ou ornamentos repetidos quando não cumprem uma função; preserve a identidade aprovada e os indicadores semânticos. Não remova status, controles, avisos ou rótulos necessários apenas por estética.",
    "Para dashboards, dê prioridade a dados reais, métricas comparáveis e gráficos legíveis. Para landing pages, mantenha mensagem específica, ação principal e visual coerente com o produto. Utilize referências ou imagens autorizadas quando necessário; não gere imagens só para preencher espaço. Dados fictícios são permitidos somente em demonstrações claramente identificadas, nunca como resultados reais.",
    "Preserve foco visível, navegação por teclado, contraste, zoom, responsividade, leitura RTL quando aplicável e redução de movimento. Use a conferência técnica existente para comparar a tela e exercitar ações afetadas. Não crie vídeo de antes/depois, snapshots externos, geração paga, relatório compulsório, nova sessão, dependência ou revisão automática; esses artefatos só fazem parte do trabalho quando solicitados e autorizados.",
  ].join('\n'),
};

type Focus="espacamento"|"cores"|"icones"|"texto"|"tipografia"|"layout"|"detalhes"|"visuais"|"movimento";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"espacamento",match:/\b(?:espacamento|spacing|padding|margens?|margin|gaps?|alinhamento|densidade|grid|ritmo)\b/,rule:"Espaçamento: use escala coerente (4 px como referência quando compatível), alinhamento de colunas e agrupamento por proximidade; diferencie densidade de navegação e conteúdo. Preserve tamanhos acessíveis de controles."},
  {id:"cores",match:/\b(?:cores?|paleta|color|colours?|gradientes?|gradients?|glow|glows|neon|contraste|contrast|sombras?|shadows?|superficies?)\b/,rule:"Cor: contenha a decoração das superfícies, organize papéis de texto e superfícies, preserve cor de marca e cores semânticas. Use destaque onde há significado; verifique contraste, inclusive foco e estados."},
  {id:"icones",match:/\b(?:icones?|icons?|emojis?|badges?|selos?|pictogramas?)\b/,rule:"Ícones: reutilize a família do projeto, alinhe tamanho e traço e retire ornamento redundante sem apagar informação; mantenha nomes acessíveis e status significativos."},
  {id:"texto",match:/\b(?:copy|microcopy|textos?|rotulos?|labels?|headline|titulos?|mensagens?|promessas?|cta)\b/,rule:"Texto: use rótulos curtos, específicos do produto e ações claras. Preserve conteúdo, idioma, fatos e avisos obrigatórios; não invente números, depoimentos, benefícios ou sucesso."},
  {id:"tipografia",match:/\b(?:tipografia|typography|fontes?|fonts?|peso|weights?|tracking|legibilidade|hierarquia tipografica|numeros?)\b/,rule:"Tipografia: organize poucos níveis coerentes, legibilidade e hierarquia por tamanho, peso e cor; preserve fonte de marca. Alinhe números quando comparáveis; respeite escritas RTL, escala e zoom."},
  {id:"layout",match:/\b(?:layout|composicao|composition|hero|sidebar|dashboard|dashboards|landing page|landing pages|responsiv\w*|mobile|desktop|cards?|telas?|paginas?)\b/,rule:"Layout: adapte proporções, agrupamento e hierarquia ao tipo de tela; mantenha navegação e ordem de leitura. Preserve seções e ações existentes salvo escopo explícito; não esconda recursos essenciais no celular."},
  {id:"detalhes",match:/\b(?:detalhes?|details?|bordas?|border|radius|raios?|graficos?|charts?|tabelas?|tables?|estados?|focus|foco|hover|polimento)\b/,rule:"Detalhes: harmonize bordas, raios e estados; preserve foco visível, interação e significado de métricas. Escolha gráficos adequados aos dados reais, sem decoração que distorça informação."},
  {id:"visuais",match:/\b(?:visuais?|visuals?|imagens?|images?|ilustrac\w*|fotograf\w*|hero|objetos?|renders?|decorac\w*|identidade)\b/,rule:"Visuais: destaque conteúdo que pertence ao produto, não abstrações decorativas genéricas. Dashboards não precisam de imagens por padrão. Use ativos autorizados, dados reais em produção e referências pertinentes; não gere mídia paga sem autorização."},
  {id:"movimento",match:/\b(?:movimento|motion|animac\w*|animation|transic\w*|transitions?|microinterac\w*|pulse|shimmer|parallax)\b/,rule:"Movimento: remova loops sem função; preserve feedback, indicadores realmente ativos e transições úteis. Anime propriedades leves, respeite prefers-reduced-motion e não prejudique desempenho ou acessibilidade."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:unslop|anti[- ]?slop|vibecoded ui|ai-looking ui|ai generated ui|interface (?:generica|com cara de ia)|aparencia (?:generica|de ia|artificial)|visual (?:generico|de ia|artificial))\b/,
  /\b(?:redesign|redesenh\w*|refin\w*|polir|polimento|reestiliz\w*|moderniz\w*|melhorar|melhore|limpar|revitaliz\w*|reformular|reformule)\b.{0,85}\b(?:frontend|front-end|interface(?:s)?(?: web| do sistema)?|telas?|dashboard|dashboards|landing pages?|pagina web|layout|visual do sistema|ui)\b/,
  /\b(?:frontend|front-end|interfaces?|telas?|dashboard|dashboards|landing pages?|pagina web|layout|ui)\b.{0,85}\b(?:redesign|redesenh\w*|refin\w*|polimento|generica|generico|cara de ia|aparencia artificial|visual artificial|slop)\b/,
  /\b(?:remover|retirar|reduzir|corrigir|eliminar)\b.{0,60}\b(?:gradientes?|glows?|neon|emojis?|ornamentos?|efeitos decorativos|espacamento irregular)\b.{0,70}\b(?:interface|frontend|tela|dashboard|ui|pagina web)\b/,
];
export function visualRefinementIntent(text:string):boolean{
  return INTENT.some(r=>r.test(normalize(text)));
}
export function visualRefinementFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function visualRefinementContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(visualRefinementFocus(text));
  return [
    '## Refinamento visual — identidade, clareza e função',
    phase==='planner'?"No plano, identifique a tela, o estado visual real, os problemas relevantes e o grau de refinamento autorizado. Derive direção do produto e da marca, preserve funções e contratos e use a conferência existente de interface, sem criar uma etapa para cada aspecto visual.":"Na etapa atual, localize os componentes e estilos reais, preserve o comportamento aprovado e aplique os ajustes pertinentes em ordem lógica. Use tokens existentes; compare a renderização disponível e exercite as ações afetadas, sem reescrever a aplicação por estética.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Aproveite nivoo-previa.json, nivoo-roteiros e nivoo-conferir-telas quando disponíveis e pertinentes. Não declare inspeção visual sem captura real; não acrescente nova revisão, geração paga, dependência ou sessão. Preserve marca e acessibilidade.",
  ];
}
