import { copyFile, lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { assertWorkspacePath } from './video-tool-adapters';
import type { ResolvedMedia } from './video-remotion-props';

/**
 * Stages project-owned media into a private Remotion public directory BEFORE
 * bundling. The worker must bundle that isolated directory for each render.
 * No browser-controlled URL or arbitrary absolute path is accepted.
 */
export async function stageRemotionMedia(input: {
  workspaceRoot:string;
  publicDirectory:string;
  sources:readonly {mediaId:string;relativePath:string}[];
}):Promise<ResolvedMedia[]> {
  const root=await realpath(input.workspaceRoot);
  const target=assertWorkspacePath(root,resolve(input.publicDirectory));
  if(target===root) throw new Error('Remotion public directory cannot be workspace root');
  const checkSegments=async(file:string)=>{
    let cursor=root;
    for(const part of relative(root,file).split(/[\\/]/).filter(Boolean)){
      cursor=join(cursor,part);
      try {if((await lstat(cursor)).isSymbolicLink())throw new Error('Remotion media path contains symlink');}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    }
  };
  await checkSegments(target);
  if(!Array.isArray(input.sources)||input.sources.length>500)throw new Error('Invalid Remotion media set');
  const ids=new Set<string>();
  for(const item of input.sources){
    if(!item || !/^[a-zA-Z0-9_-]{1,256}$/.test(item.mediaId)||ids.has(item.mediaId))
      throw new Error('Invalid or duplicate Remotion media ID');
    ids.add(item.mediaId);
  }
  const assets=join(target,'assets');
  await checkSegments(assets);
  await mkdir(assets,{recursive:true,mode:0o700});
  const result:ResolvedMedia[]=[];
  for(const item of input.sources){
    if(typeof item.relativePath!=='string'||!item.relativePath||
      isAbsolute(item.relativePath)||item.relativePath.split(/[\\/]/).includes('..'))
      throw new Error('Remotion media must be a workspace-relative path');
    const source=assertWorkspacePath(root,resolve(root,item.relativePath));
    await checkSegments(source);
    const real=await realpath(source);
    assertWorkspacePath(root,real);
    const info=await stat(real);
    if(!info.isFile()||info.size===0||info.size>10*1024*1024*1024)
      throw new Error('Invalid Remotion media file');
    const extension=extname(real).toLowerCase();
    if(!['.mp4','.mov','.webm','.mp3','.wav','.m4a','.aac','.png','.jpg','.jpeg','.webp'].includes(extension))
      throw new Error('Unsupported Remotion media extension');
    const name=createHash('sha256').update(item.mediaId+'\0'+item.relativePath).digest('hex').slice(0,32)+extension;
    const destination=join(assets,name);
    await checkSegments(destination);
    await copyFile(real,destination,fsConstants.COPYFILE_EXCL);
    result.push({mediaId:item.mediaId,assetUrl:'/assets/'+name});
  }
  return result;
}
