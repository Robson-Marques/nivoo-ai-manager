import { assertProductionSpend, pendingProductionStages, VideoProductionPlan } from '../src/video/video-production-plan';

const plan: VideoProductionPlan = {
  schemaVersion: 1, projectId: 'project-1', revision: 'v1',
  renderEngine: 'remotion', stages: [
    'inspect-media', 'transcribe', 'plan-scenes', 'compose', 'render', 'quality-review',
  ],
  budgetCents: 2500, currency: 'BRL', requiresApprovalAboveCents: 500,
};

describe('checkpointed video production planning', () => {
  it('resumes from the first incomplete stage', () => {
    expect(pendingProductionStages(plan, [
      { stage: 'inspect-media', revision: 'v1', artifactId: 'inspect-1', completedAt: 1000 },
      { stage: 'transcribe', revision: 'v1', artifactId: 'srt-1', completedAt: 2000 },
    ])).toEqual(['plan-scenes', 'compose', 'render', 'quality-review']);
  });

  it('rejects stale or out-of-order checkpoints', () => {
    expect(() => pendingProductionStages(plan, [
      { stage: 'inspect-media', revision: 'v0', artifactId: 'old', completedAt: 1000 },
    ])).toThrow('stale');
    expect(() => pendingProductionStages(plan, [
      { stage: 'compose', revision: 'v1', artifactId: 'render-1', completedAt: 1000 },
    ])).toThrow('out of order');
  });

  it('enforces cost limits and approval thresholds', () => {
    expect(() => assertProductionSpend(plan, 2000, 600, true)).toThrow('budget');
    expect(() => assertProductionSpend(plan, 0, 600, false)).toThrow('approval');
    // Aprovação é pelo gasto ACUMULADO (ver video-production-safety.spec): 300+100=400 < 500, não exige OK.
    expect(() => assertProductionSpend(plan, 300, 100, false)).not.toThrow();
  });
});
