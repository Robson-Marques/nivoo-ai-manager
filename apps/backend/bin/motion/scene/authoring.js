'use strict';
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
function motionAuthorContract(overlay=false) {
  const example=overlay?{...motionAuthorExample,layers:motionAuthorExample.layers.filter(l=>l.type==='image'&&l.id!=='fundo')}:motionAuthorExample;
  return [
    (overlay?'Exemplo de camada de mídia transparente; não é a arte 3D nem contém o fundo. ':'')+
      'Use este exemplo funcional do próprio motor (adapte conteúdo, duração, layout e animações ao briefing; não copie a arte): '+JSON.stringify(example),
    'Tempo: duration, pacing.sourceDuration, openingEnd/openingSeconds, keys[].at e neon start/end em segundos; keys ordenadas e sem tempos duplicados, de 0 até sourceDuration ou duration. Sem timestamps em frames ou milissegundos implícitos.',
    'Coordenadas x/y e dimensões em pixels, origem no canto superior esquerdo; x/y são o centro da camada. z/supportZ ordenam camadas. Opacity 0–1, scale 0.01–20, rotation em graus.',
    'Keyframes animam somente x, y, z, rotation, opacity, scale; easing: linear, smooth, out, back. Informe o estado inicial explicitamente em at:0 quando precisar ocultar uma camada antes da entrada.',
    'image: asset relativo ao scene.json; width/height podem ser auto para manter proporção. text: text, fontSize, font, weight, color, align, width; use camadas separadas para linhas. shape: shape rect/ellipse/roundRect, fill, radius. neon: points [[x,y],...], start/end, color, glow, strokeWidth. Marque required:true em imagens obrigatórias do briefing.',
    'Use profile normal, calm ou energetic; pacing opcional para remapear uma composição de duração original maior. Não invente campos de animação; use os recursos disponíveis no motor.',
  ].join('\n');
}
module.exports={motionAuthorContract,motionAuthorExample};
