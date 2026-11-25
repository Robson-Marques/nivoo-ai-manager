import { VISUAL_PALETTES,VISUAL_DENSITIES,STYLE_FOUNDATIONS,type ColorTokens } from './visual-token-catalog';
import { GLASS_VARIANTS } from './visual-style-catalog';
import { GLASS_MATERIAL_CSS } from './liquid-glass-material';
import { writeSessionContextFile } from '../common/session-context-file';

export const LIQUID_GLASS_TEMPLATE_VERSION=1;
const ROOT=':where([data-nivoo-glass])';
const MATERIAL_CSS="/* Nivoo Liquid Glass v1 — scoped CSS; no reset outside opt-in root. */\n:where([data-nivoo-glass]) {\n  min-width: 0;\n  color: var(--nv-glass-text);\n  background: var(--nv-glass-background);\n  font-family: var(--nv-glass-font-body, system-ui, sans-serif);\n  line-height: 1.5;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-heading) {\n  font-family: var(--nv-glass-font-heading, inherit);\n  color: var(--nv-glass-text);\n  line-height: 1.25;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-shell) {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: var(--nv-glass-space-lg);\n  padding: var(--nv-glass-space-lg);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-content) {\n  min-width: 0;\n  background: var(--nv-glass-surface);\n  color: var(--nv-glass-text);\n  border: var(--nv-glass-border-width) solid var(--nv-glass-border);\n  border-radius: var(--nv-glass-radius-panel);\n  padding: var(--nv-glass-space-lg);\n  overflow-wrap: anywhere;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-material, .nv-glass-overlay) {\n  /* Opaque default; glass is a progressive enhancement. */\n  min-width: 0;\n  background: var(--nv-glass-surface-raised);\n  color: var(--nv-glass-text);\n  border: var(--nv-glass-border-width) solid var(--nv-glass-border);\n  border-radius: var(--nv-glass-radius-panel);\n  padding: var(--nv-glass-space-md);\n  box-shadow: var(--nv-glass-shadow-panel);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-overlay) {\n  border-radius: var(--nv-glass-radius-overlay);\n  box-shadow: var(--nv-glass-shadow-overlay);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-muted) {\n  color: var(--nv-glass-muted);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-control) {\n  box-sizing: border-box;\n  min-height: var(--nv-glass-control-height);\n  max-width: 100%;\n  padding: var(--nv-glass-space-sm) var(--nv-glass-space-md);\n  border: var(--nv-glass-border-width) solid var(--nv-glass-control-border);\n  border-radius: var(--nv-glass-radius-control);\n  background: var(--nv-glass-surface);\n  color: var(--nv-glass-text);\n  font: inherit;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-primary) {\n  background: var(--nv-glass-accent);\n  color: var(--nv-glass-on-accent);\n  border-color: var(--nv-glass-accent);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-control):focus-visible {\n  outline: 2px solid var(--nv-glass-focus);\n  outline-offset: 3px;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-control:disabled, .nv-glass-control[aria-disabled=\"true\"]) {\n  opacity: .65;\n  cursor: not-allowed;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-status-success) { color: var(--nv-glass-success); }\n:where([data-nivoo-glass]) :where(.nv-glass-status-warning) { color: var(--nv-glass-warning); }\n:where([data-nivoo-glass]) :where(.nv-glass-status-danger) { color: var(--nv-glass-danger); }\n:where([data-nivoo-glass]) :where(.nv-glass-status-info) { color: var(--nv-glass-info); }\n:where([data-nivoo-glass]) :where(.nv-glass-scroll) { max-width: 100%; overflow: auto; }\n:where([data-nivoo-glass]) :where(.nv-glass-row) { min-height: var(--nv-glass-row-height); }\n@supports ((backdrop-filter: blur(12px)) or (-webkit-backdrop-filter: blur(12px))) {\n  :where([data-nivoo-glass]) :where(.nv-glass-material, .nv-glass-overlay) {\n    background: var(--nv-glass-tint);\n    -webkit-backdrop-filter: blur(var(--nv-glass-blur,12px));\n    backdrop-filter: blur(var(--nv-glass-blur,12px));\n    box-shadow: var(--nv-glass-highlight,inset 0 1px 0 rgba(255,255,255,.18)), var(--nv-glass-shadow-panel);\n  }\n  :where([data-nivoo-glass]) :where(.nv-glass-overlay) {\n    box-shadow: var(--nv-glass-highlight,inset 0 1px 0 rgba(255,255,255,.18)), var(--nv-glass-shadow-overlay);\n  }\n}\n/* Explicit opt-out works without media-query support. Keep after enhancement. */\n:where([data-nivoo-glass][data-transparency=\"opaque\"]) :where(.nv-glass-material, .nv-glass-overlay) {\n  background: var(--nv-glass-surface-raised);\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n  box-shadow: none;\n}\n@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {\n  :where([data-nivoo-glass]) :where(.nv-glass-material, .nv-glass-overlay) {\n    background: var(--nv-glass-surface-raised);\n    -webkit-backdrop-filter: none;\n    backdrop-filter: none;\n    box-shadow: none;\n  }\n}\n@media (pointer: coarse) {\n  :where([data-nivoo-glass]) :where(.nv-glass-control) { min-height: var(--nv-glass-touch-height); }\n}\n@media (max-width: 600px) {\n  :where([data-nivoo-glass]) :where(.nv-glass-shell, .nv-glass-content) {\n    padding: var(--nv-glass-space-md);\n  }\n}\n@media (prefers-reduced-motion: reduce) {\n  :where([data-nivoo-glass]) :where(.nv-glass-material, .nv-glass-overlay, .nv-glass-control) {\n    animation: none;\n    transition: none;\n    scroll-behavior: auto;\n  }\n}\n@media (forced-colors: active) {\n  :where([data-nivoo-glass]) { background: Canvas; color: CanvasText; }\n  :where([data-nivoo-glass]) :where(.nv-glass-content, .nv-glass-material, .nv-glass-overlay) {\n    background: Canvas;\n    color: CanvasText;\n    border-color: CanvasText;\n    box-shadow: none;\n    -webkit-backdrop-filter: none;\n    backdrop-filter: none;\n  }\n  :where([data-nivoo-glass]) :where(.nv-glass-heading, .nv-glass-muted, .nv-glass-status-success, .nv-glass-status-warning, .nv-glass-status-danger, .nv-glass-status-info) { color: CanvasText; }\n  :where([data-nivoo-glass]) :where(.nv-glass-control) {\n    background: ButtonFace; color: ButtonText; border-color: ButtonText;\n  }\n  :where([data-nivoo-glass]) :where(.nv-glass-control):focus-visible { outline-color: Highlight; }\n}\n";
const GUIDE="# Nivoo Liquid Glass — template CSS v1\n\nAplique apenas no escopo visual aprovado. Copie/adapte o CSS para os arquivos\nreais de estilo do projeto e importe pelo mecanismo existente. Não importe\nautomaticamente no frontend do Nivoo nem substitua a arquitetura de um cliente.\n\n- Raiz opt-in: data-nivoo-glass; escolha data-palette (ocean-blue, emerald,\n  violet, graphite), data-theme (light, dark, system) e data-density (compact,\n  balanced, spacious) de acordo com o perfil. O exemplo usa ocean-blue/system/\n  balanced apenas como demonstração. Sem atributos, o CSS tem fallback\n  graphite/claro/equilibrado; não equivale a uma decisão persistida.\n- Use uma única raiz por região; não aninhe raízes com temas diferentes.\n  Reutilize tokens e fontes existentes via variáveis --nv-glass-* ou adapte\n  o mapeamento ao design system. Defina as fontes heading/body localmente.\n- .nv-glass-material e .nv-glass-overlay: navegação e camadas flutuantes.\n  .nv-glass-content: conteúdo e dados opacos. .nv-glass-shell: layout simples.\n  .nv-glass-control e .nv-glass-primary: bases visuais de controles reais;\n  não são componentes nem handlers. Não aplique blur a cada item de tabela.\n- data-transparency=\"opaque\" na raiz desliga o efeito independentemente\n  do navegador. O template também trata redução de transparência/contraste\n  quando suportados, cores forçadas, movimento reduzido e toque.\n- A camada translúcida usa blur e highlight; não há refração óptica real,\n  captura do DOM, WebGL ou SVG displacement. Não descreva como reprodução\n  exata do material Apple. Verifique o fundo real, texto, estados, foco e\n  controles antes de integrar; o CSS não certifica acessibilidade.\n- Use elementos semânticos, rótulos e estados reais. A biblioteca de\n  componentes vem na frente seguinte. Este template não cria dados,\n  rotas, autenticação, modais funcionais nem altera lógica.\n- O HTML de exemplo é uma amostra local estática; não é software entregue.\n  Não use URLs de CDN, novas bibliotecas ou imagens externas por padrão.\n\n- Se o perfil definir glassVariantId, aplique data-glass-variant na raiz:\n  crystal-glass (polido), frosted-glass (fosco), dark-glass (fumê),\n  prism-glass (iridescente). Sem atributo mantém a aparência anterior.\n  Use o tema escolhido; Dark Glass recomenda escuro apenas se delegado.\n  Prism Glass tem realces cromáticos CSS, não refração óptica real.\n\n## Aplicação estrutural\nA raiz do aplicativo usa data-nivoo-glass e nv-glass-stage. Aplique o material escolhido de forma coerente em TODAS as telas no escopo: shell, navegação, botões, painéis, formulários, filtros, listas, tabelas, menus, diálogos e estados. Use nv-glass-material na navegação, nv-glass-panel em indicadores, nv-glass-content em dados densos, nv-glass-control em controles e nv-glass-primary para ações. Conteúdo opaco é parte intencional da mesma identidade, não licença para um segundo tema genérico. Use tokens de fonte, raio, cor e espaçamento em todo o aplicativo. Não adicione cartão decorativo isolado como substituto. Não há refração óptica real; preserve legibilidade e teste a composição real.\n";
const EXAMPLE_HTML="<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Nivoo — amostra Liquid Glass</title>\n<link rel=\"stylesheet\" href=\"liquid-glass.css\">\n</head>\n<body style=\"margin:0\">\n<main data-nivoo-glass class=\"nv-glass-stage\" data-palette=\"ocean-blue\" data-glass-variant=\"frosted-glass\" data-theme=\"system\" data-density=\"balanced\">\n  <div class=\"nv-glass-shell\">\n    <header class=\"nv-glass-material\">\n      <strong>Nivoo · amostra de material</strong>\n      <p class=\"nv-glass-muted\">Navegação translúcida sobre o fundo. Demonstração estática.</p>\n    </header>\n    <section class=\"nv-glass-content\">\n      <h1 class=\"nv-glass-heading\">Área de conteúdo</h1>\n      <p>Dados e textos permanecem sobre uma superfície opaca.</p>\n      <p class=\"nv-glass-status-success\">Estado de exemplo: disponível</p>\n      <label for=\"sample\">Campo de exemplo</label>\n      <input id=\"sample\" class=\"nv-glass-control\" value=\"Cliente exemplo\">\n    </section>\n    <aside class=\"nv-glass-overlay\">\n      <strong>Painel de referência</strong>\n      <p class=\"nv-glass-muted\">Camada destacada sem refração óptica.</p>\n    </aside>\n  </div>\n</main>\n</body>\n</html>\n";

