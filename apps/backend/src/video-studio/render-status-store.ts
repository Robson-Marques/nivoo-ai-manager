import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export type StudioRenderStatus = {
  state: 'running'|'done'|'failed'|'cancelled';
  started: string;
  runId: string;
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
  let raw: string;
  try { raw = fs.readFileSync(filename, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const parsed = JSON.parse(raw) as StudioRenderStatus;
  if (!parsed || !['running','done','failed','cancelled'].includes(parsed.state) ||
      typeof parsed.started !== 'string' || typeof parsed.runId !== 'string' ||
      !/^[a-f\d-]{36}$/i.test(parsed.runId)) throw new Error('Invalid persisted Studio render state');
  return parsed;
}

/** Atomic replacement; readers never observe partially serialized status. */
export function saveStudioRenderStatus(media: string, editId: string, value: StudioRenderStatus): void {
  const filename = file(media, editId);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
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
  return value.state === 'running'
    ? { ...value, state: 'failed', error: 'Renderização interrompida pelo reinício do serviço. Inicie uma nova exportação.' }
    : value;
}
