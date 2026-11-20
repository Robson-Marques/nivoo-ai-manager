import { useEffect, useRef, useState } from 'react';
import { apiBlob } from '../api';

/** Byte cache: shared by cards and player, no request when the user does not hover. */
const urls=new Map<string,Promise<string>>();
function source(path:string):Promise<string>{
  let cached=urls.get(path);
  if(!cached){
    cached=apiBlob(path).then(blob=>{
      if(!blob.type.includes('video')||blob.size<1000)throw new Error('Prévia indisponível');
      return URL.createObjectURL(blob);
    }).catch(e=>{urls.delete(path);throw e});
    urls.set(path,cached);
  }
  return cached;
}

type Props={path:string;type:string;duration:number;large?:boolean;label:string};

/**
 * Exact FFmpeg xfade render. Small cards fetch lazily on hover/focus,
 * larger preview autoplays while selected. Duration controls playback speed.
 */
export function StudioTransitionDemo({path,type,duration,large=false,label}:Props){
  const [active,setActive]=useState(large);
  const [url,setUrl]=useState('');
  const [failed,setFailed]=useState(false);
  const ref=useRef<HTMLVideoElement>(null);

  useEffect(()=>{setActive(large);setFailed(false);setUrl('')},[type,path,large]);
  useEffect(()=>{
    if(!active)return;
    let cancelled=false;
    source(path+'/transitions/preview/'+encodeURIComponent(type))
      .then(next=>{if(!cancelled){setUrl(next);setFailed(false)}})
      .catch(()=>{if(!cancelled)setFailed(true)});
    return ()=>{cancelled=true};
  },[active,path,type]);
  useEffect(()=>{
    const player=ref.current;
    if(!player||!url)return;
    player.playbackRate=Math.max(.5,Math.min(10,1/Math.max(.1,duration)));
    if(active){player.currentTime=0;void player.play().catch(()=>undefined)}
    else player.pause();
  },[url,active,duration]);

  return <div className={'studio-effect-demo'+(large?' studio-effect-demo-large':'')}
    onMouseEnter={()=>setActive(true)} onMouseLeave={()=>{if(!large)setActive(false)}}
    onFocus={()=>setActive(true)} onBlur={()=>{if(!large)setActive(false)}}
    aria-label={'Prévia da transição '+label}>
    <div className="studio-effect-demo-poster" aria-hidden="true">
      <span className="studio-effect-demo-a">A</span><span className="studio-effect-demo-b">B</span>
    </div>
    {url&&<video ref={ref} src={url} muted playsInline loop preload="metadata"
      aria-label={'Demonstração animada: '+label}
      onLoadedData={e=>{e.currentTarget.playbackRate=Math.max(.5,Math.min(10,1/Math.max(.1,duration)));if(active)void e.currentTarget.play().catch(()=>undefined)}}
    />}
    {failed&&<span className="studio-effect-demo-error">Prévia indisponível</span>}
    {!large&&!active&&<span className="studio-effect-demo-hover">▶</span>}
  </div>;
}
