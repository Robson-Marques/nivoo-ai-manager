'use strict';
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
module.exports={sceneRuntime};
