import { recommendSceneEngines } from '../src/video/video-scene-router';
import { VideoProductionPlan } from '../src/video/video-production-plan';

const plan: VideoProductionPlan = {
  schemaVersion: 1, projectId: 'p1', revision: 'v1', renderEngine: 'remotion',
  stages: ['compose', 'render', 'quality-review'],
  budgetCents: 0, currency: 'BRL', requiresApprovalAboveCents: 0,
};

describe('scene engine recommendations', () => {
  it('selects HyperFrames for complex motion graphics', () => {
    const decisions = recommendSceneEngines(plan, [
      { id: 'intro', kind: 'motion-graphics', durationMs: 3000,
        hasAuthorizedSource: true, requiresComplexAnimation: true },
      { id: 'title', kind: 'static-card', durationMs: 2000,
        hasAuthorizedSource: true, requiresComplexAnimation: false },
    ]);
    expect(decisions.map(item => item.engine)).toEqual(['hyperframes', 'ffmpeg']);
    expect(decisions[0].requiresReview).toBe(true);
  });

  it('does not silently accept missing live-action footage', () => {
    const decisions = recommendSceneEngines(plan, [
      { id: 'scene', kind: 'live-action', durationMs: 5000,
        hasAuthorizedSource: false, requiresComplexAnimation: false },
    ]);
    expect(decisions[0].requiresReview).toBe(true);
  });

  it('rejects duplicate scenes', () => {
    const scene = { id: 'duplicate', kind: 'narration' as const, durationMs: 1000,
      hasAuthorizedSource: true, requiresComplexAnimation: false };
    expect(() => recommendSceneEngines(plan, [scene, scene])).toThrow('Invalid scene');
  });
});
