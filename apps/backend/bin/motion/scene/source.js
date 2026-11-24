'use strict';
const fs=require('node:fs');const path=require('node:path');const {loadScene}=require('./assets');
/** Select once, using the same rules for inspection and actual rendering.
 * Explicit HTML is not displaced by an older scene.json in the same folder.
 * Inspection of assets remains a separate operation.
 */
function resolveMotionSource(source, mode = 'auto') {
  if (!['auto','scene','hybrid','html'].includes(mode))
    throw new Error('MOTION_CONTRATO: modo inválido: '+mode);
  const requested=path.resolve(source);
  if (!fs.existsSync(requested)) throw new Error('MOTION_CONTRATO: composição não encontrada: '+source);
  const directory=fs.statSync(requested).isDirectory();
  const dir=directory?requested:path.dirname(requested);
  const scenePath=path.join(dir,'scene.json'), overlayPath=path.join(dir,'overlays.json');
  const entry=directory
    ? (mode==='scene'||(mode==='auto'&&fs.existsSync(scenePath))?scenePath:path.join(dir,'index.html'))
    : requested;
  const isScene=path.basename(entry)==='scene.json';
  if(mode==='scene'&&!isScene || (mode==='hybrid'||mode==='html')&&isScene)
    throw new Error('MOTION_CONTRATO: fonte incompatível com modo '+mode);
  if(mode==='hybrid'&&(!fs.existsSync(entry)||!fs.existsSync(overlayPath)))
    throw new Error('MOTION_CONTRATO: index.html e overlays.json são obrigatórios para composição WebGL com produtos');
  if(!fs.existsSync(entry)||!fs.statSync(entry).isFile())
    throw new Error('MOTION_CONTRATO: fonte não encontrada: '+entry);
  const resolvedMode=isScene?'scene':mode==='html'?'html':fs.existsSync(overlayPath)?'hybrid':'html';
  return {entry,mode:resolvedMode,overlayPath:resolvedMode==='hybrid'?overlayPath:null};
}

/** Inspection is advisory for legacy jobs; renderer uses the same selector. */
function checkMotionSource(source, mode = 'auto') {
  const selected=resolveMotionSource(source,mode);
  const sourceMode=selected.mode;
  const scenePath=selected.entry, htmlPath=selected.entry, overlayPath=selected.overlayPath;
  try {
    if (sourceMode==='scene') {
      if (!fs.existsSync(scenePath)) throw new Error('scene.json obrigatório para cenas estruturadas');
      const {scene,warnings} = loadScene(scenePath);
      return {mode:'scene',layers:scene.layers.length,width:scene.width,height:scene.height,warnings};
    }
    if (sourceMode==='hybrid') {
      const {scene,warnings}=loadScene(overlayPath,{overlay:true});
      if(!scene.layers.length)return {mode:'hybrid',layers:0,width:scene.width,height:scene.height,warnings:[...warnings,'Overlay vazio explícito; conteúdo visual pertence ao HTML.']};
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
    return {mode:mode==='html'?'html':'legacy',layers:0};
  } catch (e) {
    throw new Error('MOTION_CONTRATO: '+String(e&&e.message||e));
  }
}
module.exports={checkMotionSource,resolveMotionSource};
