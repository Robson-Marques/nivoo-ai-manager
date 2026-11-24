'use strict';
function finite(v, label, a, b) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < a || v > b)
    throw new Error(label + ': número fora do intervalo ' + a + '–' + b);
  return v;
}
function color(v, label) {
  if (typeof v !== 'string' || !/^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d., %]+\)|[a-zA-Z]{3,20})$/.test(v))
    throw new Error(label + ': cor inválida');
  return v;
}
/**
 * "profile" só ajusta o ritmo automático: não controla imagens, textos nem
 * a renderização do MP4. Uma IA pode chamá-lo de "cinematic", "teaser",
 * "elegante" etc. Isso não deve derrubar uma cena pronta.
 * Normalizar somente em memória; os arquivos de trabalho ficam intactos.
 */
function normalizeMotionProfile(value) {
  if (typeof value !== 'string') return 'normal';
  const name=value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (['energetic','energetico','energetica','dynamic','dinamico','dinamica','fast','rapido','rapida'].includes(name))
    return 'energetic';
  if (['calm','calmo','calma','slow','suave','tranquilo','tranquila'].includes(name))
    return 'calm';
  // Outros nomes são descrições artísticas, não parâmetros executáveis.
  // Conservar os keyframes e o pacing explícito, sem impor outro ritmo.
  return 'normal';
}
/**
 * A largura/altura são apresentação, não formato de mídia. O Studio recebe
 * composições com width/height, w/h, "100%", "1080px", números como string,
 * "auto" ou tamanho omitido. Corrigir essas variações no motor evita que a IA
 * tenha de reconstruir uma cena já concluída por um problema de sintaxe.
 *
 * As dimensões são PIXELS após normalização e nunca saem do limite do motor.
 * Não converte caminhos de assets, não altera o arquivo scene.json no disco.
 */
