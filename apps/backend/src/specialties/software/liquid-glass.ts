import type { Skill } from '../skills';

/** Original Nivoo engineering guidance, inspired by public visual references,
 * not a copy of the prompt library or Apple's proprietary rendering technology. */
export const LIQUID_GLASS_SKILL:Skill={
  id:'software-liquid-glass',domain:'software',
  description:'Liquid Glass para interfaces funcionais',
  source:'https://liquidglassdesign.com/prompts',
  sourceAttribution:'Liquid Glass Design — referência visual e guia público; orientação de engenharia original Nivoo',
  action:'Use vidro em camadas seletivas, preserve legibilidade e identidade, e trate refração como aprimoramento opcional com alternativa opaca.',
  body:[
    'Adote Liquid Glass somente quando o pedido ou o perfil visual aprovado o autorizar. Preserve marca, tema, paleta, fontes, densidade, contratos, componentes e tecnologia do projeto. Não aplique o material a todas as superfícies nem transforme uma correção pontual em redesign. O catálogo de prompts é referência estética de imagens, não código, licença de ativos ou prova de viabilidade de uma interface.',
    'Separe conteúdo de navegação e controles. Use material translúcido em barras, menus, controles, painéis flutuantes e overlays apropriados. Tabelas, textos longos, dados financeiros, formulários críticos e áreas de edição precisam de fundos estáveis e contraste. Preserve semântica e hierarquia; evite camadas de vidro sobre vidro, reflexos que encobrem rótulos e transparência exagerada.',
    'Construa a sensação de material com fundo de tonalidade controlada, contorno fino, destaque especular discreto, raios coerentes, sombra suave e separação real de planos. Reutilize os design tokens selecionados e componentes existentes. Não imponha cores pastel, neon, gradientes ou uma imagem de fundo a todo projeto. Ajuste luminosidade para o tema claro e escuro, sem tornar o conteúdo dependente de uma fotografia.',
    'Diferencie vidro fosco de refração óptica. CSS com translucidez, backdrop-filter e highlights simula o material, mas não desvia a imagem de fundo. Quando a refração for necessária e autorizada, avalie deslocamento por SVG ou shader/canvas conforme suporte real e recursos do projeto. Não afirme refração verdadeira sem verificar deformação do fundo. Não instale biblioteca nem crie renderizador pesado só para reproduzir uma referência.',
    'Implemente melhoria progressiva: superfície opaca legível como base, efeito CSS sob detecção de suporte e refração avançada apenas quando comprovadamente compatível. SVG filters aplicados ao próprio elemento não equivalem automaticamente à refração do backdrop; valide o mecanismo e cada navegador pertinente. Não presuma suporte a filtros SVG no backdrop, captura de DOM ou acesso a pixels de conteúdo arbitrário. Não capture dados privados, telas ou imagens externas para simular vidro.',
    'Garanta contraste de texto e controles sobre os fundos mais difíceis, incluindo conteúdo móvel. Tokens opacos anteriores não certificam vidro translúcido. Use tonalidade suficiente, fallback sólido, opção de reduzir/desligar transparência quando pertinente, foco visível, teclado, zoom e toque. Respeite prefers-reduced-motion e, quando disponível, preferências de contraste/transparência; não dependa de suporte a uma única media query para a acessibilidade. Não comunique status apenas por cor ou efeito.',
    'Use movimento sutil e funcional, ligado a estados reais. Não exija inclinação do dispositivo, rastreamento de ponteiro contínuo, partículas ou animação por frame. Limite áreas de blur e contextos gráficos; descarte recursos, preserve fluidez e forneça fallback estático em dispositivos limitados. Não prometa desempenho sem medições.',
    'Confira a renderização, as ações, foco, contraste composto, responsividade e fallback com as ferramentas existentes, nos temas e navegadores pertinentes. Diferencie observação real, código implementado e teste não realizado. Não copie os 199 prompts, imagens, assets, fontes ou implementações de terceiros; não alegue equivalência com Apple. Não acione geração de imagem, nova sessão, revisão automática, dependência ou etapa obrigatória por esta Skill. Template e componentes reutilizáveis são frentes complementares.',
  ].join('\n'),
};

