import type { StudioProject } from '../video-studio/video-studio.service';
import { studioToRemotionComposition } from './video-studio-conversion';
import { runPreparedRemotionJob } from './video-remotion-job';
import { RenderFeatureSupport } from './video-render-parity';
import { VerifiedRemotionRender } from './video-remotion-execution';

/**
 * Worker-facing adapter for the legacy Studio edit schema.
 * Authorization, lease, cancellation, quota, runtime installation and verified
 * feature parity are enforced by the trusted caller, not inferred here.
 */
export async function renderStudioEditWithRemotion(input:{
  edit:StudioProject;
  projectId:string;
  width:number;
  height:number;
  workspaceRoot:string;
  workDirectory:string;
  trustedBundleDirectory:string;
  outputFile:string;
  supportedFeatures:RenderFeatureSupport;
},signal?:AbortSignal):Promise<VerifiedRemotionRender>{
  if(signal?.aborted)throw new Error('Remotion job cancelled');
  const {composition,media}=studioToRemotionComposition({
    edit:input.edit,projectId:input.projectId,
    width:input.width,height:input.height,
  });
  // Studio paths are midia/entrada/... while workspaceRoot points at the
  // project media directory itself. Remove only the trusted prefix.
  const ownedMedia=media.map(item=>({
    ...item,assetUrl:item.assetUrl.replace(/^\/midia\//,'/'),
  }));
  return runPreparedRemotionJob({
    workspaceRoot:input.workspaceRoot,
    trustedBundleDirectory:input.trustedBundleDirectory,
    workDirectory:input.workDirectory,
    composition,projectId:input.projectId,projectMedia:ownedMedia,
    outputFile:input.outputFile,
    supportedFeatures:input.supportedFeatures,
  },signal);
}
