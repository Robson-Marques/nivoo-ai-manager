import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionPrivateRemotionBundle } from '../src/video/video-remotion-bundle';

describe('private Remotion bundle provisioning',()=>{
  let root:string;
  beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'nivoo-remotion-bundle-'));});
  afterEach(async()=>rm(root,{recursive:true,force:true}));
  it('copies a trusted bundle into a private workspace directory',async()=>{
    const source=join(root,'trusted');
    await mkdir(source);
    await writeFile(join(source,'index.html'),'<html></html>');
    const target=await provisionPrivateRemotionBundle({
      trustedBundleDirectory:source,workspaceRoot:root,jobDirectory:join(root,'job','bundle'),
    });
    expect(await readFile(join(target,'index.html'),'utf8')).toBe('<html></html>');
  });
  it('rejects an existing job directory',async()=>{
    const source=join(root,'trusted');
    await mkdir(source);await writeFile(join(source,'index.html'),'ok');
    const target=join(root,'job');await mkdir(target);
    await expect(provisionPrivateRemotionBundle({
      trustedBundleDirectory:source,workspaceRoot:root,jobDirectory:target,
    })).rejects.toThrow('already exists');
  });
  it('rejects symlinked job paths',async()=>{
    const source=join(root,'trusted');
    await mkdir(source);await writeFile(join(source,'index.html'),'ok');
    await symlink(source,join(root,'alias'));
    await expect(provisionPrivateRemotionBundle({
      trustedBundleDirectory:source,workspaceRoot:root,jobDirectory:join(root,'alias','job'),
    })).rejects.toThrow('symlink');
  });
});
