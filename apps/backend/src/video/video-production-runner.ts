import { VideoProductionPlan, VideoProductionStage, pendingProductionStages, validateVideoProductionPlan } from './video-production-plan';
import { VideoProductionCheckpointStore } from './video-production-checkpoint-store';

export type ProductionStageResult = {
  artifactId: string;
  verified: boolean;
};
export type ProductionStageExecutor = (
  stage: VideoProductionStage,
  plan: VideoProductionPlan,
  signal?: AbortSignal,
) => Promise<ProductionStageResult>;

/**
 * Resume a project from its first unfinished stage.
 * The caller MUST hold an exclusive cross-process project lock throughout
 * the run. Stage executors must be idempotent and independently verify
 * artifacts; this function does not invoke any AI, CLI or network itself.
 */
export async function runVideoProduction(
  plan: VideoProductionPlan,
  store: VideoProductionCheckpointStore,
  execute: ProductionStageExecutor,
  signal?: AbortSignal,
): Promise<{ completed: boolean; executed: VideoProductionStage[] }> {
  validateVideoProductionPlan(plan);
  const manifest = await store.load(plan);
  const remaining = pendingProductionStages(plan, manifest.checkpoints);
  const executed: VideoProductionStage[] = [];
  for (const stage of remaining) {
    if (signal?.aborted) throw new Error('Video production cancelled');
    const result = await execute(stage, plan, signal);
    if (signal?.aborted) throw new Error('Video production cancelled');
    if (!result || !result.verified) {
      throw new Error('Unverified production stage: ' + stage);
    }
    await store.completeStage(plan, stage, result.artifactId, true);
    executed.push(stage);
  }
  return { completed: true, executed };
}