const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const GLASS=/\b(?:liquid[- ]glass|vidro liquido)\b/;
const NEGATED=/\b(?:sem|evitar|evite|remover|remova|retirar|retire|desativar|desative|nao (?:usar|use|aplicar|aplique))\s+(?:o estilo\s+|o\s+)?(?:liquid[- ]glass|vidro liquido)\b/;
const UI=/\b(?:frontend|front-end|ui|ux|interfaces?|telas?|dashboard|dashboards|website|sites?|landing pages?|pwa|aplicativos?|apps?|botoes?|botao|menus?|modais?|modal|componentes?|navbar|sidebar|toolbar|design system|css|layout|temas?|navegacao|formularios?|tabelas?|paineis?|painel|estilo visual|identidade visual)\b/;
const VISUAL=/\b(?:layout|composicao|design system|css|estiliz\w*|estilo visual|identidade visual|aparencia|visual|paleta|tipografia|refin\w*|redesign|responsiv\w*|transparen\w*|refra\w*|vidro|blur|backdrop-filter|borda|sombra|tema|temas|animac\w*|microinterac\w*)\b/;
const BUILD=/\b(?:criar|crie|desenvolver|desenvolva|construir|construa|projetar|projete|implementar|implemente|montar|monte|redesenh\w*|adicionar|adicione|refatorar|refatore)\b/;
const MEDIA=/\b(?:video|videos|reels|audiovisual|poster|posters|imagem de pizza|renderizar video|ffmpeg|trilha sonora)\b/;

/** Select from the current request/step and the validated project style.
 * A persisted style alone never triggers guidance on unrelated backend work. */
export function liquidGlassIntent(text:string,visualStyleId?:string):boolean{
  const t=normalize(text);
  if(NEGATED.test(t))return false;
  const ui=UI.test(t);
  if(GLASS.test(t)){
    if(ui)return true;
    if(MEDIA.test(t))return false;
    return /^(?:liquid[- ]glass|vidro liquido)$/.test(t.trim())||
      /\b(?:aplicar|aplique|usar|use|adotar|adote|estilo|design|template)\s+(?:o\s+)?(?:liquid[- ]glass|vidro liquido)\b/.test(t);
  }
  return visualStyleId==='liquid-glass'&&ui&&(VISUAL.test(t)||BUILD.test(t));
}

type Focus='material'|'camadas'|'refracao'|'acessibilidade'|'desempenho'|'movimento';
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:'material',match:/\b(?:vidro|glass|frosted|transluc\w*|transparen\w*|iluminac\w*|reflex\w*|borda|sombra|profundidade|materia\w*|blur|backdrop-filter)\b/,rule:'Material: use tonalidade controlada, contornos e luz discretos; mantenha raios e sombras coerentes com os tokens. CSS translúcido é aproximação de vidro fosco.'},
  {id:'camadas',match:/\b(?:botoes?|botao|menus?|navbar|toolbar|sidebar|modais?|modal|paineis?|painel|dashboard|tabelas?|formularios?|navegacao|camadas?|overlays?)\b/,rule:'Camadas: identidade estrutural do aplicativo, com material coerente na navegação, painéis, controles, menus e overlays; dados e formulários críticos em superfícies estáveis do mesmo design system. Não entregue um painel comum com uma amostra decorativa de vidro.'},
  {id:'refracao',match:/\b(?:refra\w*|distorc\w*|displacement|svg|webgl|shaders?|canvas|optica)\b/,rule:'Refração: valide deformação real do fundo e suporte no navegador; SVG, canvas ou shader apenas se necessários. Fallback opaco/CSS não deve ser chamado de refração real.'},
  {id:'acessibilidade',match:/\b(?:acessib\w*|a11y|contraste|legibilidade|texto|zoom|teclado|foco|toque|mobile|celular|transparen\w*)\b/,rule:'Acessibilidade: teste contraste composto sobre fundos reais, foco, toque, zoom e alternativa opaca; preserve preferências de redução de movimento/transparência quando aplicáveis.'},
  {id:'desempenho',match:/\b(?:performance|desempenho|fps|gpu|cpu|mobile|celular|navegadores?|safari|firefox|chrome|fallback|compatib\w*)\b/,rule:'Desempenho: limite blur e camadas, use melhoria progressiva, descarte recursos e verifique fallback por navegador. Não prometa FPS sem medir.'},
  {id:'movimento',match:/\b(?:animac\w*|microinterac\w*|motion|transic\w*|movimento|hover|clique|morph\w*)\b/,rule:'Movimento: feedback breve ligado a estado real, sem loops decorativos; preserve operação sem animação e movimento reduzido.'},
];
export function liquidGlassFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function liquidGlassContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(liquidGlassFocus(text));
  return [
    '## Liquid Glass — material, profundidade e melhoria progressiva',
    phase==='planner'?'No plano, delimite superfícies autorizadas, preserve conteúdo legível e identidade; proponha CSS leve como aproximação e refração somente se necessária e viável.':'Na etapa atual, aplique a identidade em toda a interface no escopo, reutilize tokens e componentes; use vidro seletivo nas camadas e a mesma linguagem visual em conteúdo opaco. Preserve ações, contraste, fallback e verifique o resultado.',
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    'Não trate blur como refração. Não copie prompts ou assets, não instale efeito pesado por padrão e não crie sessão ou revisão extra. Preserve o perfil visual aprovado; se houver conflito, mantenha o padrão e esclareça a decisão.',
  ];
}
