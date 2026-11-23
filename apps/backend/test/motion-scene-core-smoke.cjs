'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { validateScene,loadScene,sceneDocument,sceneRuntime } = require('../bin/motion-scene-core');

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
  assert.throws(()=>validateScene({...scene,layers:[scene.layers[0],scene.layers[0]]}),/duplicado/);
  assert.throws(()=>validateScene({...scene,layers:[{...scene.layers[0],asset:'../secreto.png'}]}),/asset local inválido/);
  assert.throws(()=>validateScene({...scene,pacing:{openingEnd:30}}),/openingEnd/);
  assert.throws(()=>validateScene({...scene,layers:[{...scene.layers[0],keys:[{at:10},{at:1}]}]}),/ordenados/);

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-motion-core-'));
  try {
    fs.mkdirSync(path.join(root,'assets'),{recursive:true});
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(scene));
    fs.writeFileSync(path.join(root,'assets','pizza.png'),Buffer.from([137,80,78,71,13,10,26,10]));
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
      beginPath(){},ellipse(){},roundRect(){},rect(){},fill(){},stroke(){},strokeText(){},fillText(){},
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
    assert.ok(Math.abs(win.__motionCore.timeline(3.5)-7.15)<1e-8);
    assert.ok(Math.abs(win.__motionCore.timeline(20)-25)<1e-8);
    draws.length=0;
    win.__renderAt(15);
    assert.equal(draws.length,1,'uma imagem real RGBA por cena, nunca 3 clones escuros');
    assert.ok(raf.length>0);
    assert.equal(win.__motionFim,false);
    win.__renderAt(20);
    assert.equal(win.__motionFim,true);

    const escape=path.join(root,'outside.png');
    fs.writeFileSync(escape,Buffer.from('outside'));
    fs.symlinkSync(escape,path.join(root,'assets','external.png'));
    const bad=JSON.parse(JSON.stringify(scene));
    bad.layers[0].asset='assets/external.png';
    fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(bad));
    assert.throws(()=>loadScene(path.join(root,'scene.json')),/fora da pasta/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
  console.log('PASS motion-core: manifest, imagem sem clonagem, z seguro, pacing, keyframes, assets confinados, sintaxe navegador');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
