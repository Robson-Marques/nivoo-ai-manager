import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
/** Metadados e quadros da mídia real para a revisão; não concede aprovação automática. */
export function evidenciasDeVideo(midia:string,worktree:string,criteria:Array<{kind:string;config:unknown}>):string[] {
 const out:string[]=[];const dest=path.join(worktree,'contexto','revisao-midia');let n=0;
 for(const c of criteria){
  if(c.kind!=='FILE_EXISTS')continue;
  const cfg=c.config as {path?:unknown}|null;const name=typeof cfg?.path==='string'?cfg.path:'';
  const m=/^midia\/(entrada|saida)\/([A-Za-z0-9._-]+\.(?:mp4|mov|webm|mkv|m4v))$/i.exec(name);
  if(!m)continue;if(++n>6)break;
  const result:Record<string,unknown>={caminho:name};const thumbs:string[]=[];
  try {
   const root=fs.realpathSync(midia),actual=fs.realpathSync(path.resolve(midia,m[1],m[2]));
   if(!actual.startsWith(root+path.sep))throw new Error('mídia fora do projeto');
   const st=fs.statSync(actual);if(!st.isFile()||!st.size)throw new Error('vídeo ausente/vazio');
   result.existe=true;result.bytes=st.size;
   const p=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height','-of','json',actual],{encoding:'utf8',timeout:12000,maxBuffer:262144});
   if(p.status!==0)throw new Error('ffprobe: '+(p.stderr||p.error?.message||'falha'));
   const info=JSON.parse(p.stdout) as {format?:{duration?:string};streams?:Array<{codec_type?:string}>};
   const seconds=Number(info.format?.duration);result.duracaoSegundos=Number.isFinite(seconds)?seconds:null;
   result.faixas=info.streams??[];result.temAudio=(info.streams??[]).some(s=>s.codec_type==='audio');
   if(Number.isFinite(seconds)&&seconds>0){
    fs.mkdirSync(dest,{recursive:true});
    for(const [i,fraction] of [0.08,0.3,0.58,0.85].entries()){
     const frame=path.join(dest,'video-'+n+'-quadro-'+(i+1)+'.jpg');
     const x=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-ss',String(seconds*fraction),'-i',actual,'-an','-frames:v','1','-vf','scale=540:-2','-q:v','4',frame],{encoding:'utf8',timeout:15000,maxBuffer:65536});
     if(x.status===0&&fs.existsSync(frame)&&fs.statSync(frame).size>0)thumbs.push(path.relative(worktree,frame).split(path.sep).join('/'));
    }
   }
  }catch(err){result.erro=err instanceof Error?err.message:String(err)}
  result.quadros=thumbs;fs.mkdirSync(dest,{recursive:true});
  const report=path.join(dest,'video-'+n+'.json');fs.writeFileSync(report,JSON.stringify(result,null,2));
  out.push(name+' : '+path.relative(worktree,report).split(path.sep).join('/')+'; quadros: '+thumbs.join(', '));
 }
 return out;
}
