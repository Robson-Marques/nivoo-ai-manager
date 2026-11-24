'use strict';
const {finite,color,normalizeMotionProfile,normalizeLayerDimensions,numericRepresentation,motionSeconds,normalizeLayerState,normalizeLayerTimeline}=require('./normalization');
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
module.exports={validateScene};
