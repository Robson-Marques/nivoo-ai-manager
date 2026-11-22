import { VideoProductionPlan, validateVideoProductionPlan } from './video-production-plan';
import { assessVideoQuality, VideoQualityFinding } from './video-quality-gate';
import { inspectRenderedVideo } from './video-render-inspection';

export type VideoReviewRequest = {
  workspaceRoot: string;
  outputFile: string;
  expectedDurationMs: number;
  requireCaptions: boolean;
  captionCount: number;
  /** Only set true after an independent visual/content review. */
  contentReviewApproved: boolean;
};

export type VideoReviewReport = {
  passed: boolean;
  findings: VideoQualityFinding[];
  inspectedAt: string;
  measurements: {
    durationMs?: number;
    blackFrameCount?: number;
    hasAudio?: boolean;
    audioPeakDbfs?: number;
    captionCount: number;
  };
};

/**
 * Explicit post-render step. No job is marked complete and no export is
 * published by this function. A caller may publish only when passed=true.
 */
export async function reviewRenderedVideo(
  plan: VideoProductionPlan,
  request: VideoReviewRequest,
  signal?: AbortSignal,
): Promise<VideoReviewReport> {
  validateVideoProductionPlan(plan);
  if (!Number.isSafeInteger(request.captionCount) || request.captionCount < 0 ||
      !Number.isSafeInteger(request.expectedDurationMs) || request.expectedDurationMs <= 0 ||
      typeof request.contentReviewApproved !== 'boolean') {
    throw new Error('Invalid video review request');
  }
  const measured = await inspectRenderedVideo(request.workspaceRoot, request.outputFile, signal);
  const assessment = assessVideoQuality(plan, {
    ...measured,
    captionCount: request.captionCount,
    reviewComplete: request.contentReviewApproved,
  }, request.expectedDurationMs, request.requireCaptions);
  return {
    passed: assessment.passed,
    findings: assessment.findings,
    inspectedAt: new Date().toISOString(),
    measurements: {
      durationMs: measured.durationMs,
      blackFrameCount: measured.blackFrameCount,
      hasAudio: measured.hasAudio,
      audioPeakDbfs: measured.audioPeakDbfs,
      captionCount: request.captionCount,
    },
  };
}
