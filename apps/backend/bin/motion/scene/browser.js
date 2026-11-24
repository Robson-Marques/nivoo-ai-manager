'use strict';
const {validateScene}=require('./schema');const {sceneRuntime}=require('./runtime');
function safeJSON(x) { return JSON.stringify(x).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026'); }
/** HTML para o Chromium, sem rede, fontes remotas ou dependências de IA. */
function sceneDocument(scene, binaries) {
  validateScene(scene);
  const state=safeJSON({ scene,binaries });
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+
    'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080808}'+
    'canvas{display:block;width:100vw;height:100vh}</style></head><body>'+
    '<canvas id="nivoo" width="'+scene.width+'" height="'+scene.height+'"></canvas>'+
    '<script>('+sceneRuntime.toString()+')('+state+');</script></body></html>';
}
/**
 * Monta fotos de produtos em Shadow DOM, independente de CSS global do HTML
 * WebGL gerado pela IA. Executada dentro da página por Playwright page.evaluate.
 */
function mountMediaOverlay(size) {
  const old=document.getElementById('nivoo-photo-overlay-host');
  if(old)old.remove();
  const host=document.createElement('div');
  host.id='nivoo-photo-overlay-host';
  host.style.setProperty('all','initial','important');
  host.style.setProperty('position','fixed','important');
  host.style.setProperty('inset','0','important');
  host.style.setProperty('display','block','important');
  host.style.setProperty('opacity','1','important');
  host.style.setProperty('visibility','visible','important');
  host.style.setProperty('z-index','2147483647','important');
  host.style.setProperty('pointer-events','none','important');
  const shadow=host.attachShadow({mode:'open'});
  const canvas=document.createElement('canvas');
  canvas.width=size.width;canvas.height=size.height;
  canvas.style.cssText='all:initial!important;display:block!important;'+
    'position:absolute!important;inset:0!important;width:100%!important;'+
    'height:100%!important;opacity:1!important;visibility:visible!important;'+
    'pointer-events:none!important;';
  shadow.appendChild(canvas);
  document.documentElement.appendChild(host);
  window.__nivooOverlayCanvas=canvas;
}

function overlayScript(scene,binaries) {
  validateScene(scene);
  return '('+sceneRuntime.toString()+')('+safeJSON({scene,binaries,overlay:true})+');';
}

module.exports={sceneDocument,overlayScript,mountMediaOverlay};
