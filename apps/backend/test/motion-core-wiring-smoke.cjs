'use strict';
// Executado no "nivoo update" após tsc e ANTES de reiniciar API/worker.
// Não abre IA, browser nem render; testa a conexão planner→job→core.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {conectarMotorMotion} = require('../dist/jobs/motion-core-routing');
const {checkMotionSource,resolveMotionSource}=require('../bin/motion-scene-core');

function run() {
  const source='motion/promocao-v5';
  const render={key:'renderizar',title:'Renderizar a composição 3D',
    provider:'local-shell',
    instructions:'nivoo-renderizar-motion '+source+' --saida midia/saida/novo.mp4 --segundos 20 --tamanho 1080x1920',
    verifyCommand:'test -s midia/saida/novo.mp4'};
  const compose={key:'compor',title:'Compor animação 3D com pizza e logo',
    provider:'codex-cli',instructions:'Produza motion/promocao-v5/index.html com fotografias da pizza',
    verifyCommand:'test -s motion/promocao-v5/index.html && grep -q __motionFim motion/promocao-v5/index.html && test -s out/composicao.md'};
  const objective='Crie vídeo 3D com pizza e logo, acelere néon e BLACK';
  const converted=conectarMotorMotion([compose,render], 'codex-cli',objective);
  assert.equal(converted.length,2,'nenhuma etapa extra');
  assert.match(converted[0].instructions,/NIVOO_MOTION_CORE_CONTRACT_V1/);
  assert.match(converted[0].instructions,/overlays\.json/);
  assert.equal(converted[0].verifyCommand,compose.verifyCommand,
    'não adicionar nem substituir testes por aprovador de composição');
  assert.doesNotMatch(converted[0].verifyCommand,/nivoo-conferir-motion/);
  assert.equal(converted[1].instructions,render.instructions.replace(source,source+'/index.html --motor hybrid'),
    'o 3D novo deve renderizar o HTML mesmo se scene.json antigo coexistir');
  assert.deepEqual(conectarMotorMotion(converted,'codex-cli',objective),converted,
    'a prévia do plano e a criação do job devem produzir EXATAMENTE o mesmo resultado');

  const simple=[
    {key:'criar',title:'Criar animação para loja',provider:'codex-cli',
      instructions:'Escrever motion/anuncio/index.html com imagens de produtos',
      verifyCommand:'test -s motion/anuncio/index.html'},
    {key:'render',title:'Renderizar animação',
      provider:'local-shell',instructions:'set -e\nnivoo-renderizar-motion motion/anuncio --tamanho 1080x1920 --saida midia/saida/anuncio.mp4 --segundos 12'},
  ];
  const convertedSimple=conectarMotorMotion(simple,'codex-cli','Publicidade de promoção sem geometria 3D');
  assert.match(convertedSimple[0].instructions,/scene\.json/);
  const {motionAuthorContract}=require('../bin/motion-scene-core');
  assert.ok(convertedSimple[0].instructions.includes(motionAuthorContract()),
    'especialista recebe exemplo e unidades do motor instalado');
  assert.ok(converted[0].instructions.includes(motionAuthorContract(true)),
    'mesmo contrato serve ao especialista híbrido');
  assert.equal(convertedSimple[0].verifyCommand,simple[0].verifyCommand);
  assert.match(convertedSimple[1].instructions,/scene\.json --motor scene/);
  assert.equal(convertedSimple.length,2);
  assert.equal(simple[0].instructions,'Escrever motion/anuncio/index.html com imagens de produtos','não alterar plano original');

  // Exatamente o cenário que interrompeu o instalador no POCOU:
  // a expressão "SEM geometria 3D" não pode selecionar o modo WebGL.
  const sceneAgain=conectarMotorMotion(convertedSimple,'codex-cli',
    'Publicidade de promoção sem geometria 3D');
  assert.deepEqual(sceneAgain,convertedSimple,
    'validar o plano duas vezes não pode trocar scene.json por overlays.json');
  for (const objective2 of [
    'Publicidade sem 3D, apenas imagens e texto',
    'Não quero WebGL; animação de fotos de produtos',
    'Efeito bonito sem efeito 3D, apenas neon e tipografia',
  ]) {
    const produced=conectarMotorMotion(simple,'codex-cli',objective2);
    assert.match(produced[0].instructions,/scene\.json/,'briefing negativo não exige WebGL: '+objective2);
    assert.match(produced[1].instructions,/scene\.json --motor scene/);
    assert.deepEqual(conectarMotorMotion(produced,'codex-cli',objective2),produced,
      'roteador deve permanecer idempotente: '+objective2);
  }
  const real=conectarMotorMotion([
    {...simple[0],title:'Criar cena com extrusão 3D e fotos de produto'},
    simple[1],
  ],'codex-cli','Animação com geometria 3D real e fotografia');
  assert.match(real[0].instructions,/overlays\.json/,
    'pedido explícito de malhas tridimensionais deve orientar WebGL híbrido');
  assert.match(real[1].instructions,/index\.html --motor hybrid/);
  assert.match(real[1].instructions,/motion\/anuncio\/index\.html\s/);
  const revised=conectarMotorMotion([
    {key:'refazer',title:'Refazer arte',provider:'codex-cli',instructions:'Criar novos elementos gráficos com o logo original'},
    {...simple[1],instructions:"nivoo-renderizar-motion 'motion/anuncio/scene.json' --segundos 12"},
  ],'codex-cli','Quero imagens premium em 3D animadas');
  assert.match(revised[1].instructions,/motion\/anuncio\/index\.html'/);
  assert.match(revised[0].instructions,/fundo opaco/);
  assert.match(revised[1].instructions,/--motor hybrid/);
  const priorMode=conectarMotorMotion([compose,{...render,instructions:render.instructions+' --motor scene'}],'codex-cli',objective);
  assert.match(priorMode[1].instructions,/index\.html/);
  assert.match(priorMode[1].instructions,/--motor hybrid/);
  assert.doesNotMatch(priorMode[1].instructions,/--motor scene/);
  assert.ok(!motionAuthorContract(true).includes('assets/fundo.png'));
  assert.deepEqual(conectarMotorMotion(revised,'codex-cli','Quero imagens premium em 3D animadas'),revised);

  assert.ok(converted[1].dependsOn.includes(compose.key),'render não pode iniciar antes da autoria');
  const refacao='O vídeo é o mesmo. Faça de novo com elementos gráficos premium em 3D e logo';
  const revisao=conectarMotorMotion([{...simple[1],instructions:'nivoo-renderizar-motion motion/anuncio --segundos 12'}],'codex-cli',refacao);
  assert.equal(revisao.length,2,'refação visual sem autoria precisa da etapa produtora, não de revisor');
  assert.equal(revisao[0].verifyCommand,"test -s 'motion/anuncio/index.html' && test -s 'motion/anuncio/overlays.json'",
    'a autoria criada pelo workflow deve satisfazer o contrato obrigatório do JobsService');
  assert.match(revisao[0].instructions,/NivooGraphics/);
  assert.match(revisao[1].instructions,/motion\/anuncio\/index\.html/);
  assert.ok(revisao[1].dependsOn.includes(revisao[0].key));
  assert.deepEqual(conectarMotorMotion(revisao,'codex-cli',refacao),revisao);
  const premium=conectarMotorMotion(simple,'codex-cli','Direção de arte premium e elementos gráficos');
  assert.match(premium[1].instructions,/index\.html --motor html/);
  assert.match(premium[0].instructions,/NivooGraphics/);
  assert.deepEqual(conectarMotorMotion(premium,'codex-cli','Direção de arte premium e elementos gráficos'),premium);
  assert.equal(conectarMotorMotion([render],'codex-cli','Refazer a renderização sem recriar a composição').length,1);
  const {installMotionGraphics,graphicsRuntimeFiles}=require('../bin/motion-graphics');
  assert.equal(graphicsRuntimeFiles.length,6);
  assert.ok(graphicsRuntimeFiles.every(file=>fs.statSync(file).isFile()));
  const {compileWorkflowPlan}=require('../dist/jobs/workflow/compile-plan');
  const compiled=compileWorkflowPlan(simple,'codex-cli','Direção de arte premium e elementos gráficos');
  assert.deepEqual(compileWorkflowPlan(compiled,'codex-cli','Direção de arte premium e elementos gráficos'),compiled,
    'prévia e criação usam o mesmo pipeline idempotente');
  const graphicsWindow={};
  new Function('window','('+installMotionGraphics.toString()+')()')(graphicsWindow);
  const G=graphicsWindow.NivooGraphics;
  const coordinates=[];
  const ctx={clearRect(){},fillRect(){},beginPath(){},moveTo(x,y){coordinates.push([x,y]);},lineTo(x,y){coordinates.push([x,y]);},closePath(){},fill(){},stroke(){}};
  const soft=G.create({width:360,height:640,getContext:type=>type==='2d'?ctx:null});
  for(const name of ['mesh','box','sphere','torus','cylinder','lerp','smooth'])
    assert.equal(soft[name],G[name],'renderer e namespace oferecem a mesma API: '+name);
  const quad=soft.mesh({positions:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],indices:[0,1,2,0,2,3]});
  assert.equal(quad.positions.length,18);
  assert.equal(quad.normals.length,18);
  assert.throws(()=>soft.mesh({positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,3]}),/Índices/);
  const mesh=soft.torus();
  soft.render([{geometry:mesh,color:'#d9a348',rotation:[20,0,0]}]);
  const first=JSON.stringify(coordinates);
  assert.ok(coordinates.length>0);
  assert.ok(coordinates.every(p=>p.every(Number.isFinite)));
  coordinates.length=0;
  soft.render([{geometry:mesh,color:'#d9a348',rotation:[50,60,0]}]);
  assert.notEqual(JSON.stringify(coordinates),first,'geometria 3D altera os quadros sem WebGL');
  assert.equal(soft.backend,'software');

  const old=[render];
  assert.deepEqual(conectarMotorMotion(old,'codex-cli',objective),old,
    'renderizar composição existente não exige migrar obra do usuário');
  assert.deepEqual(conectarMotorMotion(old,'codex-cli',
    'Re-renderize as pizzas do vídeo 3D existente depois de corrigir o motor'),old,
    'correção do motor NÃO obriga reabrir a IA nem reescrever a composição pronta');
  assert.deepEqual(conectarMotorMotion([{...render,instructions:'echo ok'}],'codex-cli',objective),
    [{...render,instructions:'echo ok'}],
    'sem chamada do renderizador, não forçar motor');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-motion-wiring-'));
  const previous=process.cwd();
  try {
    process.chdir(tmp);
    fs.mkdirSync(source+'/assets',{recursive:true});
    const pix=Buffer.from([137,80,78,71,13,10,26,10]);
    fs.writeFileSync(source+'/assets/pizza.png',pix);
    const standard={
      version:1,width:1080,height:1920,duration:20,
      layers:[{id:'pizza',type:'image',asset:'assets/pizza.png',x:540,y:900,
        width:450,height:450,z:20,supportZ:10}],
    };
    fs.writeFileSync(source+'/scene.json',JSON.stringify(standard));
    assert.equal(checkMotionSource(source,'scene').mode,'scene');
    assert.throws(()=>checkMotionSource(source,'hybrid'),/MOTION_CONTRATO:.*index.html e overlays.json/);
    fs.writeFileSync(source+'/index.html','<html><body><canvas></canvas></body></html>');
    fs.writeFileSync(source+'/overlays.json',JSON.stringify(standard));
    assert.equal(checkMotionSource(source,'hybrid').mode,'hybrid');
    // Mesmo diretório, três motores possíveis. A fonte explícita prevalece.
    assert.equal(resolveMotionSource(source,'auto').mode,'scene');
    assert.equal(resolveMotionSource(source+'/index.html','auto').mode,'hybrid');
    assert.equal(checkMotionSource(source+'/index.html','auto').mode,'hybrid');
    assert.equal(resolveMotionSource(source,'html').mode,'html');
    assert.equal(resolveMotionSource(source,'html').overlayPath,null);
    assert.equal(checkMotionSource(source,'html').mode,'html');
    assert.throws(()=>resolveMotionSource(source+'/index.html','scene'),/MOTION_CONTRATO/);
    assert.throws(()=>resolveMotionSource(source+'/scene.json','hybrid'),/MOTION_CONTRATO/);
    // O mesmo produto não pode ser desenhado dentro do HTML e no overlay.
    fs.writeFileSync(source+'/index.html','<script src="assets/pizza.png"></script>');
    assert.throws(()=>checkMotionSource(source,'hybrid'),/MOTION_CONTRATO:.*referenciada no index.html/);
    fs.writeFileSync(source+'/index.html','<html><body><canvas></canvas></body></html>');
    const script=path.resolve(__dirname,'../bin/nivoo-conferir-motion');
    const ok=spawnSync(process.execPath,[script,source,'--modo','hybrid'],{encoding:'utf8'});
    assert.equal(ok.status,0,ok.stderr);
    assert.match(ok.stdout,/NIVO_MOTION: composição disponível/);
    fs.rmSync(source+'/overlays.json');
    const invalid=spawnSync(process.execPath,[script,source,'--modo','hybrid'],{encoding:'utf8'});
    assert.equal(invalid.status,0,
      'comando de conferência dos jobs antigos não pode bloquear vídeo pronto');
    assert.match(invalid.stderr,/aviso \(não bloqueante\)/);
  } finally { process.chdir(previous);fs.rmSync(tmp,{recursive:true,force:true}); }
  console.log('OK: Nivo usa motor sem aprovador extra; entrega, aviso de logo e retomada sem nova sessão de IA');
}
try{run();}catch(e){console.error(e);process.exitCode=1;}
