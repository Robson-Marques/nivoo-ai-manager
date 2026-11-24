'use strict';
// Teste de DESENVOLVIMENTO: não roda no nivoo update nem chama IA.
// Comprova no navegador que o overlay é visível mesmo sob CSS 3D hostil,
// e que imagens já escritas são efetivamente desenhadas.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {mountMediaOverlay,overlayScript}=require('../bin/motion-scene-core');
async function main() {
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:320,height:500}});
    await page.setContent('<!DOCTYPE html><html><head><style>'+
      'canvas{opacity:0!important;display:none!important;visibility:hidden!important;'+
      'transform:scale(.1)!important}body{margin:0;background:rgb(82,42,19)}'+
      '</style></head><body><div>WebGL mock</div></body></html>');
    await page.evaluate(mountMediaOverlay,{width:320,height:500});
    const asset='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8r8H1nwEPYMInOXwUAABFfQJA/gD2hgAAAABJRU5ErkJggg==';
    const scene={version:1,width:320,height:500,duration:25,
      layers:[{id:'pizza',type:'image',asset,x:160,y:250,width:160,height:160,
        keys:[{at:0,opacity:0},{at:13,opacity:1}]}]};
    await page.addScriptTag({content:overlayScript(scene,{[asset]:asset})});
    await page.evaluate(()=>window.__nivooOverlayLoadPromise);
    const report=await page.evaluate(()=>{
      window.__nivooOverlayRenderAt(16);
      const canvas=window.__nivooOverlayCanvas,host=document.getElementById('nivoo-photo-overlay-host');
      const p=canvas.getContext('2d').getImageData(160,250,1,1).data;
      const style=getComputedStyle(canvas);
      return {pixel:[...p],stats:window.__nivooOverlayStats,visible:style.display!=='none'&&style.opacity!=='0',
        host:document.elementFromPoint(160,250)===host};
    });
    assert.equal(report.stats.loaded,1,'imagem foi carregada');
    assert.equal(report.stats.drawnAtLastFrame,1,'foto foi desenhada aos 16s');
    assert.ok(report.pixel[0]>200&&report.pixel[3]>0,'pixel da fotografia deve aparecer');
    assert.ok(report.visible&&report.host,'canvas de fotos deve estar visível e na frente da cena');
    await page.close();
    console.log('PASS: foto RGBA desenhada e visível com CSS 3D que oculta canvas globais');
  } finally {await browser.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
