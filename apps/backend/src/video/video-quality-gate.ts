import { VideoProductionPlan, validateVideoProductionPlan } from './video-production-plan';

export type VideoQualityFinding = {
  code: 'missing-file' | 'invalid-duration' | 'black-frame' | 'silent-audio' |
    'clipped-audio' | 'missing-audio' | 'missing-captions' | 'unverified-review';
  severity: 'error' | 'warning';
  message: string;
};

export type VideoQualityMeasurements = {
  outputExists: boolean;
  durationMs?: number;
  blackFrameCount?: number;
  audioPeakDbfs?: number;
  hasAudio?: boolean;
  captionCount?: number;
  reviewComplete: boolean;
};

/**
 * Pure review gate. Measurements must come from real ffprobe/frame/audio
 * inspection; absence of measurements is NOT interpreted as success.
 */
export function assessVideoQuality(
  plan: VideoProductionPlan,
  measured: VideoQualityMeasurements,
  expectedDurationMs: number,
  requireCaptions: boolean,
  requireAudio = false,
): { passed: boolean; findings: VideoQualityFinding[] } {
  validateVideoProductionPlan(plan);
  if (!Number.isSafeInteger(expectedDurationMs) || expectedDurationMs <= 0) {
    throw new Error('Invalid expected duration');
  }
  const findings: VideoQualityFinding[] = [];
  const add = (code: VideoQualityFinding['code'], severity: VideoQualityFinding['severity'], message: string) =>
    findings.push({ code, severity, message });
  if (!measured.outputExists) add('missing-file', 'error', 'Rendered file is missing');
  if (measured.durationMs === undefined || !Number.isFinite(measured.durationMs) ||
      Math.abs(measured.durationMs - expectedDurationMs) > Math.max(1000, expectedDurationMs * 0.02)) {
    add('invalid-duration', 'error', 'Rendered duration does not match the plan');
  }
  if (measured.blackFrameCount === undefined || measured.blackFrameCount < 0) {
    add('unverified-review', 'error', 'Frame inspection was not completed');
  } else if (measured.blackFrameCount > 0) {
    add('black-frame', 'warning', 'Potential black frames detected');
  }
  if (measured.hasAudio === false && requireAudio) {
    add('missing-audio', 'error', 'Expected audio stream is missing');
  }
  if (measured.hasAudio === undefined) {
    add('unverified-review', 'error', 'Audio inspection was not completed');
  } else if (measured.hasAudio && measured.audioPeakDbfs === undefined) {
    add('unverified-review', 'error', 'Audio levels were not inspected');
  } else if (measured.hasAudio && measured.audioPeakDbfs !== undefined) {
    if (measured.audioPeakDbfs === -Infinity) {
      add('silent-audio', requireAudio ? 'error' : 'warning', 'Audio stream contains digital silence');
    } else if (!Number.isFinite(measured.audioPeakDbfs) || measured.audioPeakDbfs > 0) {
      add('clipped-audio', 'error', 'Invalid audio peak');
    } else if (measured.audioPeakDbfs > -0.1) {
      add('clipped-audio', 'warning', 'Audio may be clipping');
    } else if (measured.audioPeakDbfs < -60) {
      add('silent-audio', 'warning', 'Audio may be inaudible');
    }
  }
  if (requireCaptions && (!Number.isSafeInteger(measured.captionCount) || (measured.captionCount ?? 0) < 1)) {
    add('missing-captions', 'error', 'Expected captions are missing');
  }
  if (!measured.reviewComplete) add('unverified-review', 'error', 'Quality review is incomplete');
  return { passed: !findings.some(finding => finding.severity === 'error'), findings };
}
