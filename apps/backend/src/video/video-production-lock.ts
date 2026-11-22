import { mkdir, rmdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertWorkspacePath } from './video-tool-adapters';
import { VideoProductionPlan } from './video-production-plan';
import { productionManifestName } from './video-production-checkpoint-store';

/**
 * Fail-closed cross-process lock. No automatic stale-lock eviction: deleting
 * an old lock while a renderer is still running could corrupt production.
 * An operator must inspect and explicitly recover abandoned locks.
 */
export async function withVideoProductionLock<T>(
  workspaceRoot: string,
  plan: VideoProductionPlan,
  work: () => Promise<T>,
): Promise<T> {
  const root = await realpath(workspaceRoot);
  const parent = assertWorkspacePath(root, resolve(root, '.video-production'));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await lstat(parent)).isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error('Unsafe production lock directory');
  }
  const lock = assertWorkspacePath(root, join(parent, productionManifestName(plan) + '.lock'));
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Video production is already locked; inspect before recovery');
    }
    throw error;
  }
  try {
    const owner = { pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
    await writeFile(join(lock, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    return await work();
  } finally {
    // Only remove a lock if it is still the exact directory we acquired.
    // Never recursively delete a directory that another process could replace.
    const { unlink } = await import('node:fs/promises');
    await unlink(join(lock, 'owner.json')).catch(() => undefined);
    await rmdir(lock).catch(() => undefined);
  }
}
