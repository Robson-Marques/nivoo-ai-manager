import { useEffect, useMemo, useState } from 'react';
import { apiBlob } from '../api';

/** Onda visual do áudio real. Uma decodificação compartilhada por fonte,
 * limitada a áudios de tamanho razoável; falhas mantêm a faixa editável. */
const cached=new Map<string,Promise<{duration:number;peaks:number[]}>>();
const MAX_CACHE=24;
async function decode(src:string):Promise<{duration:number;peaks:number[]}>{
  const pathname=new URL(src,window.location.origin);
  const blob=await apiBlob(pathname.pathname.replace(/^\/api/,'')+pathname.search);
  // Descompactar MP3 muito grande pode consumir centenas de MB no navegador.
  if(blob.size>10*1024*1024)throw new Error('Áudio grande: onda indisponível');
  const ctx=new AudioContext();
  try{
    const buffer=await ctx.decodeAudioData(await blob.arrayBuffer());
    const channel=buffer.getChannelData(0);
    const buckets=512;
    const peaks:number[]=[];
    for(let i=0;i<buckets;i++){
      const a=Math.floor(i*channel.length/buckets);
      const b=Math.min(channel.length,Math.floor((i+1)*channel.length/buckets));
      const stride=Math.max(1,Math.floor((b-a)/128));
      let peak=0;
      for(let p=a;p<b;p+=stride)peak=Math.max(peak,Math.abs(channel[p]));
      peaks.push(Math.min(1,peak*1.5));
    }
    return {duration:buffer.duration,peaks};
  }finally{await ctx.close()}
}
function load(src:string){
  let item=cached.get(src);
  if(!item){
    item=decode(src).catch(e=>{cached.delete(src);throw e});
    if(cached.size>=MAX_CACHE)cached.delete(cached.keys().next().value!);
    cached.set(src,item);
  }
  return item;
}
export function StudioWaveform({src,start,end}:{src:string;start:number;end:number}){
  const [info,setInfo]=useState<{duration:number;peaks:number[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;
    if(!src){setInfo(null);return}
    load(src).then(value=>{if(!cancelled)setInfo(value)}).catch(()=>{if(!cancelled)setInfo(null)});
    return()=>{cancelled=true};
  },[src]);
  const bars=useMemo(()=>{
    if(!info||end<=start)return [];
    const count=48;
    return Array.from({length:count},(_,i)=>{
      const position=start+(end-start)*(i+.5)/count;
      const index=Math.max(0,Math.min(info.peaks.length-1,Math.floor(position/info.duration*info.peaks.length)));
      return info.peaks[index]||.03;
    });
  },[info,start,end]);
  if(!bars.length)return null;
  return <svg className="studio-waveform" viewBox="0 0 192 32" preserveAspectRatio="none" aria-hidden="true">
    {bars.map((h,i)=><rect key={i} x={i*4+1} y={16-Math.max(1,h*14)} width="2.5" height={Math.max(2,h*28)} rx=".6" fill="#9ef6df"/>)}
  </svg>;
}