function kebab(key:string):string{
  return key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
}
function declarations(values:Record<string,string|number>):string{
  return Object.entries(values).map(([key,value])=>'  --nv-glass-'+key+': '+value+';').join('\n');
}
function rule(selector:string,values:Record<string,string|number>):string{
  return selector+' {\n'+declarations(values)+'\n}\n';
}
function colors(t:ColorTokens):Record<string,string>{
  const result:Record<string,string>={};
  for(const [key,value] of Object.entries(t))result[kebab(key)]=value;
  const hex=t.surfaceRaised;
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  result.tint='rgba('+rgb.join(',')+',var(--nv-glass-opacity,0.94))';
  return result;
}
function colorRule(selector:string,t:ColorTokens,theme:'light'|'dark'):string{
  return rule(selector,colors(t)).replace(' {\n',' {\n  color-scheme: '+theme+';\n');
}
function paletteSelector(id:string,theme?:string):string{
  return ':where([data-nivoo-glass][data-palette="'+id+'"]'+(theme?'[data-theme="'+theme+'"]':'')+')';
}
function densityValues(d:typeof VISUAL_DENSITIES[number]):Record<string,string>{
  const v:Record<string,string>={};
  for(const [key,value] of Object.entries(d.spacing))v['space-'+key]=value+'px';
  v['control-height']=d.controlMinHeight+'px';
  v['touch-height']=d.touchMinHeight+'px';
  v['row-height']=d.tableRowMinHeight+'px';
  return v;
}
/** Deterministic generation from the same source of truth as the token catalog. */
export function liquidGlassCss():string{
  const fallback=VISUAL_PALETTES.find(p=>p.id==='graphite')!;
  const density=VISUAL_DENSITIES.find(d=>d.id==='balanced')!;
  const foundation=STYLE_FOUNDATIONS.find(f=>f.styleId==='liquid-glass')!;
  const values:Record<string,string>={...densityValues(density)};
  for(const [key,value] of Object.entries(foundation.radius))values['radius-'+key]=value+'px';
  for(const [key,value] of Object.entries(foundation.shadow))values['shadow-'+key]=value;
  values['border-width']=foundation.borderWidth+'px';
  const light=VISUAL_PALETTES.map(p=>colorRule(paletteSelector(p.id),p.light,'light')).join('');
  const dark=colorRule(':where([data-nivoo-glass][data-theme="dark"])',fallback.dark,'dark')+
    VISUAL_PALETTES.map(p=>colorRule(paletteSelector(p.id,'dark'),p.dark,'dark')).join('');
  const systemDark=colorRule(':where([data-nivoo-glass][data-theme="system"])',fallback.dark,'dark')+
    VISUAL_PALETTES.map(p=>colorRule(paletteSelector(p.id,'system'),p.dark,'dark')).join('');
  const materials=GLASS_VARIANTS.map(v=>rule(':where([data-nivoo-glass][data-glass-variant="'+v.id+'"])',{'opacity':v.tintOpacity,'blur':v.blurPx+'px','highlight':v.highlight})).join('');
  const scales=VISUAL_DENSITIES.map(d=>rule(':where([data-nivoo-glass][data-density="'+d.id+'"])',densityValues(d))).join('');
  return colorRule(ROOT,fallback.light,'light')+rule(ROOT,values)+light+dark+
    '@media (prefers-color-scheme: dark) {\n'+systemDark+'}\n'+scales+materials+MATERIAL_CSS+'\n'+GLASS_MATERIAL_CSS;
}
export function liquidGlassTemplate(){
  return {id:'liquid-glass',version:LIQUID_GLASS_TEMPLATE_VERSION,files:[
    {name:'liquid-glass.css',content:liquidGlassCss()},
    {name:'README.md',content:GUIDE},
    {name:'example.html',content:EXAMPLE_HTML},
  ]};
}
/** Only selected Liquid Glass sessions receive these disposable reference files. */
export function liquidGlassTemplateContext(worktree?:string):string[]{
  if(!worktree)return [];
  for(const file of liquidGlassTemplate().files)writeSessionContextFile(worktree,'templates-nivoo/liquid-glass/'+file.name,file.content);
  return ['Template CSS v1 disponível em contexto/templates-nivoo/liquid-glass/README.md, liquid-glass.css e example.html. Leia somente se pertinente; adapte ao frontend real e ao perfil aprovado. CSS fosco, sem refração óptica; não copie automaticamente para o projeto.'];
}
