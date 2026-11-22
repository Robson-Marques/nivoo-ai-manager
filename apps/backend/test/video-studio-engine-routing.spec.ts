import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Studio render engine routing',()=>{
  it('keeps FFmpeg as the default and exposes explicit Remotion opt-in',()=>{
    const controller=readFileSync(join(process.cwd(),'src/video-studio/video-studio.controller.ts'),'utf8');
    expect(controller).toContain("body?.engine??'ffmpeg'");
    const service=readFileSync(join(process.cwd(),'src/video-studio/video-studio.service.ts'),'utf8');
    expect(service).toContain("engine==='remotion'?this.executeRemotion");
    expect(service).toContain('entry.abort?.abort()');
  });
});
