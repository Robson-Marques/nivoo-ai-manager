import { studioToRemotionComposition } from '../src/video/video-studio-conversion';
import type { StudioProject } from '../src/video-studio/video-studio.service';

const edit:StudioProject={
  version:1,id:'11111111-1111-4111-8111-111111111111',
  updatedAt:'2026-11-22T12:00:00.000Z',title:'Demo',
  clips:[
    {id:'c1',source:'midia/entrada/clip.mp4',start:1,end:3,duration:2,volume:.8},
    {id:'c2',source:'midia/entrada/clip.mp4',start:4,end:5,duration:1},
  ],
  captions:[{id:'t1',text:'Olá',start:.2,end:1.5,x:.5,y:.8,
    animation:'karaoke',words:[{text:'Olá',start:.2,end:1.5}]}],
  assets:[{id:'i1',source:'midia/saida/cover.png',start:0,end:1,x:.1,y:.2,w:.3,h:.4}],
  audioTracks:[{id:'a1',source:'midia/entrada/voice.wav',start:1,end:2,offset:1.5,volume:.7}],
  protectedZones:[{id:'face',label:'Rosto',start:0,end:2,x:.1,y:.1,w:.2,h:.2}],
};
describe('Studio to Remotion composition conversion',()=>{
  it('converts clips, overlays, timed words and audio without duplicating media',()=>{
    const result=studioToRemotionComposition({edit,projectId:'project-1',width:1080,height:1920});
    expect(result.composition.durationMs).toBe(3000);
    expect(result.composition.layers).toHaveLength(5);
    expect(result.media).toHaveLength(3);
    expect(result.composition.layers[0]).toMatchObject({
      type:'video',startMs:0,durationMs:2000,sourceOffsetMs:1000,volume:.8,
    });
    expect(result.composition.layers[1]).toMatchObject({
      type:'video',startMs:2000,durationMs:1000,sourceOffsetMs:4000,
    });
    expect(result.composition.layers[3]).toMatchObject({
      type:'text',animation:'karaoke',words:[{text:'Olá',startMs:200,endMs:1500}],
    });
    expect(result.composition.layers[4]).toMatchObject({
      type:'audio',startMs:1500,durationMs:1000,sourceOffsetMs:1000,
    });
    expect(result.composition.protectedZones?.[0]).toMatchObject({x:10,y:10,width:20,height:20});
  });
  it('preserves looping soundtrack across the full composition',()=>{
    const result=studioToRemotionComposition({edit:{...edit,soundtrack:{
      source:'midia/entrada/music.mp3',volume:.4,
    }},projectId:'p',width:1080,height:1920});
    expect(result.composition.layers.find(layer=>layer.id==='soundtrack')).toMatchObject({
      type:'audio',startMs:0,durationMs:3000,volume:.4,loop:true,
    });
    expect(result.media).toHaveLength(4);
  });
  it('rejects invalid soundtrack volume',()=>{
    expect(()=>studioToRemotionComposition({edit:{...edit,soundtrack:{
      source:'midia/entrada/music.mp3',volume:Infinity,
    }},projectId:'p',width:1080,height:1920})).toThrow('volume');
  });
  it('generates bounded media identities even for long authorized filenames',()=>{
    const name='a'.repeat(180)+'.mp4';
    const result=studioToRemotionComposition({
      edit:{...edit,clips:[{...edit.clips[0],source:'midia/entrada/'+name}]},
      projectId:'p',width:1080,height:1920,
    });
    expect(result.media[0].id).toMatch(/^studio_[a-f0-9]{64}$/);
  });
  it('rejects untrusted media source',()=>{
    expect(()=>studioToRemotionComposition({edit:{...edit,clips:[{...edit.clips[0],source:'../../etc/passwd'}]},
      projectId:'p',width:1080,height:1920})).toThrow('source');
  });
});