function motionLength(value, canvas, fallback) {
  let number=value;
  let pxExplicit=false, percent=false;
  if (typeof number==='string') {
    const v=number.trim().toLowerCase().replace(',', '.');
    if (/^(auto|inherit|initial|unset)$/.test(v)) return fallback;
    const pct=v.match(/^((?:\d+(?:\.\d+)?|\.\d+))\s*%$/);
    if(pct){number=canvas*Number(pct[1])/100;percent=true;}
    else {
      const px=v.match(/^((?:\d+(?:\.\d+)?|\.\d+))\s*(px)?$/);
      if(px){number=Number(px[1]);pxExplicit=!!px[2];}
      else number=NaN;
    }
  }
  if (!pxExplicit&&!percent&&typeof number==='number'&&number>0&&number<=1) {
    number=canvas*number;
  }
  if (typeof number!=='number'||!Number.isFinite(number)||number<=0||number>12000)
    return fallback;
  return Math.max(1,number);
}
function isBackgroundLayer(layer) {
  const label=[layer.id,layer.role,layer.name,layer.asset,layer.src]
    .filter(v=>typeof v==='string').join(' ').toLowerCase();
  return /(?:^|[^a-z])(?:fundo|background|backdrop|bg)(?:[^a-z]|$)/.test(label);
}
function normalizeLayerDimensions(layer,scene) {
  if(layer.type==='neon')return;
  const bg=layer.type==='image'&&isBackgroundLayer(layer);
  const naturalWidth=layer.type==='image' ? Math.min(scene.width*.62,960)
    : layer.type==='text' ? scene.width*.86 : scene.width*.35;
  const naturalHeight=layer.type==='image' ? Math.min(scene.height*.25,520)
    : layer.type==='text' ? Math.min(scene.height*.14,Math.max(95,(Number(layer.fontSize)||60)*2))
    : scene.height*.16;
  const widthFallback=bg?scene.width:naturalWidth;
  const heightFallback=bg?scene.height:naturalHeight;
  const originalWidth=layer.width??layer.w;
  const originalHeight=layer.height??layer.h;
  // Informações de tamanho ausentes são marcadas apenas em memória para
  // preservar proporções naturais de logomarcas no navegador.
  layer.__autoWidth=!bg&&(layer.__autoWidth===true||originalWidth==null||originalWidth==='auto');
  layer.__autoHeight=!bg&&(layer.__autoHeight===true||originalHeight==null||originalHeight==='auto');
  layer.width=motionLength(originalWidth,scene.width,widthFallback);
  layer.height=motionLength(originalHeight,scene.height,heightFallback);
}
function numericRepresentation(value, unit, reference) {
  if (typeof value !== 'string') return value;
  const m=value.trim().replace(',', '.').match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(px|%|deg)?$/i);
  if(!m)return value;
  const n=Number(m[1]), suffix=(m[2]??'').toLowerCase();
  if(!suffix || suffix===unit)return n;
  if(suffix==='%'&&reference!==undefined)return n*reference/100;
  return value;
}
function motionSeconds(value, unit='s', total) {
  if(typeof value==='number')return unit==='ms'?value/1000:value;
  if(typeof value!=='string')return value;
  const v=value.trim().replace(',', '.');
  const clock=v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if(clock&&Number(clock[2])<60&&Number(clock[3])<60)
    return Number(clock[1]??0)*3600+Number(clock[2])*60+Number(clock[3]);
  const m=v.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(ms|s|sec|seconds?|%)?$/i);
  if(!m)return value;
  if(m[2]==='%')return total===undefined?value:Number(m[1])*total/100;
  return Number(m[1])/((m[2]?.toLowerCase()??unit)==='ms'?1000:1);
}
function normalizeLayerState(target,scene) {
  for(const [name,unit,reference] of [
    ['x','px',scene.width],['y','px',scene.height],['z'],['supportZ'],
    ['rotation','deg'],['opacity',undefined,1],['scale',undefined,1],['fontSize','px'],
  ]) if(target[name]!==undefined)target[name]=numericRepresentation(target[name],unit,reference);
}
function normalizeLayerTimeline(layer,total,scene) {
  // Canonical seconds survive a second validation (loadScene -> sceneDocument).
  // Aliases and explicit units are normalized without rewriting scene.json.
  if(layer.keys===undefined&&Array.isArray(layer.keyframes))layer.keys=layer.keyframes;
  if(!Array.isArray(layer.keys))return;
  const keys=layer.keys;
  if(keys.some(k=>!k||typeof k!=='object'||Array.isArray(k)))return;
  const declared=layer.timeUnit??scene.timeUnit;
  const explicit=declared==='ms'||declared==='s';
  const withUnit=(v,u)=>v==null?undefined:
    typeof v==='number'||/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(String(v).trim())?String(v)+u:v;
  const candidates=k=>[k.at,k.time,k.t,withUnit(k.seconds,'s'),
    withUnit(k.atMs,'ms'),withUnit(k.timeMs,'ms')].filter(v=>v!=null);
  const values=keys.map(k=>candidates(k)[0]);
  // Legacy compositions sometimes use bare milliseconds. Only infer this
  // when the ENTIRE nonzero series is outside the seconds timeline and fits
  // in milliseconds; never reinterpret a mixed/ambiguous seconds series.
  const bare=values.map(v=>typeof v==='number'?v:
    typeof v==='string'&&/^[+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(v.trim())?Number(v.trim().replace(',','.')):NaN);
  const positive=bare.filter(v=>v>0);
  const legacyMs=!explicit&&bare.every(Number.isFinite)&&positive.length>=2&&
    positive.every(v=>v>total&&v<=total*1000)&&Math.max(...positive)>=100;
  const unit=declared==='ms'||legacyMs?'ms':'s';
  keys.forEach(k=>{
    const times=candidates(k).map(v=>motionSeconds(v,unit,total));
    if(times.some(v=>v!==times[0]))throw new Error(layer.id+': tempos de keyframe conflitantes');
    k.at=times[0];
    for(const name of ['time','t','seconds','atMs','timeMs'])delete k[name];
    normalizeLayerState(k,scene);
    const easingAliases={'ease':'smooth','ease-in-out':'smooth','ease-out':'out'};
    if(typeof k.easing==='string'&&Object.hasOwn(easingAliases,k.easing))k.easing=easingAliases[k.easing];
  });
  if(layer.timeUnit!==undefined||scene.timeUnit!==undefined)layer.timeUnit='s';
}
module.exports={finite,color,normalizeMotionProfile,motionLength,normalizeLayerDimensions,numericRepresentation,motionSeconds,normalizeLayerState,normalizeLayerTimeline};
