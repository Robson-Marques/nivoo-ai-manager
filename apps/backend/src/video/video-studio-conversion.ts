import { createHash } from 'node:crypto';
import type { StudioProject } from '../video-studio/video-studio.service';
import { VideoComposition, validateComposition } from './video-composition';
import { ProjectMediaRecord } from './video-project-media';

/**
 * Convert the persisted Studio timeline to a portable Remotion composition.
 * The Studio editor uses seconds and normalized (0..1) positions, whereas
 * the composition contract uses milliseconds and percentage transforms.
 *
 * This is intentionally a pure conversion: the trusted caller resolves the
 * project media paths and validates ownership separately.
 */
export function studioToRemotionComposition(input:{
  edit:StudioProject;projectId:string;width:number;height:number;fps?:number;
}):{composition:VideoComposition;media:ProjectMediaRecord[]} {
  const {edit,projectId,width,height}=input;
  if(!edit||edit.version!==1||!projectId||!Array.isArray(edit.clips)||!edit.clips.length)
    throw new Error('Invalid Studio edit');
  const fps=input.fps??30;
  const ms=(seconds:number)=>Math.round(seconds*1000);
  const total=edit.clips.reduce((sum,clip)=>sum+clip.duration,0);
  if(!Number.isFinite(total)||total<=0||total>3600)
    throw new Error('Remotion compositions currently support up to one hour');
  const durationMs=ms(total);
  if(durationMs>3600000)throw new Error('Remotion composition duration exceeds one hour');
  const layers:VideoComposition['layers']=[];
  const media=new Map<string,ProjectMediaRecord>();
  const register=(source:string)=>{
    if(!/^midia\/(entrada|saida)\/[A-Za-z0-9_.-]+$/.test(source))
      throw new Error('Invalid Studio media source');
    const id='studio_'+createHash('sha256').update(source).digest('hex');
    if(!media.has(id))media.set(id,{id,projectId,assetUrl:'/'+source});
    return id;
  };
  const transform=(x:number,y:number,w:number,h:number)=>({
    x:x*100,y:y*100,width:w*100,height:h*100,
  });
  let cursor=0;
  edit.clips.forEach((clip,i)=>{
    if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||!Number.isFinite(clip.duration))throw new Error('Invalid Studio clip timing');
    const duration=ms(clip.duration);
    if(duration<=0||Math.abs(clip.end-clip.start-clip.duration)>.1)
      throw new Error('Invalid Studio clip timing');
    layers.push({id:'clip_'+i,type:'video',mediaId:register(clip.source),
      startMs:ms(cursor),durationMs:Math.min(duration,durationMs-ms(cursor)),zIndex:0,sourceOffsetMs:ms(clip.start),
      volume:clip.volume??1});
    cursor+=clip.duration;
  });
  for(const [i,asset] of (edit.assets??[]).entries()){
    layers.push({id:'asset_'+i,type:'image',mediaId:register(asset.source),
      startMs:ms(asset.start),durationMs:ms(asset.end-asset.start),zIndex:20,
      transform:transform(asset.x,asset.y,asset.w,asset.h)});
  }
  for(const [i,caption] of (edit.captions??[]).entries()){
    const x=Math.max(0,caption.x-.4),y=Math.max(0,caption.y-.065);
    const w=Math.min(.8,1-x),h=Math.min(.13,1-y);
    layers.push({id:'caption_'+i,type:'text',text:caption.text,
      startMs:ms(caption.start),durationMs:ms(caption.end-caption.start),zIndex:30,
      animation:caption.animation??'none',fontSize:caption.fontSize??54,
      ...(caption.color?{color:caption.color}:{}),
      transform:transform(x,y,w,h),
      ...(caption.words?.length?{words:caption.words.map(word=>({
        text:word.text,startMs:ms(word.start),endMs:ms(word.end),
      }))}:{}),
    });
  }
  for(const [i,track] of (edit.audioTracks??[]).entries()){
    layers.push({id:'audio_'+i,type:'audio',mediaId:register(track.source),
      startMs:ms(track.offset),durationMs:ms(track.end-track.start),zIndex:10,
      sourceOffsetMs:ms(track.start),volume:track.volume});
  }
  if(edit.soundtrack) {
    // A looping soundtrack is currently rendered by the FFmpeg export path.
    // Remotion must not silently truncate the music when the source is shorter.
    throw new Error('Looping Studio soundtrack requires Remotion loop parity');
  }
  const protectedZones=(edit.protectedZones??[]).map(z=>({
    id:z.id,label:z.label,startMs:ms(z.start),durationMs:ms(z.end-z.start),
    x:z.x*100,y:z.y*100,width:z.w*100,height:z.h*100,
  }));
  const composition:VideoComposition={
    schemaVersion:1,id:edit.id,revision:edit.updatedAt,width,height,fps,durationMs,
    layers,...(protectedZones.length?{protectedZones}:{}),
  };
  validateComposition(composition);
  return {composition,media:[...media.values()]};
}
