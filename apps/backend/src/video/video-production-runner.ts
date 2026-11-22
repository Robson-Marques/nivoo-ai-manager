import { VideoProductionPlan, VideoProductionStage, pendingProductionStages, validateVideoProductionPlan } from './video-production-plan';
import { VideoProductionCheckpointStore } from './video-production-checkpoint-store';
import { withVideoProductionLock } from './video-production-lock';

export type ProductionStageResult = {
  artifactId: string;
  verified: boolean;
};
export type ProductionCheckpointVerifier = (
  stage: VideoProductionStage,
  artifactId: string,
  plan: VideoProductionPlan,
  signal?: AbortSignal,
) => Promise<boolean>;

export type ProductionStageExecutor = (
  stage: VideoProductionStage,
  plan: VideoProductionPlan,
  signal?: AbortSignal,
) => Promise<ProductionStageResult>;

/**
 * Resume a project from its first unfinished stage.
 * Acquires an exclusive cross-process production lock before loading checkpoints.
 * Stage executors must be idempotent and independently verify
 * artifacts; this function does not invoke any AI, CLI or network itself.
 */
export async function runVideoProduction(
  plan: VideoProductionPlan,
  store: VideoProductionCheckpointStore,
  execute: ProductionStageExecutor,
  signal?: AbortSignal,
  workspaceRoot?: string,
  verifyCheckpoint?: ProductionCheckpointVerifier,
): Promise<{ completed: boolean; executed: VideoProductionStage[] }> {
  validateVideoProductionPlan(plan);
  if (!workspaceRoot) throw new Error('Production workspace lock root required');
  return withVideoProductionLock(workspaceRoot, plan, async () => {
  const manifest = await store.load(plan);
  const remaining = pendingProductionStages(plan, manifest.checkpoints);
  if (manifest.checkpoints.length && !verifyCheckpoint) {
    throw new Error('Checkpoint verification required before resuming production');
  }
  for (const checkpoint of manifest.checkpoints) {
    if (signal?.aborted) throw new Error('Video production cancelled');
    if (!await verifyCheckpoint!(checkpoint.stage, checkpoint.artifactId, plan, signal)) {
      throw new Error('Persisted production artifact missing or stale: ' + checkpoint.stage);
    }
  }
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
  });
}
