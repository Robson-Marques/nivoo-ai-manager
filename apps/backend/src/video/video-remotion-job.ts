import { mkdtemp, rm, mkdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VideoComposition } from './video-composition';
import { ProjectMediaRecord } from './video-project-media';
import { RenderFeatureSupport } from './video-render-parity';
import { provisionPrivateRemotionBundle } from './video-remotion-bundle';
import { executeVerifiedRemotionRender, VerifiedRemotionRender } from './video-remotion-execution';
import { assertWorkspacePath } from './video-tool-adapters';

/**
 * Trusted-worker entry point: prepare a private bundle, stage media, render,
 * inspect, publish, then clean temporary state. Never call from an HTTP
 * handler without project authorization, lease, quotas and cancellation.
 */
export async function runPreparedRemotionJob(input:{
  workspaceRoot:string;
  trustedBundleDirectory:string;
  workDirectory:string;
  composition:VideoComposition;
  projectId:string;
  projectMedia:readonly ProjectMediaRecord[];
  supportedFeatures:RenderFeatureSupport;
  outputFile:string;
},signal?:AbortSignal):Promise<VerifiedRemotionRender>{
  const root=resolve(input.workspaceRoot);
  const work=assertWorkspacePath(root,resolve(input.workDirectory));
  if(work===root)throw new Error('Remotion work directory must be private');
  if(signal?.aborted)throw new Error('Remotion job cancelled');
  // Do not follow a symlink supplied through the work directory.
  try {
    const info=await lstat(work);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe Remotion work directory');
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    await mkdir(work,{recursive:true,mode:0o700});
    const info=await lstat(work);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe Remotion work directory');
  }
  const job=await mkdtemp(join(work,'remotion-'+randomUUID()+'-'));
  try {
    const bundle=await provisionPrivateRemotionBundle({
      trustedBundleDirectory:input.trustedBundleDirectory,
      workspaceRoot:root,
      jobDirectory:join(job,'bundle'),
    });
    if(signal?.aborted)throw new Error('Remotion job cancelled');
    return await executeVerifiedRemotionRender({
      workspaceRoot:root,
      bundleDirectory:bundle,
      composition:input.composition,
      projectId:input.projectId,
      projectMedia:input.projectMedia,
      outputFile:input.outputFile,
      propsFile:join(job,'props.json'),
      supportedFeatures:input.supportedFeatures,
    },signal);
  } finally {
    await rm(job,{recursive:true,force:true});
  }
}
