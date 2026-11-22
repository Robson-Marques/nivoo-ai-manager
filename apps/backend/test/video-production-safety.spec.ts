import { assertProductionSpend, VideoProductionPlan } from '../src/video/video-production-plan';
import { assessVideoQuality } from '../src/video/video-quality-gate';

const plan: VideoProductionPlan = {
  schemaVersion: 1, projectId: 'project', revision: 'r1',
  renderEngine: 'remotion', stages: ['render', 'quality-review'],
  budgetCents: 1000, currency: 'BRL', requiresApprovalAboveCents: 500,
};

describe('production budget and audio fail-closed rules', () => {
  it('requires approval for cumulative spend crossing threshold', () => {
    expect(() => assertProductionSpend(plan, 450, 100, false)).toThrow('requires approval');
    expect(() => assertProductionSpend(plan, 450, 100, true)).not.toThrow();
    expect(() => assertProductionSpend(plan, 950, 100, true)).toThrow('budget exceeded');
  });

  it('rejects unsafe spend sums', () => {
    const huge = { ...plan, budgetCents: Number.MAX_SAFE_INTEGER };
    expect(() => assertProductionSpend(huge, Number.MAX_SAFE_INTEGER, 1, true))
      .toThrow('Invalid production spend total');
  });

  it('rejects missing audio when the production requires it', () => {
    const result = assessVideoQuality(plan, {
      outputExists: true, durationMs: 5000, blackFrameCount: 0,
      hasAudio: false, captionCount: 0, reviewComplete: true,
    }, 5000, false, true);
    expect(result.passed).toBe(false);
    expect(result.findings.map(f => f.code)).toContain('missing-audio');
  });
});
