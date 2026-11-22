import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { assertWorkspacePath } from './video-tool-adapters';
import { VideoProductionPlan, VideoProductionStage, validateVideoProductionPlan } from './video-production-plan';

export type DurableCheckpoint = {
  stage: VideoProductionStage;
  revision: string;
  artifactId: string;
  completedAt: number;
};
export type DurableManifest = {
  schemaVersion: 1;
  projectId: string;
  revision: string;
  checkpoints: DurableCheckpoint[];
};

function assertManifest(manifest: DurableManifest, plan: VideoProductionPlan): void {
  if (!manifest || manifest.schemaVersion !== 1 ||
      manifest.projectId !== plan.projectId || manifest.revision !== plan.revision ||
      !Array.isArray(manifest.checkpoints) || manifest.checkpoints.length > plan.stages.length) {
    throw new Error('Invalid or stale production manifest');
  }
  for (let i = 0; i < manifest.checkpoints.length; i++) {
    const checkpoint = manifest.checkpoints[i];
    if (!checkpoint || checkpoint.stage !== plan.stages[i] ||
        checkpoint.revision !== plan.revision ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(checkpoint.artifactId) ||
        !Number.isSafeInteger(checkpoint.completedAt) || checkpoint.completedAt < 0) {
      throw new Error('Invalid production checkpoint sequence');
    }
  }
}

export function productionManifestName(plan: VideoProductionPlan): string {
  validateVideoProductionPlan(plan);
  const key = createHash('sha256').update(JSON.stringify([
    plan.projectId, plan.revision, plan.stages, plan.renderEngine,
  ])).digest('hex');
  return key + '.json';
}

/**
 * Durable per-project checkpoint record. The caller MUST acquire a
 * cross-process project lock before reading/writing; atomic rename alone
 * does not prevent competing writers. Artifacts must be independently
 * verified before calling completeStage.
 */
export class VideoProductionCheckpointStore {
  constructor(private readonly workspaceRoot: string) {}

  private manifestPath(plan: VideoProductionPlan): string {
    return assertWorkspacePath(this.workspaceRoot,
      resolve(this.workspaceRoot, '.video-production', productionManifestName(plan)));
  }

  async load(plan: VideoProductionPlan): Promise<DurableManifest> {
    const file = this.manifestPath(plan);
    try {
      const raw = await readFile(file, 'utf8');
      if (raw.length > 32_768) throw new Error('Production manifest too large');
      const manifest = JSON.parse(raw) as DurableManifest;
      assertManifest(manifest, plan);
      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { schemaVersion: 1, projectId: plan.projectId,
        revision: plan.revision, checkpoints: [] };
    }
  }

  async completeStage(
    plan: VideoProductionPlan,
    stage: VideoProductionStage,
    artifactId: string,
    artifactVerified: boolean,
  ): Promise<DurableManifest> {
    if (!artifactVerified) throw new Error('Unverified production artifact');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(artifactId)) throw new Error('Invalid artifact ID');
    const current = await this.load(plan);
    const nextStage = plan.stages[current.checkpoints.length];
    if (nextStage !== stage) throw new Error('Production stage out of order or already complete');
    const next: DurableManifest = { ...current, checkpoints: [...current.checkpoints, {
      stage, revision: plan.revision, artifactId, completedAt: Date.now(),
    }] };
    const file = this.manifestPath(plan);
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), productionManifestName(plan) +
      '.' + process.pid + '.' + createHash('sha256').update(artifactId).digest('hex').slice(0, 12) + '.tmp');
    try {
      await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    } catch (error) {
      const { unlink } = await import('node:fs/promises');
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return next;
  }
}
