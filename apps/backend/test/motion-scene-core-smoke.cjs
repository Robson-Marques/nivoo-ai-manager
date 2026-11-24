'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { validateScene,loadScene,productPhotoLayers,sceneDocument,overlayScript,sceneRuntime } = require('../bin/motion-scene-core');

async function main() {
  const scene = {
    version:1,width:1080,height:1920,duration:20,
    background:'#090402',profile:'energetic',
    pacing:{sourceDuration:25,openingEnd:7.15,openingSeconds:3.5},
    layers:[
      {id:'pizza',type:'image',asset:'assets/pizza.png',x:540,y:1100,width:600,height:600,
        z:9,supportZ:12,keys:[{at:13,x:-400,opacity:0},{at:15,x:540,opacity:1}]},
      {id:'tabua',type:'shape',shape:'ellipse',x:540,y:1240,width:700,height:230,z:12,fill:'#65350a'},
      {id:'titulo',type:'text',text:'BLACK',x:540,y:300,width:800,height:150,z:50,
        fontSize:114,keys:[{at:2,opacity:0,scale:.7},{at:4,opacity:1,scale:1}]},
      {id:'neon',type:'neon',points:[[10,10],[100,150],[500,150]],x:0,y:0,z:80,start:1.1,end:7.15,color:'#ffaf19'},
    ]
  };
  validateScene(scene);
  // Regressão do trabalho "Novidade no cardápio": uma IA produziu
  // scene.json com profile fora da enum e o render caiu 3x sem criar MP4.
  const anuncio = {
    version:1,width:1080,height:1920,duration:12,profile:'cinematic',
    layers:[
      {id:'fundo',type:'image',asset:'assets/fundo.png',x:540,y:960,width:1080,height:1920},
      {id:'logo',type:'image',asset:'assets/logo.png',x:540,y:390,width:500,height:260},
      {id:'chamada',type:'text',text:'Em breve, novidade no cardápio!',
        x:540,y:940,width:950,height:125},
    ],
  };
  // Incidente seguinte no MESMO job: fundo.width faltante, ou percentagem
  // escrita pela IA -> motor antigo falhava sem desenhar 1 quadro.
  const variantes=[
    {id:'fundo',type:'image',asset:'assets/fundo.png',width:'100%',height:'100%'},
    {id:'logo',type:'image',asset:'assets/logo.png',w:'420px',h:'180px'},
    {id:'chamada',type:'text',text:'Em breve no cardápio',width:'.85',height:null},
  ];
  // A camada de texto não deve exigir width/height que o próprio motor
  // consegue calcular; o fundo sempre ocupa o canvas todo.
  const formas=validateScene({...anuncio,layers:JSON.parse(JSON.stringify(variantes))}).scene.layers;
  assert.equal(formas[0].width,1080);assert.equal(formas[0].height,1920);
  assert.equal(formas[1].width,420);assert.equal(formas[1].height,180);
  assert.equal(formas[2].width,918,'0.85 em string é proporção do canvas, não pixel');
  assert.ok(formas[2].height>0);
  const semTamanho=validateScene({...anuncio,layers:[
    {id:'fundo',type:'image',asset:'assets/fundo.png'},
    {id:'logo',type:'image',asset:'assets/logo.png'},
    {id:'chamada',type:'text',text:'Em breve no cardápio'}
  ]}).scene.layers;
  assert.deepEqual([semTamanho[0].width,semTamanho[0].height],[1080,1920]);
  assert.ok(semTamanho[1].width>1&&semTamanho[1].height>1);
  assert.equal(semTamanho[1].__autoHeight,true,
    'logos sem tamanho preservam sua proporção natural no Chromium');
  const duplicada=validateScene(JSON.parse(JSON.stringify({version:1,width:1080,height:1920,duration:12,layers:[
    {id:'fundo',type:'image',asset:'assets/fundo.png',width:'auto',height:0}
  ]}))).scene.layers[0];
  assert.deepEqual([duplicada.width,duplicada.height],[1080,1920]);
  const aceite=validateScene(JSON.parse(JSON.stringify(anuncio)));
  assert.equal(aceite.scene.profile,'normal','perfil artístico não impede o render');
  assert.equal(aceite.scene.duration,12,'duração original preservada');
  assert.equal(aceite.scene.layers.length,3,'camadas intactas');
  assert.equal(validateScene({...anuncio,profile:'dinâmico',layers:anuncio.layers.map(l=>({...l}))}).scene.profile,'energetic');
  assert.equal(validateScene({...anuncio,profile:'calmo',layers:anuncio.layers.map(l=>({...l}))}).scene.profile,'calm');
  assert.equal(validateScene({...anuncio,profile:{style:'promo'},layers:anuncio.layers.map(l=>({...l}))}).scene.profile,'normal');
  assert.deepEqual(productPhotoLayers(scene).map(x=>x.id),['pizza'],
    'foto do produto é componente necessário do vídeo');
  assert.equal(productPhotoLayers({...scene,layers:[
    {id:'logo',type:'image',asset:'assets/logo.png'},
    {id:'pizza',type:'image',asset:'assets/pizza.png'},
  ]}).length,1,'logo opcional não deve bloquear o vídeo inteiro');
  assert.throws(()=>validateScene({...scene,layers:[scene.layers[0],scene.layers[0]]}),/duplicado/);
  // O motor aceita UMA subida para reutilizar assets de uma pasta irmã em motion/.
  // Esse suporte foi integrado depois do teste antigo, que rejeitava qualquer ../.
  assert.doesNotThrow(()=>validateScene({...scene,layers:[{...scene.layers[0],asset:'../antigo/assets/pizza.js'}]}));
  // A sintaxe de um logo nunca reprova a composição. O carregador protege
  // os diretórios reais e emite aviso quando um arquivo não está disponível.
  assert.doesNotThrow(()=>validateScene({...scene,layers:[{...scene.layers[0],asset:'../../secreto.png'}]}));
  assert.doesNotThrow(()=>validateScene({...scene,layers:[{...scene.layers[0],asset:'/etc/senha.png'}]}));
  assert.throws(()=>validateScene({...scene,pacing:{openingEnd:30}}),/openingEnd/);
  assert.throws(()=>validateScene({...scene,layers:[{...scene.layers[0],keys:[{at:10},{at:1}]}]}),/ordenados/);

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-motion-core-'));
  const escape=path.join(os.tmpdir(),path.basename(root)+'-externo.png');
  try {
    fs.mkdirSync(path.join(root,'assets'),{recursive:true});
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(scene));
    fs.writeFileSync(path.join(root,'assets','pizza.png'),Buffer.from([137,80,78,71,13,10,26,10]));
    fs.writeFileSync(path.join(root,'assets','fundo.png'),Buffer.from([137,80,78,71,13,10,26,10]));
    fs.writeFileSync(path.join(root,'assets','logo.png'),Buffer.from([137,80,78,71,13,10,26,10]));
    const anuncioPath=path.join(root,'anuncio.json');
    const originalAnuncio=JSON.stringify(anuncio);
    fs.writeFileSync(anuncioPath,originalAnuncio);
    const carregado=loadScene(anuncioPath);
    assert.equal(carregado.scene.profile,'normal');
    assert.equal(carregado.scene.duration,12);
    assert.equal(Object.keys(carregado.binaries).length,2,'fundo e logo originais carregados');
    assert.match(carregado.warnings.join(' '),/Perfil de ritmo.*normal/);
    assert.equal(fs.readFileSync(anuncioPath,'utf8'),originalAnuncio,
      'normalização só em memória; cena pronta nunca reescrita');
    const scriptAnuncio=sceneDocument(carregado.scene,carregado.binaries)
      .match(/<script>([\s\S]+)<\/script>/)?.[1];
    assert.ok(scriptAnuncio,'HTML do anúncio deve conter o renderizador de cena');
    assert.doesNotThrow(()=>new vm.Script(scriptAnuncio));
    const missingScene={...anuncio,layers:[
      {id:'fundo',type:'image',asset:'assets/fundo.png'},
      {id:'logo',type:'image',asset:'assets/logo.png'},
      {id:'chamada',type:'text',text:'Em breve no cardápio'}
    ]};
    fs.writeFileSync(anuncioPath,JSON.stringify(missingScene));
    const fromDisk=loadScene(anuncioPath);
    assert.deepEqual([fromDisk.scene.layers[0].width,fromDisk.scene.layers[0].height],[1080,1920]);
    assert.equal(fromDisk.scene.layers[1].__autoHeight,true);
    assert.doesNotThrow(()=>new vm.Script(sceneDocument(fromDisk.scene,fromDisk.binaries)
      .match(/<script>([\s\S]+)<\/script>/)?.[1]));
    const saved=loadScene(path.join(root,'scene.json'));
    assert.equal(saved.scene.duration,20);
    assert.match(saved.binaries['assets/pizza.png'],/^data:image\/png;base64,/);
    const html=sceneDocument(scene,saved.binaries);
    assert.match(html,/window.__motionFim/);
    assert.doesNotMatch(sceneDocument({...scene,layers:scene.layers.map(l=>l.type==='text'?{...l,text:'<\/script><script>alert(1)<\/script>'}:l)},saved.binaries),/<\/script><script>alert/);
    const script=html.match(/<script>([\s\S]+)<\/script>/)?.[1];
    assert.ok(script,'script principal da cena ausente');
    new vm.Script(script);

    const draws=[], raf=[];
    const ctx={
      save(){},restore(){},translate(){},rotate(){},scale(){},fillRect(){},
      beginPath(){},ellipse(){},roundRect(){},rect(){},fill(){},stroke(){},strokeText(){},fillText(){},clearRect(){},
      moveTo(){},lineTo(){},drawImage(img){ draws.push(img.src); },
      set fillStyle(v){},set globalAlpha(v){},set shadowColor(v){},set shadowBlur(v){},
      set shadowOffsetX(v){},set shadowOffsetY(v){},set strokeStyle(v){},set lineWidth(v){},
      set lineCap(v){},set lineJoin(v){},set font(v){},set textAlign(v){},set textBaseline(v){},
    };
    const win={};
    class MockImage {
      complete=true;naturalWidth=100;
      set src(v){this._src=v;queueMicrotask(()=>this.onload?.());}
      get src(){return this._src;}
    }
    vm.runInNewContext(script,{window:win,document:{getElementById:()=>({width:1080,height:1920,getContext:()=>ctx})},
      Image:MockImage,requestAnimationFrame:cb=>{raf.push(cb);},performance:{now:()=>0},
      Promise,Math,console,queueMicrotask});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(win.__nivooSceneReady,true);
    assert.ok(win.__nivooSceneLoadedKeys.includes('assets/pizza.png'));
    assert.ok(Math.abs(win.__motionCore.timeline(3.5)-7.15)<1e-8);
    assert.ok(Math.abs(win.__motionCore.timeline(20)-25)<1e-8);
    draws.length=0;
    win.__renderAt(15);
    assert.equal(draws.length,1,'uma imagem real RGBA por cena, nunca 3 clones escuros');
    assert.ok(raf.length>0);
    assert.equal(win.__motionFim,false);
    win.__renderAt(20);
    assert.equal(win.__motionFim,true);

    // O compositor híbrido não modifica relógio nem status da cena WebGL base.
    const overlayWin={__motionSegundos:25,__motionFim:false};
    const overlay=overlayScript(scene,saved.binaries);
    new vm.Script(overlay);
    const before=draws.length;
    vm.runInNewContext(overlay,{
      window:overlayWin,document:{getElementById:()=>({width:1080,height:1920,getContext:()=>ctx})},
      Image:MockImage,requestAnimationFrame:cb=>raf.push(cb),performance:{now:()=>0},
      Promise,Math,console,queueMicrotask,
    });
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(overlayWin.__nivooOverlayReady,true);
    assert.equal(raf.length,1,
      'overlay não pode agendar seu próprio requestAnimationFrame: conflitaria com o relógio do vídeo');
    assert.ok(overlayWin.__nivooOverlayStats.loadedAssetKeys.includes('assets/pizza.png'));
    assert.equal(overlayWin.__motionSegundos,25);
    overlayWin.__nivooOverlayRenderAt(15);
    assert.equal(draws.length-before,1);
    assert.equal(overlayWin.__nivooOverlayStats.drawnAtLastFrame,1);
    assert.deepEqual([...overlayWin.__nivooOverlayStats.everDrawnIds],['pizza']);
    assert.equal(overlayWin.__motionFim,false);

    // Compatibilidade com assets base64 que o Studio guardava em módulos
    // JS numa pasta irmã da composição, sem executar esse JavaScript.
    const sceneDir=path.join(root,'motion','novo');
    const legacy=path.join(root,'motion','antigo','assets');
    fs.mkdirSync(sceneDir,{recursive:true});
    fs.mkdirSync(legacy,{recursive:true});
    fs.writeFileSync(path.join(legacy,'pizza.js'),
      "window.assets={pizza:'data:image/png;base64,iVBORw0KGgo='};");
    const legacyScene=JSON.parse(JSON.stringify(scene));
    legacyScene.layers[0].asset='../antigo/assets/pizza.js';
    fs.writeFileSync(path.join(sceneDir,'scene.json'),JSON.stringify(legacyScene));
    const fromLegacy=loadScene(path.join(sceneDir,'scene.json'));
    assert.equal(fromLegacy.binaries['../antigo/assets/pizza.js'],
      'data:image/png;base64,iVBORw0KGgo=');

    // Correção de regressão: fotos da pizza sumiam da v4 quando a IA usava
    // campo "src" ou diferença de capitalização no caminho dos PNGs.
    const assetsNovo=path.join(sceneDir,'assets');
    fs.mkdirSync(assetsNovo,{recursive:true});
    fs.writeFileSync(path.join(assetsNovo,'pizza-peru.png'),
      Buffer.from([137,80,78,71,13,10,26,10]));
    const recover=JSON.parse(JSON.stringify(scene));
    delete recover.layers[0].asset;
    recover.layers[0].src='assets/PIZZA-PERU.png';
    fs.writeFileSync(path.join(sceneDir,'scene.json'),JSON.stringify(recover));
    const found=loadScene(path.join(sceneDir,'scene.json'));
    assert.equal(found.scene.layers[0].asset,'assets/PIZZA-PERU.png');
    assert.match(found.binaries['assets/PIZZA-PERU.png'],/^data:image\/png;base64,/);
    assert.equal(found.warnings.length,0);

    fs.writeFileSync(escape,Buffer.from('outside'));
    fs.symlinkSync(escape,path.join(root,'assets','external.png'));
    const bad=JSON.parse(JSON.stringify(scene));
    bad.layers[0].asset='assets/external.png';
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(bad));
    const impedida=loadScene(path.join(root,'scene.json'));
    assert.equal(impedida.binaries['assets/external.png'],undefined);
    assert.ok(impedida.warnings.some(w=>/fora das pastas permitidas/.test(w)),
      'symlink para fora é recusado sem reprovar o vídeo inteiro');
    // Uma referência de logo incompatível deve gerar AVISO, jamais bloquear.
    const logoBad=JSON.parse(JSON.stringify(scene));
    logoBad.layers.push({id:'logo',type:'image',asset:'assets/logo inexistente.svg',
      x:540,y:80,width:300,height:120});
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(logoBad));
    const tolerante=loadScene(path.join(root,'scene.json'));
    assert.equal(tolerante.binaries['assets/logo inexistente.svg'],undefined);
    assert.ok(tolerante.warnings.some(w=>/logo inexistente/.test(w)));
    assert.ok(tolerante.binaries['assets/pizza.png'],'pizza original não foi afetada');
    // Logo em pasta com espaços e extensão SVG é recurso legítimo.
    fs.writeFileSync(path.join(root,'assets','logo oficial.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    logoBad.layers[4].asset='assets/logo oficial.svg';
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(logoBad));
    const legivel=loadScene(path.join(root,'scene.json'));
    assert.match(legivel.binaries['assets/logo oficial.svg'],/^data:image\/svg\+xml;base64,/);
    // Data URL não acessa rede e dispensa arquivo extra.
    logoBad.layers[4].asset='data:image/png;base64,iVBORw0KGgo=';
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(logoBad));
    const incorporada=loadScene(path.join(root,'scene.json'));
    assert.equal(incorporada.binaries[logoBad.layers[4].asset],logoBad.layers[4].asset);
  } finally { fs.rmSync(root,{recursive:true,force:true});fs.rmSync(escape,{force:true}); }
  console.log('PASS motion-core: manifest, imagem sem clonagem, z seguro, pacing, keyframes, assets confinados, sintaxe navegador');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
