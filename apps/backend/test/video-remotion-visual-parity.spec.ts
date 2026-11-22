import { studioToRemotionComposition } from '../src/video/video-studio-conversion';
import type { StudioProject } from '../src/video-studio/video-studio.service';

const base:StudioProject={
  version:1,id:'11111111-1111-4111-8111-111111111111',
  title:'Parity guard',updatedAt:'2026-11-22T12:00:00.000Z',
  clips:[{id:'c',source:'midia/entrada/a.mp4',start:0,end:3,duration:3}],
  captions:[],assets:[],
};
describe('Remotion visual parity guard',()=>{
  it('rejects unsupported image entrance effects instead of silently dropping them',()=>{
    expect(()=>studioToRemotionComposition({edit:{...base,assets:[{
      id:'overlay',source:'midia/entrada/a.png',start:0,end:2,
      x:0,y:0,w:1,h:1,animation:'fade',
    }]},projectId:'p',width:1080,height:1920})).toThrow(/animated Studio image/);
  });
  it('retains still image overlays',()=>{
    const {composition}=studioToRemotionComposition({edit:{...base,assets:[{
      id:'overlay',source:'midia/entrada/a.png',start:0,end:2,
      x:0,y:0,w:1,h:1,animation:'none',
    }]},projectId:'p',width:1080,height:1920});
    expect(composition.layers.find(layer=>layer.id==='asset_0')?.type).toBe('image');
  });
});
