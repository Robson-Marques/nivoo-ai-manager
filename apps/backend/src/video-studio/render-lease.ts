import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export type StudioRenderLease = { runId: string; ownerPid: number; createdAt: string };

function lockDir(media: string, editId: string): string {
  if (!/^[a-f\d-]{36}$/i.test(editId)) throw new Error('Invalid Studio edit ID');
  return path.join(media, 'studio', editId + '.render-lock');
}

function ownerFile(dir: string): string { return path.join(dir, 'owner.json'); }

function readOwner(dir: string): StudioRenderLease | undefined {
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe render lock directory');
    const value = JSON.parse(fs.readFileSync(ownerFile(dir), 'utf8')) as StudioRenderLease;
    if (!value || !/^[a-f\d-]{36}$/i.test(value.runId) ||
        !Number.isSafeInteger(value.ownerPid) || value.ownerPid < 1 ||
        typeof value.createdAt !== 'string') throw new Error('Invalid render lock owner');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Acquire an exclusive filesystem lease before scheduling FFmpeg. */
export function acquireStudioRenderLease(media: string, editId: string, runId: string = randomUUID()): StudioRenderLease {
  const dir = lockDir(media, editId);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const lease: StudioRenderLease = { runId, ownerPid: process.pid, createdAt: new Date().toISOString() };
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(ownerFile(dir), JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
    return lease;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      // If mkdir succeeded but owner creation failed, remove only our own empty directory.
      try { fs.rmdirSync(dir); } catch { /* another owner may have populated it */ }
      throw error;
    }
    throw new Error('Renderização já bloqueada por outra execução');
  }
}

export function readStudioRenderLease(media: string, editId: string): StudioRenderLease | undefined {
  return readOwner(lockDir(media, editId));
}

/** Never unlink another worker's lock. No recursive deletion. */
export function releaseStudioRenderLease(media: string, editId: string, runId: string): boolean {
  const dir = lockDir(media, editId);
  const owner = readOwner(dir);
  if (!owner || owner.runId !== runId || owner.ownerPid !== process.pid) return false;
  fs.unlinkSync(ownerFile(dir));
  fs.rmdirSync(dir);
  return true;
}

/**
 * Recovery is explicit and limited to a verifiably dead process.
 * A missing or malformed owner file is never silently stolen.
 */
export function recoverDeadStudioRenderLease(media: string, editId: string): boolean {
  const dir = lockDir(media, editId);
  const owner = readOwner(dir);
  if (!owner || pidAlive(owner.ownerPid)) return false;
  // Rename the whole lock atomically before cleanup so concurrent acquisitions
  // cannot both consider the original path free.
  const retired = dir + '.stale-' + randomUUID();
  fs.renameSync(dir, retired);
  const retiredOwner = readOwner(retired);
  if (!retiredOwner || retiredOwner.runId !== owner.runId || pidAlive(retiredOwner.ownerPid)) {
    // Do not delete an unexpected lock. An operator must resolve the conflict.
    throw new Error('Render lock changed during recovery');
  }
  fs.unlinkSync(ownerFile(retired));
  fs.rmdirSync(retired);
  return true;
}
