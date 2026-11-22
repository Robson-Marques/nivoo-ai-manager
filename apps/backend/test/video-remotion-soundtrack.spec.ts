import { buildRemotionProps } from '../src/video/video-remotion-props';
import { requiredRenderFeatures, assertRendererParity, UNVERIFIED_REMOTION_FEATURES } from '../src/video/video-render-parity';
import { studioToRemotionComposition } from '../src/video/video-studio-conversion';
import type { StudioProject } from '../src/video-studio/video-studio.service';

describe('Studio soundtrack loop across renderer boundaries',()=>{
  const edit:StudioProject={
    version:1,id:'11111111-1111-4111-8111-111111111111',
    title:'Music',updatedAt:'2026-11-22T12:00:00Z',
    clips:[{id:'c',source:'midia/entrada/clip.mp4',start:0,end:3,duration:3}],
    captions:[],assets:[],soundtrack:{source:'midia/entrada/music.mp3',volume:.35},
  };
  it('survives edit conversion, feature gate and props serialization',()=>{
    const {composition,media}=studioToRemotionComposition({
      edit,projectId:'project',width:1080,height:1920,
    });
    expect(requiredRenderFeatures(composition)).toContain('audio-loop');
    expect(()=>assertRendererParity(composition,UNVERIFIED_REMOTION_FEATURES)).toThrow('audio-loop');
    const props=buildRemotionProps(composition,media.map(item=>({
      mediaId:item.id,assetUrl:'/assets/'+item.id+'.mp3',
    })));
    expect(props.layers.find(layer=>layer.id==='soundtrack')).toMatchObject({
      type:'audio',loop:true,volume:.35,durationInFrames:90,
    });
  });
});
