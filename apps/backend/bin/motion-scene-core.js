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
function validateScene(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1)
    throw new Error('Cena deve ser um objeto com version=1');
  finite(raw.width, 'width', 120, 4096); finite(raw.height, 'height', 120, 4096);
  finite(raw.duration, 'duration', .1, 300);
  if (!Array.isArray(raw.layers) || !raw.layers.length || raw.layers.length > 180)
    throw new Error('layers deve conter 1 a 180 camadas');
  if (raw.background !== undefined) color(raw.background, 'background');
  const total = raw.pacing?.sourceDuration ?? raw.duration;
  finite(total, 'pacing.sourceDuration', raw.duration, 300);
  if (raw.profile !== undefined && !['normal','energetic','calm'].includes(raw.profile))
    throw new Error('profile inválido');
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
    for (const k of ['x','y','z']) if (l[k] !== undefined) finite(l[k], l.id+'.'+k, -10000, 10000);
    if (l.type !== 'neon') {
      finite(l.width, l.id+'.width', 1, 12000);
      finite(l.height, l.id+'.height', 1, 12000);
    }
    if (l.type === 'image') {
      if (typeof l.asset !== 'string' || !/^[A-Za-z0-9_.\/-]+\.(?:png|webp|jpe?g)$/i.test(l.asset) ||
          path.isAbsolute(l.asset) || l.asset.split('/').includes('..')) throw new Error(l.id+': asset local inválido');
      assets.add(l.asset);
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
  const { scene, assets } = validateScene(parsed);
  const binaries = {};
  let totalBytes=0;
  for (const relative of assets) {
    const file = fs.realpathSync(path.resolve(dir, relative));
    if (!file.startsWith(dir + path.sep)) throw new Error('Imagem fora da pasta da composição: '+relative);
    const size = fs.statSync(file).size;
    if (size > 20*1024*1024 || (totalBytes += size) > 60*1024*1024)
      throw new Error('Assets grandes demais; limite 20 MB por arquivo/60 MB por cena');
    const ext=path.extname(relative).toLowerCase();
    const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';
    binaries[relative]='data:'+mime+';base64,'+fs.readFileSync(file).toString('base64');
  }
  return { scene, binaries, sourcePath:absolute };
}
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
/** O mesmo código JavaScript funciona em navegador e em Node para testes. */
function sceneRuntime({scene,binaries}) {
  'use strict';
  const canvas=document.getElementById('nivoo'), ctx=canvas.getContext('2d',{alpha:false});
  if (!ctx) throw new Error('Canvas 2D indisponível');
  const images={}, end=scene.duration;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=t=>t*t*(3-2*t);
  const ease=(t,kind)=>kind==='out'?1-(1-t)**3:kind==='back'?1+2.4*(t-1)**3+1.4*(t-1)**2:kind==='linear'?t:smooth(t);
  const lerp=(a,b,k)=>a+(b-a)*k;
  const sourceEnd=scene.pacing?.sourceDuration??end;
  const openingEnd=scene.pacing?.openingEnd;
  const openingSeconds=scene.pacing?.openingSeconds??(scene.profile==='energetic'?Math.min(3.5,end*.3):openingEnd);
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
    const w=l.width??0,h=l.height??0;
    if(l.type==='image') {
      // Em vez de "espessura" por 3 fotos escurecidas, uma só imagem RGBA.
      // Profundidade organizada pelo z entre camadas; sombra independente.
      const img=images[l.asset];
      if (!img?.complete || !img.naturalWidth) { ctx.restore();return; }
      if(l.shadow!==false){
        ctx.shadowColor=l.shadow?.color??'rgba(0,0,0,0.5)';
        ctx.shadowBlur=l.shadow?.blur??18;
        ctx.shadowOffsetX=l.shadow?.dx??8;
        ctx.shadowOffsetY=l.shadow?.dy??12;
      }
      ctx.drawImage(img,-w/2,-h/2,w,h);
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
  window.__motionSegundos=end;window.__motionFim=false;window.__nivooSceneReady=false;
  window.__motionCore={version:1,mode:'declarative',timeline};
  const sorted=scene.layers.map(l=>{
    // Fotos nunca interpenetram o suporte: sem rotação inclinada no eixo de
    // profundidade e sempre pelo menos 1 unidade à frente do supportZ.
    return {...l,z:l.type==='image'?Math.max(l.z??0,(l.supportZ??-10000)+1):l.z??0};
  }).sort((a,b)=>a.z-b.z);
  window.__renderAt=(time)=>{
    const t=timeline(Number(time)||0);
    ctx.fillStyle=scene.background??'#090402';ctx.fillRect(0,0,canvas.width,canvas.height);
    for(const l of sorted)drawLayer(l,t);
    window.__motionFim=Number(time)>=end;
  };
  Promise.all(Object.keys(binaries).map(key=>new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>{images[key]=img;resolve();};
    img.onerror=()=>reject(new Error('Imagem inválida: '+key));img.src=binaries[key];
  }))).then(()=>{
    window.__nivooSceneReady=true;
    window.__renderAt(0);
    const beginning=performance.now();
    function tick(now){const t=Math.min(end,(now-beginning)/1000);window.__renderAt(t);if(t<end)requestAnimationFrame(tick);}
    requestAnimationFrame(tick);
  }).catch(e=>{window.__nivooSceneError=String(e.message||e)});
}
module.exports={ validateScene,loadScene,sceneDocument,sceneRuntime };
