'use strict';

/**
 * Motor Nivoo Motion: cenas declarativas, sem HTML/WebGL improvisado pela IA.
 * Camadas com z ordenado; fotografia é desenhada uma única vez com sua própria
 * transparência, sombra independente e sem penetrar outra geometria.
 * O núcleo controla ritmos, keyframes e captura; revisão artística é humana.
 *
 * Exemplo em motion/<pasta>/scene.json:
 * {"version":1,"width":1080,"height":1920,"duration":20,"profile":"energetic",
 *  "pacing":{"sourceDuration":25,"openingEnd":7.15,"openingSeconds":3.5},
 *  "layers":[{"id":"produto","type":"image","asset":"assets/produto.png",
 *    "x":540,"y":1120,"width":560,"height":560,"z":20,"supportZ":10,
 *    "keys":[{"at":11,"x":-340,"opacity":0},{"at":13,"x":540,"opacity":1}]}]}
 */
const fs = require('node:fs');
const path = require('node:path');

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
/**
 * Native authoring contract, shared with the Motion specialist. Keep the
 * canonical example executable by validateScene, not a separate schema.
 * The author chooses artistic values; the engine owns representations.
 */
const motionAuthorExample = {
  version:1,width:1080,height:1920,duration:12,profile:'normal',
  layers:[
    {id:'fundo',type:'image',asset:'assets/fundo.png',x:540,y:960,width:1080,height:1920,z:0,shadow:false},
    {id:'logo',type:'image',asset:'assets/logo.png',x:540,y:390,width:420,height:'auto',z:10,
      keys:[{at:0,opacity:0},{at:1,opacity:1,easing:'out'}]},
    {id:'titulo',type:'text',text:'Seu texto',x:540,y:920,width:920,fontSize:78,z:20,color:'#ffffff',
      keys:[{at:1,opacity:0,scale:.9},{at:2,opacity:1,scale:1,easing:'smooth'}]},
  ],
};
function motionAuthorContract() {
  return [
    'Use este exemplo funcional do próprio motor (adapte conteúdo, duração, layout e animações ao briefing; não copie a arte): '+JSON.stringify(motionAuthorExample),
    'Tempo: duration, pacing.sourceDuration, openingEnd/openingSeconds, keys[].at e neon start/end em segundos; keys ordenadas e sem tempos duplicados, de 0 até sourceDuration ou duration. Sem timestamps em frames ou milissegundos implícitos.',
    'Coordenadas x/y e dimensões em pixels, origem no canto superior esquerdo; x/y são o centro da camada. z/supportZ ordenam camadas. Opacity 0–1, scale 0.01–20, rotation em graus.',
    'Keyframes animam somente x, y, z, rotation, opacity, scale; easing: linear, smooth, out, back. Informe o estado inicial explicitamente em at:0 quando precisar ocultar uma camada antes da entrada.',
    'image: asset relativo ao scene.json; width/height podem ser auto para manter proporção. text: text, fontSize, font, weight, color, align, width; use camadas separadas para linhas. shape: shape rect/ellipse/roundRect, fill, radius. neon: points [[x,y],...], start/end, color, glow, strokeWidth. Marque required:true em imagens obrigatórias do briefing.',
    'Use profile normal, calm ou energetic; pacing opcional para remapear uma composição de duração original maior. Não invente campos de animação; use os recursos disponíveis no motor.',
  ].join('\n');
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
function validateScene(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1)
    throw new Error('Cena deve ser um objeto com version=1');
  raw.width=numericRepresentation(raw.width,'px');raw.height=numericRepresentation(raw.height,'px');
  raw.duration=motionSeconds(raw.duration);
  finite(raw.width, 'width', 120, 4096); finite(raw.height, 'height', 120, 4096);
  finite(raw.duration, 'duration', .1, 300);
  if (!Array.isArray(raw.layers) || !raw.layers.length || raw.layers.length > 180)
    throw new Error('layers deve conter 1 a 180 camadas');
  if (raw.background !== undefined) color(raw.background, 'background');
  if(raw.pacing&&typeof raw.pacing==='object'){
    for(const k of ['sourceDuration','openingEnd','openingSeconds'])
      if(raw.pacing[k]!==undefined)raw.pacing[k]=motionSeconds(raw.pacing[k]);
  }
  const total = raw.pacing?.sourceDuration ?? raw.duration;
  finite(total, 'pacing.sourceDuration', raw.duration, 300);
  if (raw.profile !== undefined) raw.profile=normalizeMotionProfile(raw.profile);
  if (raw.pacing?.openingEnd !== undefined) {
    finite(raw.pacing.openingEnd, 'openingEnd', .1, total);
    const target = raw.pacing.openingSeconds ??
      (raw.profile === 'energetic' ? Math.min(3.5, raw.duration * .3) : raw.pacing.openingEnd);
    finite(target, 'openingSeconds', .1, raw.duration);
  }
  const ids = new Set(), assets = new Set();
  for (const l of raw.layers) {
    if (!l || typeof l !== 'object' || Array.isArray(l) || !['image','text','shape','neon'].includes(l.type))
      throw new Error('Camada inválida (image, text, shape, neon)');
    if (typeof l.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(l.id) || ids.has(l.id))
      throw new Error('ID de camada vazio, duplicado ou inválido');
    ids.add(l.id);
    normalizeLayerState(l,raw);
    normalizeLayerTimeline(l,total,raw);
    if(l.type==='neon'){
      if(l.start!==undefined)l.start=motionSeconds(l.start);
      if(l.end!==undefined)l.end=motionSeconds(l.end);
    }
    for (const k of ['x','y','z']) if (l[k] !== undefined) finite(l[k], l.id+'.'+k, -10000, 10000);
    if (l.type !== 'neon') {
      normalizeLayerDimensions(l,raw);
      finite(l.width, l.id+'.width', 1, 12000);
      finite(l.height, l.id+'.height', 1, 12000);
    }
    if (l.type === 'image') {
      // Suportar formatos de composição existentes, sem exigir que uma IA
      // refaça o JSON apenas porque escreveu "src" em vez de "asset".
      // Normalização é apenas EM MEMÓRIA, não reescreve a composição pronta.
      if (!(typeof l.asset === 'string' && l.asset.trim())) {
        const alias=[l.src,l.image,l.file,l.path].find(v=>typeof v==='string'&&v.trim());
        if(alias) l.asset=alias;
      }
      if (typeof l.asset === 'string' && l.asset.trim()) assets.add(l.asset);
      else console.warn('[NIVO_MOTION] camada sem referência de mídia: '+l.id);
      if (l.supportZ !== undefined) finite(l.supportZ, l.id+'.supportZ', -10000, 10000);
    }
    if (l.type === 'text') {
      if (typeof l.text !== 'string' || !l.text.trim() || l.text.length > 500) throw new Error(l.id+': texto inválido');
      if (l.fontSize !== undefined) finite(l.fontSize, l.id+'.fontSize', 8, 800);
    }
    if (l.type === 'shape' && !['rect','ellipse','roundRect'].includes(l.shape))
      throw new Error(l.id+': shape deve ser rect, ellipse ou roundRect');
    if (l.type === 'neon') {
      if (!Array.isArray(l.points) || l.points.length < 2 || l.points.length > 200)
        throw new Error(l.id+': neon exige 2–200 pontos');
      l.points.forEach((p,i) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(l.id+': ponto '+i+' inválido');
        finite(p[0], 'point.x', -10000, 10000);finite(p[1], 'point.y', -10000, 10000);
      });
      finite(l.start ?? 0, l.id+'.start', 0, total);
      finite(l.end ?? total, l.id+'.end', 0, total);
      if ((l.end ?? total) <= (l.start ?? 0)) throw new Error(l.id+': intervalo neon vazio');
    }
    if (l.color !== undefined) color(l.color, l.id+'.color');
    if (l.fill !== undefined) color(l.fill, l.id+'.fill');
    if (l.shadow?.color !== undefined) color(l.shadow.color,l.id+'.shadow.color');
    if (l.keys !== undefined) {
      if (!Array.isArray(l.keys) || l.keys.length > 80) throw new Error(l.id+': keys inválidos');
      let previous = -Infinity;
      l.keys.forEach((k) => {
        if (!k || typeof k !== 'object' || Array.isArray(k)) throw new Error(l.id+': keyframe inválido');
        finite(k.at, l.id+'.at', 0, total);
        if (k.at <= previous) throw new Error(l.id+': keyframes devem ser ordenados sem duplicações');
        previous = k.at;
        for (const f of ['x','y','z','rotation','opacity','scale'])
          if (k[f] !== undefined) finite(k[f],l.id+'.'+f,f==='opacity'?0:f==='scale'?.01:-10000,f==='opacity'?1:f==='scale'?20:10000);
        if (k.easing !== undefined && !['linear','smooth','out','back'].includes(k.easing))
          throw new Error(l.id+': easing inválido');
      });
    }
    if (l.opacity !== undefined) finite(l.opacity,l.id+'.opacity',0,1);
    if (l.scale !== undefined) finite(l.scale,l.id+'.scale',.01,20);
  }
  return { scene: raw, assets: [...assets] };
}
function loadScene(scenePath) {
  const absolute = fs.realpathSync(scenePath);
  const dir = path.dirname(absolute);
  const parsed = JSON.parse(fs.readFileSync(absolute,'utf8'));
  const requestedProfile=parsed.profile;
  const { scene, assets } = validateScene(parsed);
  const binaries = {}, warnings = [];
  if (requestedProfile !== undefined && requestedProfile !== scene.profile) {
    const label=typeof requestedProfile==='string' ? requestedProfile.slice(0,80) : typeof requestedProfile;
    warnings.push('Perfil de ritmo '+JSON.stringify(label)+' interpretado como '+
      scene.profile+'; composição original preservada');
  }
  let totalBytes=0;
  const motionParent = path.basename(path.dirname(dir)) === 'motion' ? path.dirname(dir) : dir;
  const projectRoot = motionParent !== dir ? path.dirname(motionParent) : dir;
  const allowed = [motionParent, path.join(projectRoot,'contexto')];
  const withinAllowed = file => allowed.some(root=>file.startsWith(root+path.sep));
  function resolveLocalMedia(relative) {
    const expected=relative.startsWith('contexto/')
      ? path.resolve(projectRoot,relative):path.resolve(dir,relative);
    try {
      const found=fs.realpathSync(expected);
      if (!withinAllowed(found)) throw new Error('arquivo fora das pastas permitidas');
      return {file:found,recovered:false};
    } catch(error) {
      // Uma referência a um caminho proibido continua PROIBIDA, sem fallback.
      if (/fora das pastas permitidas/.test(String(error?.message??error)) ||
          path.isAbsolute(relative) || relative.split('/').filter(x=>x==='..').length>1)
        throw error;
      // O Nivo já copiou as fotografias para motion/<versão>/assets.
      // Recuperar pelo nome EXATO (sem adivinhar imagem por semelhança).
      const base=path.basename(relative);
      if(!/^[\w. -]{1,160}\.(?:png|jpe?g|webp|svg|js)$/i.test(base)) throw error;
      const dirs=[path.join(dir,'assets'),dir];
      const annexRoot=path.join(projectRoot,'contexto','anexos');
      if(fs.existsSync(annexRoot)) {
        for(const entry of fs.readdirSync(annexRoot,{withFileTypes:true}).slice(0,80))
          if(entry.isDirectory())dirs.push(path.join(annexRoot,entry.name));
      }
      for(const candidateDir of dirs) {
        let entries;
        try { entries=fs.readdirSync(candidateDir,{withFileTypes:true}); } catch { continue; }
        const names=entries.filter(e=>e.isFile() && e.name.toLowerCase()===base.toLowerCase());
        if(names.length!==1)continue;
        const found=fs.realpathSync(path.join(candidateDir,names[0].name));
        if(withinAllowed(found)) return {file:found,recovered:true};
      }
      throw error;
    }
  }
  for (const relative of assets) {
    try {
      if (relative.length > 28*1024*1024) throw new Error('referência grande demais');
      const embedded = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(relative);
      if (embedded) {
        if (Buffer.byteLength(relative,'utf8') > 28*1024*1024) throw new Error('imagem embutida muito grande');
        binaries[relative]=relative; continue;
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(relative)) throw new Error('referência remota não suportada');
      if (relative.includes('\0') || /[\x00-\x1f]/.test(relative)) throw new Error('nome com caracteres de controle');
      const {file,recovered} = resolveLocalMedia(relative);
      if(recovered) console.warn('[NIVO_MOTION] recurso localizado nos assets existentes: '+
        path.basename(relative));
      const size=fs.statSync(file).size;
      if (size > 20*1024*1024 || (totalBytes += size) > 60*1024*1024)
        throw new Error('limite de tamanho da mídia excedido');
      const ext=path.extname(file).toLowerCase();
      if(ext==='.js') {
        // Importa recurso antigo do Studio como DADO, nunca executa JavaScript.
        const content=fs.readFileSync(file,'utf8');
        const matches=content.match(/data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+/g)??[];
        if(matches.length!==1) throw new Error('módulo não contém uma imagem base64 única');
        binaries[relative]=matches[0];
      } else {
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
          '.webp':'image/webp','.svg':'image/svg+xml'}[ext];
        if(!mime) throw new Error('formato de imagem não suportado');
        binaries[relative]='data:'+mime+';base64,'+fs.readFileSync(file).toString('base64');
      }
    } catch(err) {
      // Uma camada de logo mal referenciada não pode interromper o MP4 inteiro.
      // Entrega o render disponível; o usuário recebe AVISO e pode pedir ajuste.
      const reason=String(err?.message??err).slice(0,180);
      const label=/^data:image/.test(relative)?'[imagem incorporada]':relative.slice(0,160);
      warnings.push('Imagem não carregada ('+label+'): '+reason);
    }
  }
  return { scene, binaries, warnings, sourcePath:absolute };
}
function safeJSON(x) { return JSON.stringify(x).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026'); }
/**
 * Uma foto de produto não é decoração: se não foi carregada ou desenhada,
 * o render é tecnicamente incompleto. Logos/fundos podem ser opcionais para
 * não transformar um elemento decorativo em bloqueio do vídeo inteiro.
 * `required:false` e `optional:true` continuam disponíveis ao autor.
 */
function productPhotoLayers(scene) {
  return (scene.layers ?? []).filter(layer => {
    if (layer.type !== 'image' || layer.optional === true || layer.required === false) return false;
    if (layer.required === true) return true;
    const label=[layer.id,layer.role,layer.asset,layer.name].filter(Boolean).join(' ').toLowerCase();
    return !/(?:^|[^a-z])(?:logo|logomarca|fundo|background|bg|decor|ornament|sombra|shadow|icone|icon)(?:[^a-z]|$)/.test(label);
  });
}

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

/** O mesmo código JavaScript funciona em navegador e em Node para testes. */
function sceneRuntime({scene,binaries,overlay=false}) {
  // Overlay transparente sobre HTML/WebGL 3D: nenhuma imagem de produto
  // atravessa malhas da cena 3D. O WebGL só desenha geometria própria.
  const canvas=overlay
    ? (window.__nivooOverlayCanvas || document.getElementById('nivoo-overlay'))
    : document.getElementById('nivoo');
  if(!canvas)throw new Error('Canvas do motor Nivo ausente');
  const ctx=canvas.getContext('2d',{alpha:overlay});
  if (!ctx) throw new Error('Canvas 2D indisponível');
  const images={}, end=scene.duration;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=t=>t*t*(3-2*t);
  const ease=(t,kind)=>kind==='out'?1-(1-t)**3:kind==='back'?1+2.4*(t-1)**3+1.4*(t-1)**2:kind==='linear'?t:smooth(t);
  const lerp=(a,b,k)=>a+(b-a)*k;
  const sourceEnd=overlay?end:(scene.pacing?.sourceDuration??end);
  // Overlay de WebGL recebe o tempo ORIGEM já mapeado pelo renderer.
  // Não executar segunda aceleração (duplicaria o ritmo das fotos).
  // Perfil energético sem configuração manual: comprimir automaticamente a
  // revelação do neon quando ela ocupa vários segundos da abertura.
  const neonEnds=scene.layers.filter(l=>l.type==='neon'&&Number.isFinite(l.end)&&l.end>0&&l.end<sourceEnd*.65)
    .map(l=>l.end);
  const openingEnd=overlay?undefined:(scene.pacing?.openingEnd??
    (scene.profile==='energetic'&&neonEnds.length?Math.max(...neonEnds):undefined));
  const openingSeconds=overlay?undefined:(scene.pacing?.openingSeconds??
    (scene.profile==='energetic'&&openingEnd?Math.min(openingEnd,3.5,end*.3):openingEnd));
  const timeline=(t)=>{
    t=clamp(t,0,end);
    if (!openingEnd||!openingSeconds||openingEnd===sourceEnd||openingSeconds===end) return t*sourceEnd/end;
    if (t<=openingSeconds) return t*openingEnd/openingSeconds;
    return openingEnd+(t-openingSeconds)*(sourceEnd-openingEnd)/(end-openingSeconds);
  };
  function stateAt(layer,t) {
    const base={x:layer.x??0,y:layer.y??0,z:layer.z??0,rotation:layer.rotation??0,scale:layer.scale??1,opacity:layer.opacity??1};
    const keys=layer.keys??[];
    if (!keys.length) return base;
    const interpolate=(a,b,k)=>Object.fromEntries(Object.keys(base).map(key=>[
      key,lerp(a[key]??base[key],b[key]??base[key],k)
    ]));
    if (t<=keys[0].at) return {...base,...keys[0]};
    for (let i=1;i<keys.length;i++) {
      if (t<=keys[i].at) {
        const a=keys[i-1],b=keys[i],k=ease(clamp((t-a.at)/(b.at-a.at)),b.easing);
        return interpolate(a,b,k);
      }
    }
    return {...base,...keys[keys.length-1]};
  }
  function partialPath(points,k) {
    let total=0;const lengths=[];
    for(let i=1;i<points.length;i++){let d=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);lengths.push(d);total+=d;}
    let left=total*k;
    ctx.moveTo(...points[0]);
    for(let i=1;i<points.length&&left>0;i++){
      const d=lengths[i-1];const f=d?Math.min(1,left/d):1;
      ctx.lineTo(lerp(points[i-1][0],points[i][0],f),lerp(points[i-1][1],points[i][1],f));
      left-=d;
    }
  }
  function drawLayer(l,t) {
    const s=stateAt(l,t);
    if(s.opacity<=.001)return;
    ctx.save();
    ctx.globalAlpha=clamp(s.opacity);
    ctx.translate(s.x,s.y);ctx.rotate(s.rotation*Math.PI/180);ctx.scale(s.scale,s.scale);
    let w=l.width??0,h=l.height??0;
    if(l.type==='image') {
      const img=images[l.asset];
      if(img?.naturalWidth&&img?.naturalHeight){
        const ratio=img.naturalWidth/img.naturalHeight;
        if(l.__autoWidth&&!l.__autoHeight)w=Math.min(12000,h*ratio);
        else if(l.__autoHeight)h=Math.min(12000,w/ratio);
      }
      // Em vez de "espessura" por 3 fotos escurecidas, uma só imagem RGBA.
      // Profundidade organizada pelo z entre camadas; sombra independente.
      if (!img?.complete || !img.naturalWidth) { ctx.restore();return; }
      if(l.shadow!==false){
        ctx.shadowColor=l.shadow?.color??'rgba(0,0,0,0.5)';
        ctx.shadowBlur=l.shadow?.blur??18;
        ctx.shadowOffsetX=l.shadow?.dx??8;
        ctx.shadowOffsetY=l.shadow?.dy??12;
      }
      ctx.drawImage(img,-w/2,-h/2,w,h);
      drawnImages++;
      if(overlay) everDrawn.add(l.id);
    } else if(l.type==='text'){
      ctx.textAlign=l.align??'center';ctx.textBaseline='middle';
      ctx.font=(l.weight??'900')+' '+(l.fontSize??48)+'px '+(l.font??'Arial, sans-serif');
      if(l.shadow!==false){ctx.shadowColor=l.shadow?.color??'rgba(0,0,0,.45)';ctx.shadowBlur=l.shadow?.blur??10;}
      if(l.stroke){ctx.lineWidth=l.strokeWidth??3;ctx.strokeStyle=l.stroke;ctx.strokeText(l.text,0,0,w||undefined);}
      ctx.fillStyle=l.color??'#ffffff';ctx.fillText(l.text,0,0,w||undefined);
    } else if(l.type==='shape'){
      ctx.fillStyle=l.fill??'#b87031';ctx.beginPath();
      if(l.shape==='ellipse')ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
      else if(l.shape==='roundRect'&&ctx.roundRect)ctx.roundRect(-w/2,-h/2,w,h,l.radius??18);
      else ctx.rect(-w/2,-h/2,w,h);
      if(l.shadow!==false){ctx.shadowColor=l.shadow?.color??'rgba(0,0,0,.5)';ctx.shadowBlur=l.shadow?.blur??12;ctx.shadowOffsetY=l.shadow?.dy??5;}
      ctx.fill();if(l.stroke){ctx.strokeStyle=l.stroke;ctx.lineWidth=l.strokeWidth??3;ctx.stroke();}
    } else if(l.type==='neon'){
      const k=clamp((t-(l.start??0))/((l.end??sourceEnd)-(l.start??0)));
      if(k>0){ctx.shadowColor=l.color??'#ffa528';ctx.shadowBlur=l.glow??22;ctx.strokeStyle=l.color??'#ffa528';ctx.lineWidth=l.strokeWidth??7;ctx.lineCap='round';ctx.lineJoin='round';
        ctx.beginPath();partialPath(l.points,k);ctx.stroke();
        ctx.shadowBlur=0;ctx.strokeStyle='#fff8d1';ctx.lineWidth=Math.max(1,(l.strokeWidth??7)*.3);ctx.stroke();}
    }
    ctx.restore();
  }
  if(!overlay){window.__motionSegundos=end;window.__motionFim=false;window.__nivooSceneReady=false;}
  else {
    window.__nivooOverlayReady=false;
    window.__nivooOverlayStats={
      expected:scene.layers.filter(l=>l.type==='image').length,
      loaded:0,loadedAssetKeys:[],failedAssetKeys:[],
      drawnAtLastFrame:0,lastTime:0,
    };
  }
  window.__motionCore={version:1,mode:overlay?'webgl-overlay':'declarative',timeline};
  const sorted=scene.layers.map(l=>{
    // Fotos nunca interpenetram o suporte: sem rotação inclinada no eixo de
    // profundidade e sempre pelo menos 1 unidade à frente do supportZ.
    return {...l,z:l.type==='image'?Math.max(l.z??0,(l.supportZ??-10000)+1):l.z??0};
  }).sort((a,b)=>a.z-b.z);
  let drawnImages=0;
  const everDrawn=new Set();
  const drawAt=(time)=>{
    const t=timeline(Number(time)||0);
    drawnImages=0;
    if(overlay){ctx.clearRect(0,0,canvas.width,canvas.height);}
    else {ctx.fillStyle=scene.background??'#090402';ctx.fillRect(0,0,canvas.width,canvas.height);}
    for(const l of sorted)drawLayer(l,t);
    if(overlay) {
      window.__nivooOverlayStats.loaded=Object.keys(images).length;
      window.__nivooOverlayStats.loadedAssetKeys=Object.keys(images);
      window.__nivooOverlayStats.drawnAtLastFrame=drawnImages;
      window.__nivooOverlayStats.everDrawnIds=[...everDrawn];
      window.__nivooOverlayStats.lastTime=t;
    }
    if(!overlay)window.__motionFim=Number(time)>=end;
  };
  if(overlay)window.__nivooOverlayRenderAt=drawAt;
  else window.__renderAt=drawAt;
  // A promessa de carregamento é aguardada diretamente pelo Playwright.
  // waitForFunction usa requestAnimationFrame/setInterval, que ficam parados
  // com o relógio virtual pausado, causando timeout e novas tentativas.
  const loadPromise=Promise.all(Object.keys(binaries).map(key=>new Promise(resolve=>{
    const img=new Image();img.onload=()=>{images[key]=img;resolve();};
    img.onerror=()=>{
      if(overlay)window.__nivooOverlayStats.failedAssetKeys.push(key);
      console.warn('[NIVO_MOTION] imagem falhou ao decodificar: '+key.slice(0,120));
      resolve();
    };
    img.src=binaries[key];
  }))).then(()=>{
    if(overlay)window.__nivooOverlayReady=true;
    else {
      window.__nivooSceneLoadedKeys=Object.keys(images);
      window.__nivooSceneReady=true;
    }
    drawAt(0);
    const beginning=performance.now();
    function tick(now){const t=Math.min(end,(now-beginning)/1000);drawAt(t);if(t<end)requestAnimationFrame(tick);}
    // Overlay de WebGL é SEMPRE escravo do relógio de captura. O RAF
    // autônomo apagava/redesenhava a foto no momento do screenshot, muitas
    // vezes com t=0 (opacity=0), produzindo vídeo só com tábuas vazias.
    if(!overlay)requestAnimationFrame(tick);
  }).catch(e=>{
    if(overlay)window.__nivooOverlayError=String(e.message||e);
    else window.__nivooSceneError=String(e.message||e);
    throw e;
  });
  if(overlay)window.__nivooOverlayLoadPromise=loadPromise;
  else window.__nivooSceneLoadPromise=loadPromise;
}
function overlayScript(scene,binaries) {
  validateScene(scene);
  return '('+sceneRuntime.toString()+')('+safeJSON({scene,binaries,overlay:true})+');';
}

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
module.exports={ motionAuthorContract,motionAuthorExample,motionLength,normalizeLayerDimensions,normalizeMotionProfile,validateScene,loadScene,productPhotoLayers,sceneDocument,overlayScript,sceneRuntime,checkMotionSource,mountMediaOverlay };
