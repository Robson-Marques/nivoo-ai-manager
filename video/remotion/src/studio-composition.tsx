import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * The renderer consumes only authorized, bundle-local /assets/ URLs.
 * Project media must be staged by the trusted worker, never by a browser.
 */
type Transform={x:number;y:number;width:number;height:number};
type Word={text:string;startMs:number;endMs:number};
type Layer={
  id:string;type:'video'|'image'|'audio'|'text';src?:string;text?:string;
  fromFrame:number;durationInFrames:number;zIndex:number;volume?:number;sourceOffsetMs?:number;
  transform?:Transform;fontSize?:number;color?:string;animation?:string;words?:Word[];loop?:boolean;
};
export type StudioProps={
  compositionId:string;revision:string;width:number;height:number;fps:number;durationInFrames:number;
  layers:Layer[];protectedZones?:unknown[];
};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const mediaUrl=(src:string)=>{
  if(!/^\/assets\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(src)) throw new Error('Invalid staged media URL');
  return staticFile(src.slice(1));
};
const layerStyle=(t?:Transform):React.CSSProperties=>t?{
  position:'absolute',left:t.x+'%',top:t.y+'%',width:t.width+'%',height:t.height+'%',
}:{position:'absolute',inset:0};
const Caption:React.FC<{layer:Layer}> = ({layer})=>{
  const frame=useCurrentFrame();
  const {fps}=useVideoConfig();
  const progress=clamp(frame/Math.max(1,Math.round(fps*.25)));
  const animation=layer.animation??'none';
  const opacity=['fade','pop','rise','enter-left','enter-right','slide'].includes(animation)?progress:1;
  const translation=animation==='rise'||animation==='slide'?`translateY(${(1-progress)*24}px)`:
    animation==='enter-left'?`translateX(${(progress-1)*50}px)`:
    animation==='enter-right'?`translateX(${(1-progress)*50}px)`:
    animation==='pop'?`scale(${.8+.2*progress})`:undefined;
  const text=animation==='typewriter'
    ? (layer.text??'').slice(0,Math.floor((layer.text??'').length*clamp(frame/Math.max(1,layer.durationInFrames))))
    : layer.text??'';
  const absoluteMs=(layer.fromFrame+frame)*1000/fps;
  const words=animation==='karaoke'&&layer.words?.length?layer.words:null;
  return <div style={{...layerStyle(layer.transform),display:'flex',alignItems:'center',justifyContent:'center',
    padding:24,boxSizing:'border-box',color:layer.color??'#ffffff',fontSize:layer.fontSize??52,
    fontFamily:'Arial, sans-serif',fontWeight:700,textAlign:'center',whiteSpace:'pre-wrap',
    textShadow:'0 2px 9px rgba(0,0,0,.9)',opacity,transform:translation}}>
    <span>{words?words.map((word,i)=><span key={i} style={{
      color:absoluteMs>=word.startMs&&absoluteMs<word.endMs?'#ffdd44':undefined,
    }}>{word.text}{i<words.length-1?' ':''}</span>):text}</span>
  </div>;
};
/** Studio FFmpeg uses a short opacity entrance for images by default,
 * with optional horizontal slide. Keep the motion inside the clip sequence. */
const ImageOverlay:React.FC<{layer:Layer;src:string}> = ({layer,src})=>{
  const frame=useCurrentFrame();
  const {fps,width}=useVideoConfig();
  const animation=layer.animation??'none';
  const durationSeconds=layer.durationInFrames/fps;
  const introSeconds=Math.min(.24,Math.max(.06,durationSeconds/5));
  const progress=clamp(frame/Math.max(1,Math.round(fps*introSeconds)));
  const offset=animation==='slide'?(progress-1)*Math.min(width*.1,75):0;
  return <Img src={src} style={{
    ...layerStyle(layer.transform),objectFit:'contain',
    opacity:animation==='none'?1:progress,
    transform:animation==='slide'?`translateX(${offset}px)`:undefined,
  }}/>;
};
export const StudioComposition:React.FC<StudioProps>=({layers})=>{
  const {fps}=useVideoConfig();
  return <AbsoluteFill style={{backgroundColor:'#000000',overflow:'hidden'}}>
    {[...layers].sort((a,b)=>a.zIndex-b.zIndex||a.id.localeCompare(b.id)).map(layer=>{
      const start=Math.max(0,Math.floor(layer.fromFrame));
      const length=Math.max(1,Math.floor(layer.durationInFrames));
      const trim=Math.round((layer.sourceOffsetMs??0)*fps/1000);
      const src=layer.src?mediaUrl(layer.src):undefined;
      return <Sequence key={layer.id} from={start} durationInFrames={length}>
        {layer.type==='video'&&src&&<div style={layerStyle(layer.transform)}>
          <OffthreadVideo src={src} startFrom={trim}
            volume={layer.volume??1} style={{width:'100%',height:'100%',objectFit:'contain'}} />
        </div>}
        {layer.type==='image'&&src&&<ImageOverlay layer={layer} src={src}/>}
        {layer.type==='audio'&&src&&<Audio src={src} startFrom={trim} loop={layer.loop===true}
          volume={layer.volume??1}/>}
        {layer.type==='text'&&<Caption layer={layer}/>}
      </Sequence>;
    })}
  </AbsoluteFill>;
};
