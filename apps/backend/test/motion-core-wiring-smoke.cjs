'use strict';
// Executado no "nivoo update" após tsc e ANTES de reiniciar API/worker.
// Não abre IA, browser nem render; testa a conexão planner→job→core.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {conectarMotorMotion} = require('../dist/jobs/motion-core-routing');
const {checkMotionSource}=require('../bin/motion-scene-core');

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
  assert.doesNotMatch(converted[1].instructions,/--motor\s/);
  assert.match(converted[1].instructions,/--ritmo energetico/);
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
  assert.equal(convertedSimple[0].verifyCommand,simple[0].verifyCommand);
  assert.doesNotMatch(convertedSimple[1].instructions,/--motor\s/);
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
    assert.doesNotMatch(produced[1].instructions,/--motor\s/);
    assert.deepEqual(conectarMotorMotion(produced,'codex-cli',objective2),produced,
      'roteador deve permanecer idempotente: '+objective2);
  }
  const real=conectarMotorMotion([
    {...simple[0],title:'Criar cena com extrusão 3D e fotos de produto'},
    simple[1],
  ],'codex-cli','Animação com geometria 3D real e fotografia');
  assert.match(real[0].instructions,/overlays\.json/,
    'pedido explícito de malhas tridimensionais deve orientar WebGL híbrido');
  assert.doesNotMatch(real[1].instructions,/--motor\s/);

  const old=[render];
  assert.deepEqual(conectarMotorMotion(old,'codex-cli',objective),old,
    'renderizar composição existente não exige migrar obra do usuário');
  assert.throws(() => conectarMotorMotion(old,'codex-cli',
    'Corrija o recorte das pizzas no vídeo 3D; é preciso alterar a imagem'),
    /MOTION_CONTRATO:.*Só renderizar a composição antiga repetiria o defeito/,
    'o Nivo não pode propor apenas um re-render quando a cena precisa de correção');
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
    // O mesmo produto não pode ser desenhado dentro do HTML e no overlay.
    fs.writeFileSync(source+'/index.html','<script src="assets/pizza.png"></script>');
    assert.throws(()=>checkMotionSource(source,'hybrid'),/MOTION_CONTRATO:.*referenciada no index.html/);
    fs.writeFileSync(source+'/index.html','<html><body><canvas></canvas></body></html>');
    const script=path.resolve(__dirname,'../bin/nivoo-conferir-motion');
    const ok=spawnSync(process.execPath,[script,source,'--modo','hybrid'],{encoding:'utf8'});
    assert.equal(ok.status,0,ok.stderr);
    assert.match(ok.stdout,/NIVO_MOTION_CORE: fonte pronta; modo=hybrid/);
    fs.rmSync(source+'/overlays.json');
    const invalid=spawnSync(process.execPath,[script,source,'--modo','hybrid'],{encoding:'utf8'});
    assert.equal(invalid.status,0,
      'comando de conferência dos jobs antigos não pode bloquear vídeo pronto');
    assert.match(invalid.stderr,/aviso \(não bloqueante\)/);
  } finally { process.chdir(previous);fs.rmSync(tmp,{recursive:true,force:true}); }
  console.log('OK: Nivo usa motor sem aprovador extra; entrega, aviso de logo e retomada sem nova sessão de IA');
}
try{run();}catch(e){console.error(e);process.exitCode=1;}
