import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageRemotionMedia } from '../src/video/video-remotion-media-stage';

describe('Remotion authorized media staging',()=>{
  let root:string;
  beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'nivoo-remotion-assets-'));});
  afterEach(async()=>rm(root,{recursive:true,force:true}));
  it('stages only project-relative media with deterministic safe asset URLs',async()=>{
    await mkdir(join(root,'media'));
    await writeFile(join(root,'media','clip.mp4'),'fixture');
    const records=await stageRemotionMedia({workspaceRoot:root,publicDirectory:join(root,'public'),
      sources:[{mediaId:'clip_1',relativePath:'media/clip.mp4'}]});
    expect(records[0].assetUrl).toMatch(/^\/assets\/[a-f0-9]{32}\.mp4$/);
    expect(await readFile(join(root,'public',records[0].assetUrl.slice(1)),'utf8')).toBe('fixture');
  });
  it('rejects path traversal and symlink escapes',async()=>{
    await expect(stageRemotionMedia({workspaceRoot:root,publicDirectory:join(root,'public'),
      sources:[{mediaId:'bad',relativePath:'../outside.mp4'}]})).rejects.toThrow('relative');
    await mkdir(join(root,'media'));
    await symlink('/etc/hosts',join(root,'media','linked.mp4'));
    await expect(stageRemotionMedia({workspaceRoot:root,publicDirectory:join(root,'public'),
      sources:[{mediaId:'bad',relativePath:'media/linked.mp4'}]})).rejects.toThrow('symlink');
  });
  it('rejects duplicate media IDs',async()=>{
    await expect(stageRemotionMedia({workspaceRoot:root,publicDirectory:join(root,'public'),
      sources:[{mediaId:'a',relativePath:'x.mp4'},{mediaId:'a',relativePath:'y.mp4'}]}))
      .rejects.toThrow('duplicate');
  });
});
