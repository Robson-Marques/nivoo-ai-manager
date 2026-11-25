import { writeSessionContextFile } from '../common/session-context-file';

export const LIQUID_GLASS_COMPONENTS_VERSION=1;
const COMPONENTS=[
  {
    "id": "buttons",
    "name": "Botões e ações",
    "description": "Primário, secundário e desabilitado; preserve handlers reais.",
    "classes": [
      "nv-glass-control",
      "nv-glass-button",
      "nv-glass-primary"
    ],
    "markup": "<div class=\"nv-glass-actions\"><button type=\"submit\" class=\"nv-glass-control nv-glass-button nv-glass-primary\">Salvar</button><button type=\"button\" class=\"nv-glass-control nv-glass-button\" disabled>Indisponível</button></div>"
  },
  {
    "id": "navigation",
    "name": "Navegação e menu",
    "description": "Navegação semântica e disclosure nativo details/summary; use rotas existentes.",
    "classes": [
      "nv-glass-material",
      "nv-glass-nav",
      "nv-glass-menu",
      "nv-glass-menu-list"
    ],
    "markup": "<nav class=\"nv-glass-material nv-glass-nav\" aria-label=\"Navegação principal\"><a href=\"#conteudo\">Conteúdo</a><details class=\"nv-glass-menu\"><summary class=\"nv-glass-control\">Opções</summary><ul class=\"nv-glass-menu-list\"><li><a href=\"#clientes\">Clientes</a></li></ul></details></nav>"
  },
  {
    "id": "dialog",
    "name": "Modal",
    "description": "Dialog nativo, showModal(), fechamento por Escape e botão; preserve foco e estados.",
    "classes": [
      "nv-glass-dialog",
      "nv-glass-actions"
    ],
    "markup": "<dialog class=\"nv-glass-dialog\" aria-labelledby=\"dialog-title\"><h2 id=\"dialog-title\">Detalhes</h2><p>Conteúdo do modal.</p><form method=\"dialog\"><button class=\"nv-glass-control nv-glass-button\">Fechar</button></form></dialog>"
  },
  {
    "id": "form",
    "name": "Formulário",
    "description": "Campos rotulados, validação nativa, feedback de operação real.",
    "classes": [
      "nv-glass-form",
      "nv-glass-field",
      "nv-glass-control"
    ],
    "markup": "<form class=\"nv-glass-form\"><div class=\"nv-glass-field\"><label for=\"nome\">Nome</label><input id=\"nome\" name=\"nome\" class=\"nv-glass-control\" required maxlength=\"100\"></div><button type=\"submit\" class=\"nv-glass-control nv-glass-button nv-glass-primary\">Salvar</button></form>"
  },
  {
    "id": "table",
    "name": "Tabela e filtro",
    "description": "Dados opacos, cabeçalhos semânticos, rolagem local; filtros e paginação ligados ao estado real.",
    "classes": [
      "nv-glass-table-wrap",
      "nv-glass-table",
      "nv-glass-control"
    ],
    "markup": "<div class=\"nv-glass-table-wrap\" role=\"region\" aria-label=\"Clientes\" tabindex=\"0\"><table class=\"nv-glass-table\"><caption>Clientes</caption><thead><tr><th scope=\"col\">Nome</th><th scope=\"col\">Estado</th></tr></thead><tbody><!-- dados reais --></tbody></table></div>"
  },
  {
    "id": "panels",
    "name": "Painéis e indicadores",
    "description": "Grade adaptativa, superfícies opacas de conteúdo e estados textuais.",
    "classes": [
      "nv-glass-panels",
      "nv-glass-content",
      "nv-glass-status"
    ],
    "markup": "<div class=\"nv-glass-panels\"><section class=\"nv-glass-content\"><h2 class=\"nv-glass-heading\">Resumo</h2><p class=\"nv-glass-muted\">Dados da aplicação</p></section></div>"
  }
];
const CSS="/* Nivoo Liquid Glass components v1. Requires liquid-glass.css. */\n:where([data-nivoo-glass]) :where(.nv-glass-actions,.nv-glass-nav,.nv-glass-toolbar) {\n  display:flex; flex-wrap:wrap; align-items:center; gap:var(--nv-glass-space-sm);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-nav) { justify-content:space-between; }\n:where([data-nivoo-glass]) :where(.nv-glass-button,.nv-glass-menu summary) {\n  display:inline-flex; align-items:center; justify-content:center;\n  gap:var(--nv-glass-space-xs); text-decoration:none; cursor:pointer;\n  min-width:var(--nv-glass-control-height);\n  transition:box-shadow 160ms ease, transform 100ms ease;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-button:disabled) { cursor:not-allowed; }\n:where([data-nivoo-glass]) :where(.nv-glass-button:not(:disabled)):active { transform:translateY(1px); }\n@media (hover:hover) and (pointer:fine) {\n  :where([data-nivoo-glass]) :where(.nv-glass-button:not(:disabled)):hover {\n    box-shadow:0 2px 8px rgba(0,0,0,.14);\n  }\n}\n:where([data-nivoo-glass]) :where(.nv-glass-menu) { position:relative; min-width:0; }\n:where([data-nivoo-glass]) :where(.nv-glass-menu summary) { list-style:none; }\n:where([data-nivoo-glass]) :where(.nv-glass-menu summary)::-webkit-details-marker { display:none; }\n:where([data-nivoo-glass]) :where(.nv-glass-menu-list) {\n  display:grid; gap:var(--nv-glass-space-xs); padding:var(--nv-glass-space-sm);\n  margin:var(--nv-glass-space-xs) 0 0; list-style:none;\n  background:var(--nv-glass-surface); border:1px solid var(--nv-glass-border);\n  border-radius:var(--nv-glass-radius-control);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-menu-list a) {\n  display:flex; align-items:center; min-height:var(--nv-glass-control-height);\n  padding:0 var(--nv-glass-space-sm); color:var(--nv-glass-text);\n  text-decoration:underline; overflow-wrap:anywhere;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-field) {\n  display:grid; gap:var(--nv-glass-space-xs); min-width:0;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-field label) { font-weight:600; }\n:where([data-nivoo-glass]) :where(.nv-glass-field input,.nv-glass-field select,.nv-glass-field textarea) { width:100%; }\n:where([data-nivoo-glass]) :where(.nv-glass-field [aria-invalid=\"true\"]) { border-color:var(--nv-glass-danger); }\n:where([data-nivoo-glass]) :where(.nv-glass-form,.nv-glass-panels) {\n  display:grid; gap:var(--nv-glass-space-md); min-width:0;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-panels) {\n  grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));\n}\n:where([data-nivoo-glass]) :where(.nv-glass-table-wrap) {\n  max-width:100%; overflow:auto; background:var(--nv-glass-surface);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-table) {\n  width:100%; border-collapse:collapse; text-align:start; font-variant-numeric:tabular-nums;\n  background:var(--nv-glass-surface); color:var(--nv-glass-text);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-table th,.nv-glass-table td) {\n  padding:var(--nv-glass-space-sm) var(--nv-glass-space-md);\n  height:var(--nv-glass-row-height); box-sizing:border-box;\n  border-bottom:1px solid var(--nv-glass-border); text-align:start; overflow-wrap:anywhere;\n}\n:where([data-nivoo-glass]) :where(.nv-glass-table thead) { background:var(--nv-glass-surface-raised); }\n:where([data-nivoo-glass]) :where(.nv-glass-dialog) {\n  box-sizing:border-box; width:min(32rem,calc(100% - 2rem)); max-height:calc(100% - 2rem);\n  overflow:auto; padding:var(--nv-glass-space-lg); color:var(--nv-glass-text);\n  background:var(--nv-glass-surface); border:1px solid var(--nv-glass-control-border);\n  border-radius:var(--nv-glass-radius-overlay); box-shadow:var(--nv-glass-shadow-overlay);\n}\n:where([data-nivoo-glass]) :where(.nv-glass-dialog)::backdrop { background:rgba(0,0,0,.48); }\n:where([data-nivoo-glass]) :where(.nv-glass-status) { font-weight:600; }\n:where([data-nivoo-glass]) :where(.nv-glass-menu-list a,.nv-glass-table-wrap):focus-visible {\n  outline:2px solid var(--nv-glass-focus); outline-offset:2px;\n}\n@media (pointer:coarse) {\n  :where([data-nivoo-glass]) :where(.nv-glass-button,.nv-glass-menu summary,.nv-glass-menu-list a) {\n    min-height:var(--nv-glass-touch-height); min-width:var(--nv-glass-touch-height);\n  }\n}\n@media (prefers-reduced-motion:reduce) {\n  :where([data-nivoo-glass]) :where(.nv-glass-button,.nv-glass-menu summary) { transition:none; animation:none; }\n  :where([data-nivoo-glass]) :where(.nv-glass-button:not(:disabled)):active { transform:none; }\n}\n@media (forced-colors:active) {\n  :where([data-nivoo-glass]) :where(.nv-glass-menu-list,.nv-glass-table-wrap,.nv-glass-table,.nv-glass-table thead,.nv-glass-dialog) {\n    background:Canvas; color:CanvasText; border-color:CanvasText; box-shadow:none;\n  }\n  :where([data-nivoo-glass]) :where(.nv-glass-table th,.nv-glass-table td) { border-color:CanvasText; }\n  :where([data-nivoo-glass]) :where(.nv-glass-menu-list a) { color:LinkText; }\n}\n";
const HTML="<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Nivoo — componentes Liquid Glass</title><link rel=\"stylesheet\" href=\"liquid-glass.css\"><link rel=\"stylesheet\" href=\"components.css\"><script src=\"components-demo.js\" defer></script></head>\n<body style=\"margin:0\"><main data-nivoo-glass data-palette=\"ocean-blue\" data-theme=\"system\" data-density=\"balanced\" style=\"min-height:100vh;background-image:radial-gradient(ellipse at 12% 5%,var(--nv-glass-accent),transparent 36%)\">\n<div class=\"nv-glass-shell\">\n<nav class=\"nv-glass-material nv-glass-nav\" aria-label=\"Navegação da demonstração\"><strong>Nivoo · biblioteca de componentes</strong><details class=\"nv-glass-menu\"><summary class=\"nv-glass-control\">Navegação</summary><ul class=\"nv-glass-menu-list\"><li><a href=\"#resumo\">Resumo</a></li><li><a href=\"#clientes\">Clientes</a></li></ul></details><button type=\"button\" id=\"demo-transparency\" class=\"nv-glass-control nv-glass-button\" aria-pressed=\"false\">Desligar transparência</button></nav>\n<section id=\"resumo\" class=\"nv-glass-panels\" aria-label=\"Indicadores\"><section class=\"nv-glass-content\"><h2 class=\"nv-glass-heading\">Clientes da demonstração</h2><p id=\"demo-total\" class=\"nv-glass-status\">2</p></section><section class=\"nv-glass-content\"><h2 class=\"nv-glass-heading\">Ambiente local</h2><p class=\"nv-glass-status-success\">Dados fictícios · sem persistência</p></section></section>\n<section id=\"clientes\" class=\"nv-glass-content\"><h1 class=\"nv-glass-heading\">Clientes</h1><p class=\"nv-glass-muted\">Amostra interativa. Nenhuma operação é enviada ao servidor; os dados são perdidos ao recarregar.</p><div class=\"nv-glass-toolbar\"><div class=\"nv-glass-field\"><label for=\"demo-filter\">Filtrar por nome</label><input id=\"demo-filter\" type=\"search\" class=\"nv-glass-control\"></div><button type=\"button\" id=\"demo-open\" class=\"nv-glass-control nv-glass-button nv-glass-primary\">Novo cliente</button></div>\n<p id=\"demo-status\" role=\"status\" aria-live=\"polite\"></p>\n<div class=\"nv-glass-table-wrap\" role=\"region\" aria-label=\"Tabela de clientes\" tabindex=\"0\"><table class=\"nv-glass-table\"><caption>Clientes fictícios</caption><thead><tr><th scope=\"col\">Nome</th><th scope=\"col\">Estado</th></tr></thead><tbody id=\"demo-rows\"><tr><td>Cliente exemplo A</td><td>Ativo</td></tr><tr><td>Cliente exemplo B</td><td>Ativo</td></tr></tbody></table></div><p id=\"demo-empty\" hidden>Nenhum cliente encontrado.</p></section>\n<dialog id=\"demo-dialog\" class=\"nv-glass-dialog\" aria-labelledby=\"demo-title\"><h2 id=\"demo-title\" class=\"nv-glass-heading\">Novo cliente fictício</h2><form id=\"demo-form\" class=\"nv-glass-form\"><div class=\"nv-glass-field\"><label for=\"demo-name\">Nome</label><input id=\"demo-name\" name=\"name\" class=\"nv-glass-control\" required maxlength=\"100\" autofocus></div><div class=\"nv-glass-actions\"><button type=\"submit\" class=\"nv-glass-control nv-glass-button nv-glass-primary\">Adicionar</button><button type=\"button\" id=\"demo-cancel\" class=\"nv-glass-control nv-glass-button\">Cancelar</button></div></form></dialog>\n</div></main></body></html>\n";
const DEMO="/* Demonstration only. No API, storage, secrets, external scripts or user HTML. */\n(() => {\n  'use strict';\n  const root = document.querySelector('[data-nivoo-glass]');\n  if (!root) return;\n  const byId = id => root.querySelector('#' + id);\n  const dialog = byId('demo-dialog'), form = byId('demo-form'), name = byId('demo-name');\n  const open = byId('demo-open'), cancel = byId('demo-cancel'), filter = byId('demo-filter');\n  const rows = byId('demo-rows'), total = byId('demo-total'), empty = byId('demo-empty');\n  const status = byId('demo-status'), transparency = byId('demo-transparency');\n  function applyFilter() {\n    const query = filter.value.trim().toLocaleLowerCase('pt-BR');\n    const items = Array.from(rows.rows);\n    let visible = 0;\n    for (const row of items) {\n      row.hidden = !row.cells[0].textContent.toLocaleLowerCase('pt-BR').includes(query);\n      if (!row.hidden) visible++;\n    }\n    total.textContent = String(items.length);\n    empty.hidden = visible !== 0;\n  }\n  filter.addEventListener('input', applyFilter);\n  transparency.addEventListener('click', () => {\n    const opaque = root.dataset.transparency !== 'opaque';\n    if (opaque) root.dataset.transparency = 'opaque'; else delete root.dataset.transparency;\n    transparency.setAttribute('aria-pressed', String(opaque));\n    transparency.textContent = opaque ? 'Ligar transparência' : 'Desligar transparência';\n  });\n  if (typeof dialog.showModal !== 'function') {\n    open.disabled = true;\n    status.textContent = 'Modal nativo indisponível neste navegador.';\n    return;\n  }\n  open.addEventListener('click', () => { if (!dialog.open) { form.reset(); dialog.showModal(); name.focus(); } });\n  cancel.addEventListener('click', () => dialog.close());\n  dialog.addEventListener('close', () => open.focus());\n  name.addEventListener('input', () => name.setCustomValidity(''));\n  form.addEventListener('submit', event => {\n    event.preventDefault();\n    if (!dialog.open) return;\n    const value = name.value.trim();\n    if (!value) { name.setCustomValidity('Informe um nome.'); name.reportValidity(); return; }\n    name.setCustomValidity('');\n    if (!form.reportValidity()) return;\n    const row = rows.insertRow();\n    row.insertCell().textContent = value;\n    row.insertCell().textContent = 'Ativo';\n    filter.value = '';\n    applyFilter();\n    dialog.close();\n    status.textContent = 'Cliente fictício adicionado à demonstração.';\n  });\n  applyFilter();\n})();\n";
const GUIDE="# Componentes Liquid Glass — biblioteca local v1\n\nRequer liquid-glass.css do template v1. Copie/adapte components.css após o\nCSS base; use os exemplos de components.json como ponto de partida, não\ncomo componentes de framework prontos. Preserve design system, rotas,\nestado, permissões, handlers, dados e validação do projeto.\n\n- Botões: elementos button reais, tipos explícitos, disabled real.\n- Navegação: nav, links para rotas reais e details/summary para disclosure\n  simples (não simula role=menu com navegação de teclado incompleta).\n- Modal: dialog nativo, showModal, close, Escape e retorno de foco. Em\n  aplicações com portais ou biblioteca de modal existente, reutilize-a\n  e garanta tokens no portal. Não deixe o dialog visível quando fechado.\n- Formulários: label associado, required quando necessário, mensagens de\n  erro e estado; validação e persistência reais permanecem no projeto.\n- Tabelas: caption, th scope, região de rolagem local rotulada e focável;\n  use filtros, ordenação e paginação reais se necessários.\n- Painéis: grade responsiva e dados em superfícies opacas. Estado por texto\n  e cor; não invente números ou resultados.\n- A amostra components.html + components-demo.js usa dados fictícios em\n  memória, com filtro, modal, cadastro e alternância de transparência.\n  Não copie o script de demonstração como lógica de produção.\n- Não há dependência de React, CDN, ativos externos, geração de imagem ou\n  refração óptica. Os efeitos respeitam o CSS base e preferências de\n  movimento. Acessibilidade, comportamento e contraste composto precisam\n  de teste em navegador real.\n";

/** Original framework-neutral snippets; no automatic execution or project mutation. */
export function liquidGlassComponents(){
  return {id:'liquid-glass-components',version:LIQUID_GLASS_COMPONENTS_VERSION,requires:{id:'liquid-glass',version:1},components:COMPONENTS.map(({markup,...meta})=>meta),files:[
    {name:'components.css',content:CSS},
    {name:'components.json',content:JSON.stringify(COMPONENTS,null,2)+'\n'},
    {name:'components.html',content:HTML},
    {name:'components-demo.js',content:DEMO},
    {name:'components.md',content:GUIDE},
  ]};
}
export function liquidGlassComponentsContext(worktree?:string):string[]{
  if(!worktree)return [];
  for(const file of liquidGlassComponents().files)writeSessionContextFile(worktree,'templates-nivoo/liquid-glass/'+file.name,file.content);
  return ['Biblioteca Liquid Glass v1: contexto/templates-nivoo/liquid-glass/components.md e components.json (seis padrões), components.css (após o CSS base), components.html e components-demo.js (amostra local). Leia somente os componentes necessários; adapte ao estado e às ações reais, sem copiar dados ou lógica de demonstração.'];
}
