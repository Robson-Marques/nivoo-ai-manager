import { VideoComposition } from './video-composition';
import { VideoProductionPlan, VideoProductionStage } from './video-production-plan';
import { VideoProductionCheckpointStore } from './video-production-checkpoint-store';
import { runVideoProduction } from './video-production-runner';
import { ProjectMediaRecord } from './video-project-media';
import { RenderFeatureSupport } from './video-render-parity';
import { executeVerifiedRemotionRender, VerifiedRemotionRender } from './video-remotion-execution';
import { reviewRenderedVideo, VideoReviewReport } from './video-render-review';

export type VideoProductionInput = {
  plan: VideoProductionPlan;
  workspaceRoot: string;
  composition: VideoComposition;
  projectMedia: readonly ProjectMediaRecord[];
  bundleDirectory: string;
  propsFile: string;
  outputFile: string;
  supportedFeatures: RenderFeatureSupport;
  contentReviewApproved: boolean;
  requireCaptions: boolean;
  requireAudio: boolean;
  captionCount: number;
};

/**
 * Concrete Remotion production slice. No fake checkpoints for stages without
 * implementations: accepts only render + quality-review. The caller must
 * authorize the project and provision a trusted renderer bundle and media.
 * This does not publish a video or bypass the export-readiness gate.
 */
export async function executeRemotionProduction(
  input: VideoProductionInput,
  signal?: AbortSignal,
): Promise<{ executed: VideoProductionStage[]; render?: VerifiedRemotionRender; review?: VideoReviewReport }> {
  if (input.plan.renderEngine !== 'remotion' ||
      input.plan.stages.length !== 2 ||
      input.plan.stages[0] !== 'render' ||
      input.plan.stages[1] !== 'quality-review' ||
      input.plan.projectId !== input.composition.id ||
      input.plan.revision !== input.composition.revision) {
    throw new Error('Unsupported production plan for Remotion execution');
  }
  const store = new VideoProductionCheckpointStore(input.workspaceRoot);
  let render: VerifiedRemotionRender | undefined;
  let review: VideoReviewReport | undefined;
  const result = await runVideoProduction(input.plan, store, async stage => {
    if (stage === 'render') {
      render = await executeVerifiedRemotionRender({
        workspaceRoot: input.workspaceRoot,
        bundleDirectory: input.bundleDirectory,
        composition: input.composition,
        projectId: input.plan.projectId,
        projectMedia: input.projectMedia,
        propsFile: input.propsFile,
        outputFile: input.outputFile,
        supportedFeatures: input.supportedFeatures,
      }, signal);
      return { artifactId: 'render_' + input.plan.revision.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
        verified: true };
    }
    review = await reviewRenderedVideo(input.plan, {
      workspaceRoot: input.workspaceRoot, outputFile: input.outputFile,
      expectedDurationMs: input.composition.durationMs,
      requireCaptions: input.requireCaptions,
      requireAudio: input.requireAudio,
      captionCount: input.captionCount,
      contentReviewApproved: input.contentReviewApproved,
    }, signal);
    if (!review.passed) throw new Error('Rendered video failed quality review: ' +
      review.findings.filter(f => f.severity === 'error').map(f => f.code).join(', '));
    return { artifactId: 'review_' + input.plan.revision.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      verified: true };
  }, signal, input.workspaceRoot);
  return { executed: result.executed, ...(render ? { render } : {}), ...(review ? { review } : {}) };
}
