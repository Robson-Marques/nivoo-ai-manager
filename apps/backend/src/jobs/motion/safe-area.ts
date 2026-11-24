import { readMotionInvocation } from './command';
import type { RawStep } from './types';
import { isComposer } from './authoring';
import { nativeImageTarget } from '../../providers/codex-image-assets';

/** Conservative house profile, not a guarantee about a changing app UI.
 * The 1080x1920 reference reserves extra space for feed previews and right rail.
 * Background and nonessential decoration remain full bleed. */
export const REELS_SAFE_PROFILE={width:1080,height:1920,left:90,right:180,top:300,bottom:672} as const;
export function reelsSafeArea(width:number,height:number){
  const p=REELS_SAFE_PROFILE;
  const left=Math.ceil(width*p.left/p.width),right=Math.ceil(width*p.right/p.width);
  const top=Math.ceil(height*p.top/p.height),bottom=Math.ceil(height*p.bottom/p.height);
  return {left,right,top,bottom,x:left,y:top,width:width-left-right,height:height-top-bottom,xMax:width-right,yMax:height-bottom};
}
export function reelsIntent(text:string):boolean{
  return /\breels?\b|\binstagram\s+(?:vertical|9\s*:\s*16)\b/i.test(text);
}
export function portraitSocialIntent(text:string):boolean{
  if(/\b(?:stories|story|status|tiktok|shorts|tel[aã]o|painel|wallpaper)\b/i.test(text)&&!reelsIntent(text))return false;
  return /\b(?:instagram|publicidade|publicit[aá]ri[oa]|an[uú]ncio|campanha|promocional|promo[çc][aã]o|redes sociais|postagem|teaser|divulga[çc][aã]o)\b/i.test(text);
}
export const REELS_SAFE_MARKER='[NIVOO_REELS_SAFE_AREA_V1]';
export function reelsSafeContract(width=1080,height=1920):string{
  const a=reelsSafeArea(width,height);
  return REELS_SAFE_MARKER+' Perfil conservador de publicação Reels '+width+'x'+height+
    ': área segura x='+a.x+' até '+a.xMax+', y='+a.y+' até '+a.yMax+
    ' ('+a.width+'x'+a.height+'). Margens esquerda '+a.left+', direita '+a.right+', topo '+a.top+', base '+a.bottom+' px. '+
    'O fundo, chuva, partículas, sombras e decoração não essencial podem preencher todo o canvas. '+
    'Logo, textos, preço, CTA e região indispensável do produto ficam integralmente dentro da área segura enquanto devem ser vistos, incluindo escala, rotação, perspectiva e overshoot da animação. '+
    'Na arte final de referência, respeite estas margens já na composição; se a referência fornecida exceder a zona, preserve sua identidade e reorganize os elementos. '+
    'Para PNG isolado transparente, não aplique a margem da tela ao arquivo: preserve o objeto inteiro e encaixe-o na área segura durante a composição. Para fundo puro use tela inteira. '+
    'No HTML crie um contêiner absoluto de conteúdo seguro com left:'+a.left+'px; top:'+a.top+'px; width:'+a.width+'px; height:'+a.height+'px; (ou coordenadas proporcionais se o viewport for escalado). '+
    'No scene.json/overlays.json use os limites equivalentes nas coordenadas da cena, incluindo as dimensões e keyframes. Não use overflow:hidden como substituto de posicionamento; não encolha o vídeo inteiro, nem desenhe as guias no MP4. '+
    'O autor controla as margens durante o trabalho existente; não adicionar etapa de revisão ou render extra.';
}
const options=(s:RawStep)=>(s.providerOptions??{}) as Record<string,unknown>;
function append(step:RawStep,contract:string):void{
  const old=String(step.instructions??'');
  if(!old.includes(REELS_SAFE_MARKER))step.instructions=old+'\n\n'+contract;
}
/** Propagate a single coordinate system to the actual author and its upstream
 * image assets. Never modify an existing render-only plan or unrelated scene. */
export function applyReelsSafeArea(raw:unknown,defaultProvider:string,objective:string):unknown{
  if(!Array.isArray(raw))return raw;
  const steps=raw.map(s=>s&&typeof s==='object'?{...s}:s) as RawStep[];
  const byKey=new Map(steps.filter(s=>s&&typeof s==='object'&&typeof s.key==='string').map(s=>[String(s.key),s]));
  const deps=(s:RawStep)=>Array.isArray(s.dependsOn)?s.dependsOn.map(String):[];
  const image=(s:RawStep)=>!!nativeImageTarget(options(s).visualAsset)||String(s.provider??defaultProvider)==='gemini-image';
  let foundRender=false;
  for(const render of steps){
    if(!render||typeof render!=='object'||String(render.provider??defaultProvider)!=='local-shell')continue;
    const invocation=readMotionInvocation(String(render.instructions??''));
    if(!invocation)continue;
    foundRender=true;
    const authors=deps(render).map(k=>byKey.get(k)).filter((s):s is RawStep=>!!s&&!image(s)&&isComposer(s)&&String(s.provider??defaultProvider)!=='local-shell');
    if(!authors.length)continue;
    const text=[objective,String(render.title??''),...authors.map(s=>String(s.instructions??'').split('[NIVOO_MOTION_CORE_CONTRACT_V1]')[0].split(REELS_SAFE_MARKER)[0])].join(' ');
    const w=invocation.width??1080,h=invocation.height??1920;
    if(Math.abs(w/h-9/16)>.025||!(reelsIntent(text)||portraitSocialIntent(text)))continue;
    const contract=reelsSafeContract(w,h);
    for(const author of authors){
      append(author,contract);
      const seen=new Set<string>();
      const queue=deps(author);
      while(queue.length){
        const key=queue.pop()!;
        if(seen.has(key))continue;
        seen.add(key);
        const producer=byKey.get(key);
        if(!producer)continue;
        if(image(producer))append(producer,contract);
        queue.push(...deps(producer));
      }
    }
  }
  // A standalone Reels cover/key visual has no motion render.
  if(!foundRender&&reelsIntent(objective))for(const s of steps)if(s&&typeof s==='object'&&image(s))append(s,reelsSafeContract());
  return steps;
}
