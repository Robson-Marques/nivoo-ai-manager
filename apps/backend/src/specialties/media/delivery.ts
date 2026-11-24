import { caminhoDoProjeto } from '../../common/path-guard';
import { readMotionInvocations } from '../../jobs/motion/command';

export interface MediaDelivery {
  path:string;
  kind:'video'|'audio';
  width?:number;
  height?:number;
  seconds?:number;
  fps?:number;
  requiresAudio?:boolean;
}
/** The same physical result contract is used by the graph, execution and recovery.
 * Local speech can deliver A and B; Motion can produce more than one clip.
 */
export function mediaDeliveries(provider:string,instructions:string,opts:Record<string,unknown>,key='video'):MediaDelivery[]{
  if(provider==='local-shell')return readMotionInvocations(instructions).flatMap(op=>op.output?[{
    path:op.output,kind:'video' as const,width:op.width,height:op.height,seconds:op.seconds,...(op.fps!==undefined?{fps:op.fps}:{})
  }]:[]);
  const raw=provider==='gemini-video'?opts.arquivo??('videos/'+key+'.mp4'):
    provider==='juntar-videos'?opts.arquivo:provider==='gerar-narracao'?opts.arquivo??'out/previa-locucao.mp3':null;
  const file=caminhoDoProjeto(raw);
  if(!file)return [];
  if(provider==='gerar-narracao'){
    if(!/\.mp3$/i.test(file))return [];
    return [{path:file,kind:'audio'},...(typeof opts.fechamentoAlternativo==='string'&&opts.fechamentoAlternativo.trim()?[{path:file.replace(/\.mp3$/i,'-alternativa.mp3'),kind:'audio' as const}]:[])];
  }
  if(!/\.mp4$/i.test(file))return [];
  return [{path:file,kind:'video',requiresAudio:provider==='juntar-videos'&&!!(opts.trilha||opts.narracao)}];
}
