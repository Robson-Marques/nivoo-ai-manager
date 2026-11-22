import { VideoProductionPlan, validateVideoProductionPlan } from './video-production-plan';

export type VideoSceneRequirement = {
  id: string;
  kind: 'narration' | 'motion-graphics' | 'live-action' | 'static-card';
  durationMs: number;
  hasAuthorizedSource: boolean;
  requiresComplexAnimation: boolean;
};

export type EngineDecision = {
  sceneId: string;
  engine: 'remotion' | 'hyperframes' | 'ffmpeg';
  reason: string;
  requiresReview: boolean;
};

/**
 * Deterministic, explainable scene-level routing. This is a recommendation,
 * not permission to execute any CLI or to override the project export engine.
 */
export function recommendSceneEngines(
  plan: VideoProductionPlan,
  scenes: readonly VideoSceneRequirement[],
): EngineDecision[] {
  validateVideoProductionPlan(plan);
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > 200) {
    throw new Error('Invalid video scenes');
  }
  const ids = new Set<string>();
  return scenes.map(scene => {
    if (!scene || typeof scene.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(scene.id) ||
        ids.has(scene.id) || !['narration', 'motion-graphics', 'live-action', 'static-card'].includes(scene.kind) ||
        !Number.isSafeInteger(scene.durationMs) || scene.durationMs <= 0 || scene.durationMs > 3_600_000 ||
        typeof scene.hasAuthorizedSource !== 'boolean' ||
        typeof scene.requiresComplexAnimation !== 'boolean') {
      throw new Error('Invalid scene requirement');
    }
    ids.add(scene.id);
    if (!scene.hasAuthorizedSource && scene.kind === 'live-action') {
      return { sceneId: scene.id, engine: 'ffmpeg', reason: 'Missing authorized source media',
        requiresReview: true };
    }
    if (scene.kind === 'motion-graphics' && scene.requiresComplexAnimation) {
      return { sceneId: scene.id, engine: 'hyperframes',
        reason: 'Complex motion graphics are better suited to HyperFrames', requiresReview: true };
    }
    if (scene.kind === 'static-card' && !scene.requiresComplexAnimation) {
      return { sceneId: scene.id, engine: 'ffmpeg',
        reason: 'Simple static scene can use a lightweight composition', requiresReview: false };
    }
    return { sceneId: scene.id, engine: 'remotion',
      reason: 'Layered timeline composition with predictable timing', requiresReview: false };
  });
}
