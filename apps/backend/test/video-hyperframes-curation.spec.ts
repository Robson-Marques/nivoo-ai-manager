import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseHyperFramesCatalog } from '../src/video-studio/hyperframes-catalog';
import { listHyperFramesReviewRequests, requestHyperFramesReview } from '../src/video-studio/hyperframes-curation';

describe('HyperFrames official preview and review queue',()=>{
  const item={
    name:'cinematic-zoom',type:'block' as const,title:'Cinematic Zoom',
    description:'Zoom transition',tags:['transition'],status:'reference-only' as const,
  };
  let media:string;
  beforeEach(()=>{media=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-hf-curation-'));});
  afterEach(()=>{fs.rmSync(media,{recursive:true,force:true});});

  it('keeps only vetted HTTPS preview URLs from the official CDN',()=>{
    const results=[{
      ...item,type:'hyperframes:block',
      preview:{
        video:'https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/cinematic-zoom.mp4',
        poster:'https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/cinematic-zoom.png',
      },
    },{
      name:'evil-block',type:'hyperframes:block',title:'Bad',description:'Unsafe',
      preview:{
        video:'https://evil.example/hyperframes-oss/docs/images/catalog/blocks/x.mp4',
        poster:'https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/x.png?bad=1',
      },
    }];
    const parsed=parseHyperFramesCatalog(JSON.stringify({results}), 'zoom');
    expect(parsed.items[0].preview).toEqual({
      video:results[0].preview.video,poster:results[0].preview.poster,
    });
    expect(parsed.items[1].preview).toEqual({});
  });

  it('saves one persistent review request without installing or executing sources',()=>{
    const first=requestHyperFramesReview(media,item);
    const repeated=requestHyperFramesReview(media,{...item,title:'Another title'});
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      name:'cinematic-zoom',state:'needs-review',executable:false,
      source:'heygen-hyperframes-registry',
    });
    expect(listHyperFramesReviewRequests(media)).toEqual([first]);
    const saved=path.join(media,'studio','hyperframes-review','cinematic-zoom.json');
    expect(fs.statSync(saved).mode&0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(saved))).toEqual(['cinematic-zoom.json']);
  });

  it('blocks path traversal and fake approved candidates',()=>{
    expect(()=>requestHyperFramesReview(media,{...item,name:'../../etc/passwd'})).toThrow();
    expect(()=>requestHyperFramesReview(media,{...item,status:'available' as 'reference-only'})).toThrow();
  });

  it('refuses a symlinked review directory',()=>{
    fs.mkdirSync(path.join(media,'studio'));
    fs.symlinkSync(os.tmpdir(),path.join(media,'studio','hyperframes-review'));
    expect(()=>listHyperFramesReviewRequests(media)).toThrow('não confiável');
  });

  it('refuses a tampered approval flag in a project record',()=>{
    const req=requestHyperFramesReview(media,item);
    const target=path.join(media,'studio','hyperframes-review',req.name+'.json');
    fs.writeFileSync(target,JSON.stringify({...req,state:'approved',executable:true}));
    expect(()=>listHyperFramesReviewRequests(media)).toThrow('corrompido');
  });
});
