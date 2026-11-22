import { assessVideoQuality } from '../src/video/video-quality-gate';
import { VideoProductionPlan } from '../src/video/video-production-plan';

const plan: VideoProductionPlan = {
  schemaVersion: 1, projectId: 'p1', revision: 'r1', renderEngine: 'remotion',
  stages: ['render', 'quality-review'], budgetCents: 1000, currency: 'BRL',
  requiresApprovalAboveCents: 200,
};

describe('video post-render quality gate', () => {
  it('rejects missing real measurements', () => {
    const result = assessVideoQuality(plan, { outputExists: true, reviewComplete: false }, 5000, true);
    expect(result.passed).toBe(false);
    expect(result.findings.some(f => f.code === 'unverified-review')).toBe(true);
    expect(result.findings.some(f => f.code === 'missing-captions')).toBe(true);
  });

  it('accepts a measured, complete render', () => {
    const result = assessVideoQuality(plan, {
      outputExists: true, durationMs: 5000, blackFrameCount: 0,
      hasAudio: true, audioPeakDbfs: -6, captionCount: 5, reviewComplete: true,
    }, 5000, true);
    expect(result).toEqual({ passed: true, findings: [] });
  });

  it('reports suspicious frames and clipped audio', () => {
    const result = assessVideoQuality(plan, {
      outputExists: true, durationMs: 5000, blackFrameCount: 3,
      hasAudio: true, audioPeakDbfs: -0.05, captionCount: 0, reviewComplete: true,
    }, 5000, false);
    expect(result.findings.map(f => f.code)).toContain('black-frame');
    expect(result.findings.map(f => f.code)).toContain('clipped-audio');
  });
});
