import { useEffect, useState } from 'react';

type Frames=string[];
const cache=new Map<string,Promise<Frames>>();
const LIMIT=36;
function thumbs(src:string,start:number,end:number):Promise<Frames>{
  const key=src+'|'+start.toFixed(2)+'|'+end.toFixed(2);
  const found=cache.get(key);
  if(found)return found;
  const promise=new Promise<Frames>((resolve,reject)=>{
    const video=document.createElement('video');
    video.preload='metadata';
    video.muted=true;
    video.playsInline=true;
    const pictures:string[]=[];
    const positions=[.14,.50,.86];
    let index=0,finished=false;
    const clear=()=>{
      video.onloadedmetadata=null;
      video.onseeked=null;
      video.onerror=null;
      video.removeAttribute('src');
      video.load();
      window.clearTimeout(timer);
    };
    const finish=(error?:Error)=>{
      if(finished)return;
      finished=true;clear();
      if(error&&!pictures.length)reject(error);
      else resolve(pictures);
    };
    const timer=window.setTimeout(()=>finish(new Error('Tempo limite das miniaturas')),18000);
    video.onerror=()=>finish(new Error('Formato não compatível com miniatura'));
    video.onloadedmetadata=()=>{
      if(!Number.isFinite(video.duration)||video.duration<=0)return finish(new Error('Duração inválida'));
      next();
    };
    const next=()=>{
      if(index>=positions.length)return finish();
      const t=Math.min(video.duration-.05,Math.max(0,start+(end-start)*positions[index]));
      index++;
      try{video.currentTime=t}catch{finish(new Error('Falha ao posicionar o vídeo'))}
    };
    video.onseeked=()=>{
      try{
        const canvas=document.createElement('canvas');
        canvas.width=128;canvas.height=72;
        const ctx=canvas.getContext('2d');
        if(ctx){ctx.drawImage(video,0,0,128,72);pictures.push(canvas.toDataURL('image/jpeg',.60))}
      }catch{/* o clipe continua editável sem miniatura */}
      next();
    };
    video.src=src;
  }).catch(e=>{cache.delete(key);throw e});
  if(cache.size>=LIMIT)cache.delete(cache.keys().next().value!);
  cache.set(key,promise);
  return promise;
}
/** Miniaturas não destrutivas; a timeline continua utilizável enquanto carrega. */
export function StudioFilmstrip({src,start,end}:{src:string;start:number;end:number}){
  const [frames,setFrames]=useState<Frames>([]);
  useEffect(()=>{
    let alive=true;
    // Evita dezenas de decodificações durante um arraste contínuo da borda.
    // Só solicita novas miniaturas depois que o ponteiro estabiliza.
    const timer=window.setTimeout(()=>{
      if(end-start>.1)thumbs(src,start,end).then(images=>{if(alive)setFrames(images)}).catch(()=>{});
    },380);
    return()=>{alive=false;window.clearTimeout(timer)};
  },[src,start,end]);
  if(!frames.length)return null;
  return <span className="studio-filmstrip" aria-hidden="true">
    {frames.map((url,i)=><img key={i} src={url} alt="" draggable={false}/>)}
  </span>;
}
