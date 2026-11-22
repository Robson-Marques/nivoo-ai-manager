import { studioToRemotionComposition } from '../src/video/video-studio-conversion';
import type { StudioProject } from '../src/video-studio/video-studio.service';
describe('Studio Remotion timeline boundaries',()=>{
  const edit:StudioProject={version:1,id:'11111111-1111-4111-8111-111111111111',title:'test',
    updatedAt:'2026-11-22T12:00:00Z',
    clips:[{id:'clip',source:'midia/entrada/clip.mp4',start:0,end:3,duration:3}],
    captions:[{id:'caption',text:'hi',start:2.5,end:4,x:.5,y:.5}],
    assets:[{id:'asset',source:'midia/entrada/asset.png',start:2,end:4,x:0,y:0,w:.5,h:.5}],
    audioTracks:[{id:'audio',source:'midia/entrada/voice.mp3',start:0,end:2,offset:2,volume:1}],
  };
  it('trims overlay and audio layers to the actual composition end',()=>{
    const {composition}=studioToRemotionComposition({edit,projectId:'project',width:1080,height:1920});
    for(const layer of composition.layers)expect(layer.startMs+layer.durationMs).toBeLessThanOrEqual(3000);
    expect(composition.layers.find(x=>x.id==='caption_0')?.durationMs).toBe(500);
    expect(composition.layers.find(x=>x.id==='asset_0')?.durationMs).toBe(1000);
    expect(composition.layers.find(x=>x.id==='audio_0')?.durationMs).toBe(1000);
  });
});
