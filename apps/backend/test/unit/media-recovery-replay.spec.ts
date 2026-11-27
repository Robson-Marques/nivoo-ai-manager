import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { captureMediaOutputs,mediaSnapshotMatches } from '../../src/worker/executor/media-recovery';

describe('recuperação do snapshot de mídia',()=>{
  it('aceita somente o mesmo MP4 durável registrado depois do provedor',async()=>{
    const mediaDir=await fs.mkdtemp(path.join(os.tmpdir(),'nivoo-media-replay-'));
    const output=path.join(mediaDir,'saida','reel.mp4');
    const job:any={id:'job',projectId:'project',defaultProvider:'juntar-videos'};
    const step:any={id:'step',key:'montar',provider:'juntar-videos',providerOptions:{arquivo:'midia/saida/reel.mp4'}};
    try{
      await fs.mkdir(path.dirname(output),{recursive:true});
      await fs.writeFile(output,'video-one');
      const snapshot=[...captureMediaOutputs(job,step,mediaDir)];
      expect(snapshot).toHaveLength(1);
      expect(mediaSnapshotMatches(mediaDir,snapshot)).toBe(true);
      await fs.writeFile(output,'video-two-with-other-bytes');
      expect(mediaSnapshotMatches(mediaDir,snapshot)).toBe(false);
      await fs.rm(output);
      expect(mediaSnapshotMatches(mediaDir,snapshot)).toBe(false);
    }finally{
      await fs.rm(mediaDir,{recursive:true,force:true});
    }
  });
});
