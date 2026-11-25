import type { Skill } from '../skills';

export const INTERFACE_MOTION_SKILL:Skill={
  id:'software-microinteracoes',domain:'software',description:'Animações e microinterações de interfaces',
  source:'https://github.com/Leonxlnx/taste-skill/blob/d1a2bb41d927083ac7118f60cfc9cdf711810ea0/skills/taste-skill/references/motion.md',
  sourceAttribution:'Design Taste Frontend — Leonxlnx (MIT)',
  action:'Implemente movimento com finalidade, feedback real, transições acessíveis e efeitos proporcionais; preserve desempenho e estado funcional.',
  body:[
    "Adaptação de Design Taste Frontend (Leonxlnx, MIT), restrita a movimento em interfaces de software. Não é a Skill motion de produção audiovisual. Comece pelo propósito: feedback, mudança de estado, orientação espacial ou apresentação de conteúdo. Preserve marca, dados, controles, rotas, contratos e funcionalidade. Não obrigue toda página a ter entrada, efeito, loop, cena ou animação.",
    "Microinterações: dê retorno visual imediato a ações reais, com hover discreto em ponteiros compatíveis, foco visível e pressão por toque ou teclado. Use a escala de duração e easing do projeto; na ausência, feedback em cerca de 120–180 ms, pressão em torno de 90 ms e menus/painéis simples em 160–240 ms são referências, não imposições. Prefira desaceleração natural sem overshoot quando adequado. Não faça a ação depender da animação.",
    "Transições de estado: vincule movimento ao estado real (abrir, fechar, carregar, selecionar, erro ou sucesso confirmado). Não use contagem animada para inventar dados, pulso para simular atividade ou temporizador para fingir operação. Permita interrupção, preserve foco, semântica, navegação e estado final. Conteúdo e controles devem permanecer disponíveis sem animação.",
    "Entradas e momentos narrativos: uma entrada breve ou uma composição de fotografia, tipografia, produto ou UI pode reforçar a proposta quando pertinente. Não faça animação repetitiva em cada card, scroll-jacking, cursor substituído ou atraso de acesso a conteúdo. Em telas operacionais prefira feedback funcional; em páginas públicas efeitos são escolhas de direção artística, não requisitos universais.",
    "Efeitos avançados: WebGL, shaders, canvas, partículas e 3D somente quando o propósito, escopo e recursos justificarem. Priorize conteúdo real, uma composição focal e fallback estático acessível. Não substitua produto, dado ou função por abstração. Reutilize bibliotecas existentes; não instale kit upstream, importe assets ou acrescente dependências apenas por decoração. Trate perda de contexto e dispositivos limitados.",
    "Desempenho: anime preferencialmente transform e opacity, com cor quando pertinente; evite transition-all e propriedades que disparem layout por frame. Reserve dimensões, limite trabalho por frame, resolução e contextos GPU. Pause loops decorativos fora de vista ou aba oculta, limpe listeners, observers, timers, RAF e recursos na desmontagem. Use medições disponíveis; FPS de emulação ou CPU não comprova desempenho em dispositivo real.",
    "Acessibilidade: respeite prefers-reduced-motion e forneça pausa/parada quando movimento persistente exigir. Mantenha conteúdo legível em repouso, sem JS ou sem GPU conforme o escopo; preserve foco, teclado, toque, contraste e estados semânticos. Não dependa de hover nem de movimento para comunicar informação essencial. Evite flashes e movimento que impeça leitura ou operação.",
    "Reutilize a prévia, roteiros e conferência existentes do Nivoo para verificar interação, estado final, responsividade, movimento reduzido e fallback quando pertinentes e disponíveis. Não invente evidência. Não importe motion.css, motion.js, dealers, checker, scripts de performance ou finish gate upstream. Não crie revisão, fila, etapa, sessão ou orçamento obrigatório apenas por esta Skill.",
  ].join('\n'),
};

