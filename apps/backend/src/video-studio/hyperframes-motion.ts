import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertWorkspacePath, runVideoTool } from '../video/video-tool-adapters';
import { inspectRenderedVideo } from '../video/video-render-inspection';

export type MotionPreset = 'kinetic-title'|'neon-title'|'brush-reveal';
export const MOTION_PRESETS: ReadonlyArray<{id:MotionPreset;label:string;description:string}> = [
  {id:'kinetic-title',label:'Título cinético',description:'Entrada rápida de tipografia'},
  {id:'neon-title',label:'LED / Neon',description:'Brilho luminoso pulsante'},
  {id:'brush-reveal',label:'Pincelada',description:'Destaque amarelo atrás do título'},
];
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
  const animation:Record<MotionPreset,string>={
    'kinetic-title':'@keyframes enter{0%{opacity:0;transform:translateY(110px) scale(.86)}30%{opacity:1;transform:translateY(0) scale(1)}85%{opacity:1}100%{opacity:0}} #title{animation:enter 3.2s ease-in-out both}',
    'neon-title':'@keyframes enter{0%{opacity:0;filter:blur(18px)}25%{opacity:1;filter:blur(0)}55%{text-shadow:0 0 6px #fff,0 0 27px #33ddff,0 0 85px #33ddff}85%{opacity:1}100%{opacity:0}} #title{color:#eaffff;animation:enter 3.2s ease both}',
    'brush-reveal':'@keyframes paint{0%{transform:scaleX(0)}35%,100%{transform:scaleX(1)}} @keyframes words{0%,12%{opacity:0;transform:translateY(25px)}42%,85%{opacity:1;transform:translateY(0)}100%{opacity:0}} #title{position:relative;animation:words 3.2s ease both} #title:before{content:"";position:absolute;z-index:-1;left:-5%;top:49%;width:110%;height:48%;background:#ffd83c;transform-origin:left;animation:paint 3.2s ease both}',
  };
  return [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}',
    'body{background:#0a1224;color:#fff;font-family:Arial,Helvetica,sans-serif}',
    '#stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '#title{max-width:88%;font-size:64px;font-weight:900;line-height:1.06;text-align:center;letter-spacing:-1px;overflow-wrap:anywhere}',
    animation[value.preset],'</style></head><body>',
    '<main id="stage" data-composition-id="nivoo-motion" data-start="0" data-width="540" data-height="960" data-fps="24" data-duration="3.2">',
    '<div id="title" class="clip" data-start="0" data-duration="3.2" data-track-index="0">',
    escapeHtml(value.title),'</div></main></body></html>',
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
    fs.writeFileSync(path.join(job,'index.html'),trustedMotionHtml(input.preset,input.title),{flag:'wx',mode:0o600});
    if(signal?.aborted)throw new Error('Prévia cancelada');
    const result=await runVideoTool('hyperframes',[
      'render','--output',partial,'--format','mp4','--quality','draft',
      '--workers','1','--strict','--refuse-outside-files','--quiet',
    ],job,240_000,signal,{
      PATH:process.env.PATH??'/usr/local/bin:/usr/bin:/bin',
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
