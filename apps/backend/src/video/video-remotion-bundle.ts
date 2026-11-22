import { cp, lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { assertWorkspacePath } from './video-tool-adapters';

/**
 * Prepare a private copy of an operator-provisioned Remotion bundle.
 * Never bundle arbitrary project source code or write assets to the shared build.
 */
export async function provisionPrivateRemotionBundle(input:{
  trustedBundleDirectory:string;
  workspaceRoot:string;
  jobDirectory:string;
}):Promise<string>{
  const root=await realpath(input.workspaceRoot);
  const source=await realpath(input.trustedBundleDirectory);
  if(!(await stat(source)).isDirectory())throw new Error('Trusted Remotion bundle missing');
  const target=assertWorkspacePath(root,resolve(input.jobDirectory));
  if(target===root||target===source||source.startsWith(target+'/')||target.startsWith(source+'/'))throw new Error('Remotion job bundle must be private and disjoint');
  let cursor=root;
  for(const part of relative(root,target).split(/[\\/]/).filter(Boolean)){
    cursor=join(cursor,part);
    try{if((await lstat(cursor)).isSymbolicLink())throw new Error('Remotion job path contains symlink');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  // Refuse to overlay existing data: retries must allocate a new run directory.
  try{await lstat(target);throw new Error('Remotion job bundle already exists');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await mkdir(target,{recursive:true,mode:0o700});
  await cp(source,target,{recursive:true,force:false,errorOnExist:true,
    filter:async(path)=>{
      if((await lstat(path)).isSymbolicLink())throw new Error('Trusted bundle contains symlink');
      return true;
    }});
  if(!(await stat(join(target,'index.html'))).isFile())
    throw new Error('Trusted Remotion bundle missing index.html');
  return target;
}
