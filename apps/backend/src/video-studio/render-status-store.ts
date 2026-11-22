import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export type StudioRenderStatus = {
  state: 'running'|'done'|'failed'|'cancelled';
  started: string;
  runId: string;
  ownerPid: number;
  error?: string;
  output?: string;
  inspection?: { durationMs: number; blackFrameCount: number; hasAudio: boolean; audioPeakDbfs?: number; warnings: string[] };
};

function file(media: string, editId: string): string {
  if (!/^[a-f\d-]{36}$/i.test(editId)) throw new Error('Invalid Studio edit ID');
  return path.join(media, 'studio', editId + '.render-status.json');
}

export function loadStudioRenderStatus(media: string, editId: string): StudioRenderStatus | undefined {
  const filename = file(media, editId);
  try { if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Unsafe Studio render status path'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let raw: string;
  try { raw = fs.readFileSync(filename, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const parsed = JSON.parse(raw) as StudioRenderStatus;
  if (!parsed || !['running','done','failed','cancelled'].includes(parsed.state) ||
      typeof parsed.started !== 'string' || !Number.isSafeInteger(parsed.ownerPid) || parsed.ownerPid < 1 || typeof parsed.runId !== 'string' ||
      !/^[a-f\d-]{36}$/i.test(parsed.runId) ||
      (parsed.stage !== undefined && !['preparing','clips','audio','compositing','inspecting'].includes(parsed.stage)) ||
      (parsed.progress !== undefined && (!Number.isFinite(parsed.progress) || parsed.progress < 0 || parsed.progress > 100))) throw new Error('Invalid persisted Studio render state');
  return parsed;
}

/** Atomic replacement; readers never observe partially serialized status. */
export function saveStudioRenderStatus(media: string, editId: string, value: StudioRenderStatus): void {
  const filename = file(media, editId);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (fs.lstatSync(path.dirname(filename)).isSymbolicLink()) throw new Error('Unsafe Studio status directory');
  try { if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Unsafe Studio render status path'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const tmp = filename + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, filename);
  } finally { fs.rmSync(tmp, { force: true }); }
}

/**
 * An interrupted process cannot be presumed successful after restart.
 * The output remains on disk for diagnosis; a fresh render must be explicit.
 */
export function interruptedStudioRender(value: StudioRenderStatus): StudioRenderStatus {
  if (value.state === 'running') {
    try { process.kill(value.ownerPid, 0); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return value; }
  }
  return value.state === 'running'
    ? { ...value, state: 'failed', error: 'Renderização interrompida pelo reinício do serviço. Inicie uma nova exportação.' }
    : value;
}
