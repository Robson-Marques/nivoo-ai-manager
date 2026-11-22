import { studioToRemotionComposition } from '../src/video/video-studio-conversion';
import { buildRemotionProps } from '../src/video/video-remotion-props';
import { assertRendererParity, IMPLEMENTED_REMOTION_FEATURES } from '../src/video/video-render-parity';
import type { StudioProject } from '../src/video-studio/video-studio.service';

const base:StudioProject={
  version:1,id:'11111111-1111-4111-8111-111111111111',
  title:'Image animations',updatedAt:'2026-11-22T12:00:00.000Z',
  clips:[{id:'c',source:'midia/entrada/a.mp4',start:0,end:3,duration:3}],
  captions:[],assets:[],
};
describe('Remotion Studio image animation parity',()=>{
  it.each(['fade','slide','none'] as const)('preserves %s through composition and render props',animation=>{
    const {composition,media}=studioToRemotionComposition({edit:{...base,assets:[{
      id:'overlay',source:'midia/entrada/a.png',start:0,end:2,
      x:0,y:0,w:1,h:1,animation,
    }]},projectId:'p',width:1080,height:1920});
    expect(()=>assertRendererParity(composition,IMPLEMENTED_REMOTION_FEATURES)).not.toThrow();
    const props=buildRemotionProps(composition,media.map(m=>({mediaId:m.id,assetUrl:'/assets/'+m.id+'.png'})));
    expect(props.layers.find(l=>l.id==='asset_0')).toMatchObject({type:'image',animation});
  });
  it('treats unspecified animation like FFmpeg default fade',()=>{
    const {composition}=studioToRemotionComposition({edit:{...base,assets:[{
      id:'overlay',source:'midia/entrada/a.png',start:0,end:2,
      x:0,y:0,w:1,h:1,
    }]},projectId:'p',width:1080,height:1920});
    expect(composition.layers.find(l=>l.id==='asset_0')).toMatchObject({animation:'fade'});
  });
});
