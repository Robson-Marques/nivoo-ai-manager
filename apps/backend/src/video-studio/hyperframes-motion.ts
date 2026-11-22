import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertWorkspacePath, runVideoTool } from '../video/video-tool-adapters';
import { inspectRenderedVideo } from '../video/video-render-inspection';

export type MotionPreset = 'kinetic-title'|'neon-title'|'brush-reveal'|'zoom-impact'|'slide-reveal'|'soft-fade';
export type MotionPresetInfo = {
  id:MotionPreset;label:string;description:string;category:'title'|'light'|'transition';
  durationSeconds:3.2;origin:'nivoo-reviewed';version:1;
};
export const MOTION_PRESETS: ReadonlyArray<MotionPresetInfo> = Object.freeze([
  {id:'kinetic-title',label:'Título cinético',description:'Entrada rápida de tipografia',category:'title',durationSeconds:3.2,origin:'nivoo-reviewed',version:1},
  {id:'neon-title',label:'LED / Neon',description:'Brilho luminoso pulsante',category:'light',durationSeconds:3.2,origin:'nivoo-reviewed',version:1},
  {id:'brush-reveal',label:'Pincelada',description:'Destaque amarelo atrás do título',category:'transition',durationSeconds:3.2,origin:'nivoo-reviewed',version:1},
  {id:'zoom-impact',label:'Zoom de impacto',description:'Título cresce com entrada de impacto',category:'title',durationSeconds:3.2,origin:'nivoo-reviewed',version:1},
  {id:'slide-reveal',label:'Revelação lateral',description:'Texto entra pela lateral com máscara',category:'transition',durationSeconds:3.2,origin:'nivoo-reviewed',version:1},
  {id:'soft-fade',label:'Fade elegante',description:'Entrada e saída suaves com leve movimento',category:'transition',durationSeconds:3.2,origin:'nivoo-reviewed',version:1},
]);
const escapeHtml=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function validateMotionRequest(body:unknown):{preset:MotionPreset;title:string}{
  if(!body || typeof body!=='object' || Array.isArray(body))throw new Error('Pedido de motion inválido');
  const value=body as Record<string,unknown>;
  if(typeof value.preset!=='string'||!MOTION_PRESETS.some(p=>p.id===value.preset))
    throw new Error('Modelo de motion desconhecido');
  if(typeof value.title!=='string'||!value.title.trim()||value.title.trim().length>100||
    /[\u0000-\u001f\u007f]/.test(value.title))throw new Error('Título inválido');
  return {preset:value.preset as MotionPreset,title:value.title.trim()};
}
export function trustedMotionHtml(preset:MotionPreset,title:string):string{
  const value=validateMotionRequest({preset,title});
  // GSAP drives the clock deterministically. Ordinary CSS keyframe animations
  // are not a substitute for a paused, registered HyperFrames timeline.
  const timelines:Record<MotionPreset,string>={
    'kinetic-title':"tl.fromTo(title,{opacity:0,y:110,scale:.86},{opacity:1,y:0,scale:1,duration:.75,ease:'power3.out'},.12);tl.to(title,{opacity:0,y:-26,duration:.38},2.77);",
    'neon-title':"tl.fromTo(title,{opacity:0,filter:'blur(18px)'},{opacity:1,filter:'blur(0px)',duration:.62},.12);tl.to(title,{textShadow:'0 0 6px #fff,0 0 24px #33ddff,0 0 66px #33ddff',duration:.44},1.05);tl.to(title,{opacity:0,duration:.4},2.75);",
    'brush-reveal':"tl.fromTo(brush,{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:.65,ease:'power2.out'},.12);tl.fromTo(title,{opacity:0,y:24},{opacity:1,y:0,duration:.48},.30);tl.to(title,{opacity:0,duration:.38},2.76);",
    'zoom-impact':"tl.fromTo(title,{opacity:0,scale:2.05,filter:'blur(14px)'},{opacity:1,scale:1,filter:'blur(0px)',duration:.73,ease:'power3.out'},.12);tl.to(title,{scale:1.07,duration:1.6,ease:'none'},1);tl.to(title,{opacity:0,duration:.35},2.78);",
    'slide-reveal':"tl.fromTo(title,{opacity:0,x:-65,clipPath:'inset(0 100% 0 0)'},{opacity:1,x:0,clipPath:'inset(0 0% 0 0)',duration:.85,ease:'power2.out'},.12);tl.to(title,{opacity:0,duration:.35},2.78);",
    'soft-fade':"tl.fromTo(title,{opacity:0,y:32},{opacity:1,y:0,duration:.85,ease:'power2.out'},.18);tl.to(title,{y:-9,duration:1.25,ease:'none'},1.13);tl.to(title,{opacity:0,duration:.5},2.70);",
  };
  return [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}',
    'body{background:#0a1224;color:#fff;font-family:Arial,Helvetica,sans-serif}',
    '#stage{position:relative;width:540px;height:960px;overflow:hidden;background:#0a1224}',
    '.clip{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}',
    '#title{position:relative;z-index:2;max-width:95%;font-size:64px;font-weight:900;line-height:1.06;text-align:center;letter-spacing:-1px;overflow-wrap:anywhere}',
    '#brush{position:absolute;top:50%;left:10%;width:80%;height:15%;background:#ffd83c;z-index:1;transform-origin:left center}',
    value.preset==='neon-title'?'#title{color:#eaffff}':'',
    '</style></head><body>',
    '<main id="stage" data-composition-id="nivoo-motion" data-start="0" data-width="540" data-height="960" data-fps="24" data-duration="3.2">',
    '<div id="scene" class="clip" data-start="0" data-duration="3.2" data-track-index="0">',
    '<div id="brush"></div><div id="title">',escapeHtml(value.title),'</div></div></main>',
    '<script src="gsap.min.js"></script>',
    '<script>(function(){if(typeof gsap==="undefined")throw new Error("GSAP local ausente");',
    'const title=document.getElementById("title");const brush=document.getElementById("brush");',
    'const tl=gsap.timeline({paused:true});',timelines[value.preset],
    'window.__timelines=window.__timelines||{};window.__timelines["nivoo-motion"]=tl;tl.seek(0);',
    '})();</script></body></html>',
  ].join('');
}
export type MotionRenderOutput={output:string;durationMs:number;warnings:string[]};
/** Only server-authored HTML; never execute user-supplied HTML/JS or remote media. */
export async function renderTrustedMotion(input:{
  media:string;editId:string;runId:string;preset:MotionPreset;title:string;
},signal?:AbortSignal):Promise<MotionRenderOutput>{
  validateMotionRequest(input);
  if(!/^[a-f\d-]{36}$/i.test(input.editId)||!/^[a-f\d-]{36}$/i.test(input.runId))
    throw new Error('ID de renderização inválido');
  const root=fs.realpathSync(input.media);
  const work=assertWorkspacePath(root,path.join(root,'studio','motion-jobs'));
  fs.mkdirSync(work,{recursive:true,mode:0o700});
  assertWorkspacePath(root,fs.realpathSync(work));
  const job=fs.mkdtempSync(path.join(work,'motion-'));
  const outputDir=assertWorkspacePath(root,path.join(root,'saida'));
  fs.mkdirSync(outputDir,{recursive:true});
  assertWorkspacePath(root,fs.realpathSync(outputDir));
  const name='motion-'+input.editId+'-'+input.runId+'.mp4';
  const final=path.join(outputDir,name);
  const partial=path.join(outputDir,'.'+name+'.partial.mp4');
  try{
    const gsapSource='/opt/nivoo/hyperframes/node_modules/gsap/dist/gsap.min.js';
    const gsapInfo=fs.statSync(gsapSource);
    if(!gsapInfo.isFile()||gsapInfo.size<10000)throw new Error('Runtime GSAP local não provisionado');
    fs.copyFileSync(gsapSource,path.join(job,'gsap.min.js'));
    fs.writeFileSync(path.join(job,'index.html'),trustedMotionHtml(input.preset,input.title),{flag:'wx',mode:0o600});
    if(signal?.aborted)throw new Error('Prévia cancelada');
    const result=await runVideoTool('hyperframes',[
      'render','--output',partial,'--format','mp4','--quality','draft',
      '--workers','1','--strict','--refuse-outside-files','--quiet',
    ],job,240_000,signal,{
      PATH:'/usr/local/bin:/opt/nivoo/node/bin:'+(process.env.PATH??'/usr/bin:/bin'),
      HOME:process.env.HOME??'/var/lib/nivoo',
      LANG:process.env.LANG??'C.UTF-8',
      HYPERFRAMES_NO_UPDATE_CHECK:'1',HYPERFRAMES_SKIP_SKILLS:'1',
      HYPERFRAMES_NO_TELEMETRY:'1',DO_NOT_TRACK:'1',
      PRODUCER_RESTRICT_PAGE_NETWORK:'1',
    });
    if(result.exitCode!==0)throw new Error('HyperFrames falhou: '+result.stderr.slice(-500));
    const checked=await inspectRenderedVideo(root,partial,signal);
    if(!checked.outputExists||checked.durationMs===undefined||
      Math.abs(checked.durationMs-3200)>750||checked.hasAudio!==false)
      throw new Error('Prévia fora da duração esperada ou com áudio inesperado');
    if(signal?.aborted)throw new Error('Prévia cancelada');
    fs.linkSync(partial,final);
    return {output:'midia/saida/'+name,durationMs:checked.durationMs,
      warnings:checked.blackFrameCount?['Trecho preto detectado na prévia']:[]};
  }finally{
    fs.rmSync(partial,{force:true});
    fs.rmSync(job,{recursive:true,force:true});
  }
}
