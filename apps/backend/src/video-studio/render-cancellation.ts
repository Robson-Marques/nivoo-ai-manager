import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Cancellation is scoped to the exact render run, never the project alone. */
function cancelPath(media: string, editId: string, runId: string): string {
  if (!/^[a-f\d-]{36}$/i.test(editId) || !/^[a-f\d-]{36}$/i.test(runId))
    throw new Error('Invalid Studio cancellation identity');
  return path.join(media, 'studio', editId + '.cancel-' + runId + '.json');
}
export function requestStudioRenderCancellation(media: string, editId: string, runId: string): void {
  const target = cancelPath(media, editId, runId);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  if (fs.lstatSync(path.dirname(target)).isSymbolicLink()) throw new Error('Unsafe cancellation directory');
  const tmp = target + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({runId,requestedAt:new Date().toISOString()}),
      {flag:'wx',mode:0o600});
    fs.renameSync(tmp,target);
  } finally {fs.rmSync(tmp,{force:true});}
}
export function isStudioRenderCancellationRequested(media: string, editId: string, runId: string): boolean {
  const target=cancelPath(media,editId,runId);
  try {
    if (fs.lstatSync(path.dirname(target)).isSymbolicLink()) throw new Error('Unsafe cancellation directory');
    if (!fs.lstatSync(target).isFile()) throw new Error('Invalid Studio cancellation marker');
    const parsed=JSON.parse(fs.readFileSync(target,'utf8'));
    if (!parsed || parsed.runId !== runId) throw new Error('Invalid Studio cancellation marker');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return false;
    throw error;
  }
}
export function clearStudioRenderCancellation(media: string, editId: string, runId: string): void {
  fs.rmSync(cancelPath(media,editId,runId),{force:true});
}
