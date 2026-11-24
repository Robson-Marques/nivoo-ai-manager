'use strict';
const fs=require('node:fs');const path=require('node:path');const {loadScene}=require('./assets');
/**
 * Ponte entre planejamento, validação da composição e render.
 * O mesmo contrato é verificado após a IA produzir a fonte e ANTES de
 * capturar qualquer quadro: não são duas decisões de formato independentes.
 */
function checkMotionSource(source, mode = 'auto') {
  if (!['auto','scene','hybrid'].includes(mode)) throw new Error('MOTION_CONTRATO: modo inválido: '+mode);
  const entry = path.resolve(source);
  if (!fs.existsSync(entry)) throw new Error('MOTION_CONTRATO: composição não encontrada: '+source);
  const dir = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
  const scenePath = path.join(dir,'scene.json'), htmlPath=path.join(dir,'index.html'), overlayPath=path.join(dir,'overlays.json');
  const sourceMode = mode === 'auto'
    ? fs.existsSync(scenePath) ? 'scene' : fs.existsSync(overlayPath) ? 'hybrid' : 'legacy'
    : mode;
  try {
    if (sourceMode==='scene') {
      if (!fs.existsSync(scenePath)) throw new Error('scene.json obrigatório para cenas estruturadas');
      const {scene,warnings} = loadScene(scenePath);
      return {mode:'scene',layers:scene.layers.length,width:scene.width,height:scene.height,warnings};
    }
    if (sourceMode==='hybrid') {
      if (!fs.existsSync(htmlPath) || !fs.existsSync(overlayPath))
        throw new Error('index.html e overlays.json são obrigatórios para composição WebGL com produtos');
      const {scene,warnings}=loadScene(overlayPath);
      const photos=scene.layers.filter(layer=>layer.type==='image');
      if (!photos.length)
        throw new Error('overlays.json deve conter pelo menos uma imagem de produto/logo');
      // Uma foto não pode ser texturizada no WebGL E desenhada no overlay:
      // verificação estática por caminho/nome do asset, sem executar HTML.
      // Essa duplicação é precisamente a origem de barras opacas e fantasmas
      // sobre o mesmo produto quando se migra uma cena 3D antiga.
      const html=fs.readFileSync(htmlPath,'utf8');
      const repeated=photos.find(layer=>{
        const name=path.basename(layer.asset);
        return name.length>4 && html.includes(name);
      });
      if(repeated) throw new Error('imagem '+repeated.asset+
        ' ainda é referenciada no index.html e no overlays.json; retire o desenho/importação duplicado do WebGL');
      return {mode:'hybrid',layers:scene.layers.length,width:scene.width,height:scene.height,warnings};
    }
    if (!fs.existsSync(htmlPath)) throw new Error('index.html não encontrado (legado)');
    return {mode:'legacy',layers:0};
  } catch (e) {
    throw new Error('MOTION_CONTRATO: '+String(e&&e.message||e));
  }
}
module.exports={checkMotionSource};
