import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreparedRemotionJob } from '../src/video/video-remotion-job';

describe('prepared Remotion job',()=>{
  let root:string;
  beforeEach(async()=>{
    root=await mkdtemp(join(tmpdir(),'nivoo-remotion-job-'));
    await mkdir(join(root,'jobs'));
  });
  afterEach(async()=>rm(root,{recursive:true,force:true}));
  it('refuses an already cancelled job before provisioning',async()=>{
    const controller=new AbortController();
    controller.abort();
    await expect(runPreparedRemotionJob({
      workspaceRoot:root,workDirectory:join(root,'jobs'),
      trustedBundleDirectory:join(root,'missing'),composition:{} as never,
      projectId:'p',projectMedia:[],supportedFeatures:{} as never,
      outputFile:join(root,'output.mp4'),
    },controller.signal)).rejects.toThrow('cancelled');
  });
  it('cleans the isolated job directory after bundle provisioning fails',async()=>{
    await expect(runPreparedRemotionJob({
      workspaceRoot:root,workDirectory:join(root,'jobs'),
      trustedBundleDirectory:join(root,'missing'),composition:{} as never,
      projectId:'p',projectMedia:[],supportedFeatures:{} as never,
      outputFile:join(root,'output.mp4'),
    })).rejects.toThrow();
    const {readdir}=await import('node:fs/promises');
    expect(await readdir(join(root,'jobs'))).toEqual([]);
  });
});
