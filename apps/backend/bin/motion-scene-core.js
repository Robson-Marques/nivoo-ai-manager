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
  const { scene, assets } = validateScene(parsed);
  const binaries = {}, warnings = [];
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
      drawnImages++;
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
      loaded:0,drawnAtLastFrame:0,lastTime:0,
    };
  }
  window.__motionCore={version:1,mode:overlay?'webgl-overlay':'declarative',timeline};
  const sorted=scene.layers.map(l=>{
    // Fotos nunca interpenetram o suporte: sem rotação inclinada no eixo de
    // profundidade e sempre pelo menos 1 unidade à frente do supportZ.
    return {...l,z:l.type==='image'?Math.max(l.z??0,(l.supportZ??-10000)+1):l.z??0};
  }).sort((a,b)=>a.z-b.z);
  let drawnImages=0;
  const drawAt=(time)=>{
    const t=timeline(Number(time)||0);
    drawnImages=0;
    if(overlay){ctx.clearRect(0,0,canvas.width,canvas.height);}
    else {ctx.fillStyle=scene.background??'#090402';ctx.fillRect(0,0,canvas.width,canvas.height);}
    for(const l of sorted)drawLayer(l,t);
    if(overlay) {
      window.__nivooOverlayStats.loaded=Object.keys(images).length;
      window.__nivooOverlayStats.drawnAtLastFrame=drawnImages;
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
    img.onerror=()=>{console.warn('[NIVO_MOTION] imagem não carregou, mantendo demais camadas: '+key.slice(0,120));resolve();};
    img.src=binaries[key];
  }))).then(()=>{
    if(overlay)window.__nivooOverlayReady=true;
    else window.__nivooSceneReady=true;
    drawAt(0);
    const beginning=performance.now();
    function tick(now){const t=Math.min(end,(now-beginning)/1000);drawAt(t);if(t<end)requestAnimationFrame(tick);}
    requestAnimationFrame(tick);
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
module.exports={ validateScene,loadScene,sceneDocument,overlayScript,sceneRuntime,checkMotionSource };
