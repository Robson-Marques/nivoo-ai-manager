import { IMPLEMENTED_REMOTION_FEATURES, assertRendererParity } from '../src/video/video-render-parity';
import { studioToRemotionComposition } from '../src/video/video-studio-conversion';
import type { StudioProject } from '../src/video-studio/video-studio.service';

const base:StudioProject={
  version:1,id:'11111111-1111-4111-8111-111111111111',
  title:'Remotion smoke',updatedAt:'2026-11-22T12:00:00Z',
  clips:[{id:'clip',source:'midia/entrada/clip.mp4',start:1,end:3,duration:2,volume:.6}],
  captions:[{id:'caption',text:'Teste',start:0,end:1,x:.5,y:.8,animation:'fade'}],
  assets:[],audioTracks:[{id:'voice',source:'midia/entrada/voice.mp3',start:0,end:1,offset:0,volume:.8}],
  soundtrack:{source:'midia/entrada/music.mp3',volume:.3},
};
const convert=(edit:StudioProject)=>studioToRemotionComposition({edit,projectId:'p',width:1080,height:1920}).composition;
describe('Remotion pre-update capability contract',()=>{
  it('allows implemented Studio media, captions, and soundtrack to reach the renderer',()=>{
    expect(()=>assertRendererParity(convert(base),IMPLEMENTED_REMOTION_FEATURES)).not.toThrow();
  });
  it('does not claim face/logo protected-zone automation',()=>{
    expect(()=>assertRendererParity(convert({...base,protectedZones:[{
      id:'face',label:'Rosto',start:0,end:1,x:0,y:0,w:.2,h:.2,
    }]}),IMPLEMENTED_REMOTION_FEATURES)).toThrow('protected-zones');
  });
  it('rejects image overlays without explicit no-animation choice',()=>{
    expect(()=>convert({...base,assets:[{
      id:'image',source:'midia/entrada/image.png',start:0,end:1,
      x:0,y:0,w:.3,h:.3,
    }]})).toThrow('animated Studio image');
  });
});