type Focus="feedback"|"estados"|"entrada"|"efeitos"|"desempenho"|"acessibilidade"|"evidencia";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"feedback",match:/\b(?:hover|press|pressionar|click|clique|tap|toque|botoes?|botao|links?|feedback|microinterac\w*)\b/,rule:"Feedback: dê resposta discreta a hover, foco, toque e pressão; hover somente onde o ponteiro suporta. Reutilize tokens; como referência, 120–180 ms para feedback e cerca de 90 ms para pressão. Não desloque vizinhos nem vincule confirmação de sucesso à animação."},
  {id:"estados",match:/\b(?:transic\w*|transitions?|estados?|states?|loading|carreg\w*|menus?|modais?|modal|dialogs?|popovers?|abas?|tabs?|expandir|collapse|accordion)\b/,rule:"Estados: transições devem explicar abertura, fechamento e mudança real. Use cerca de 160–240 ms para painéis simples quando adequado. Preserve foco, teclado, cancelamento, interrupção e o estado final; não atrase ação ou resposta para cumprir uma duração."},
  {id:"entrada",match:/\b(?:entradas?|entrance|hero|reveal|revelac\w*|stagger|aparec\w*|scroll|rolagem|sticky)\b/,rule:"Entrada e narrativa: use entrada breve e pontual, ou um momento de destaque que comunique a oferta. Conteúdo deve estar legível sem JavaScript e em repouso; não esconda texto essencial, não controle a rolagem do usuário nem anime cada card ao entrar na viewport."},
  {id:"efeitos",match:/\b(?:webgl|shaders?|canvas|three\.js|efeitos? (?:visuais?|3d|avancados?)|parallax|particulas?|particles?|lottie|animacao 3d|cena 3d)\b/,rule:"Efeitos: reserve cenas, shaders, canvas ou 3D para conteúdo que justifique o custo. Prefira uma composição focal e poucos contextos; use fallback estático real e trate falha de inicialização ou perda de contexto. Preserve interação e não adicione biblioteca por decoração."},
  {id:"desempenho",match:/\b(?:performance|desempenho|fps|frame rate|jank|trav\w*|gpu|cpu|memoria|raf|requestanimationframe|layout shift|cls|loops?|timers?|animac\w*)\b/,rule:"Desempenho: prefira transform e opacity, evitando reflow e transition-all. Limite loops, resolução e trabalho por frame; pause efeitos decorativos fora de vista ou aba oculta, limpe listeners, timers, RAF e recursos GPU no descarte. Meça no ambiente disponível; não prometa FPS."},
  {id:"acessibilidade",match:/\b(?:acessib\w*|a11y|reduced[- ]motion|movimento reduzido|prefers-reduced-motion|teclado|keyboard|focus|foco|vestibular|flashes?|mobile|celular|touch)\b/,rule:"Acessibilidade: respeite prefers-reduced-motion, ofereça pausa para movimento persistente quando necessário e evite flashes. Mantenha foco visível, semântica e operação por teclado/toque; informação não pode depender só de movimento ou hover."},
  {id:"evidencia",match:/\b(?:testes?|tests?|validac\w*|verific\w*|capturas?|previa|navegador|browser|screenshot|profil\w*|medic\w*)\b/,rule:"Evidência: use a conferência existente para verificar ação, estado final, tamanhos relevantes e fallback de movimento reduzido quando disponível. Diferencie captura estática, medição local e experiência em dispositivo real; não invente resultados."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:microinterac\w*|micro[- ]interactions?|ui motion|motion (?:ui|design de interface)|animac\w* (?:de|da|do|na|no|em) (?:interface|frontend|front-end|ui|site|website|dashboard|tela|menu|botao|botoes|modal|cards?|abas?|componentes?)|transic\w* (?:de|da|do|na|no|em) (?:interface|ui|telas?|menus?|modais?|abas?|componentes?|estados?))\b/,
  /\b(?:frontend|front-end|interface (?:web|do sistema)|ui|site|website|landing pages?|dashboard|tela do sistema|componentes? react)\b.{0,80}\b(?:animac\w*|animar|microinterac\w*|transic\w*|hover|webgl|shader|shaders|movimento reduzido|reduced[- ]motion)\b/,
  /\b(?:animar|animacao|animacoes|implementar|criar|ajustar|corrigir|adicionar|melhorar)\b.{0,55}\b(?:hover|transic\w*|animac\w*|webgl|shaders?|efeitos? visuais|prefers-reduced-motion)\b.{0,65}\b(?:interface|frontend|ui|site|website|dashboard|tela|menus?|botoes|botao|modal|cards?|componentes? react)\b/,
  /\b(?:prefers-reduced-motion|framer motion|motion\.dev|css animations?|css transitions?)\b/,
];
export function interfaceMotionIntent(text:string):boolean{
  return INTENT.some(r=>r.test(normalize(text)));
}
export function interfaceMotionFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function interfaceMotionContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(interfaceMotionFocus(text));
  return [
    '## Movimento de interface — feedback, fluidez e acessibilidade',
    phase==='planner'?"No plano, identifique quais interações ou momentos precisam de movimento, sua finalidade, estados reais, recursos existentes e alternativa acessível. Defina critérios observáveis de fluidez e funcionamento proporcionais ao escopo, sem impor efeito ou etapa adicional.":"Na etapa atual, implemente movimento ligado às ações e estados reais, reutilize tokens e bibliotecas disponíveis. Preserve foco, teclado, toque e estado final, trate redução de movimento e descarte de recursos. Confira os comportamentos pertinentes com as ferramentas existentes.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Use nivoo-previa.json, nivoo-roteiros e nivoo-conferir-telas quando disponíveis e pertinentes. Não declare FPS, testes ou acessibilidade sem evidência. Não importe scripts, hooks ou gate upstream; sem nova sessão, dependência decorativa ou revisão obrigatória.",
  ];
}
