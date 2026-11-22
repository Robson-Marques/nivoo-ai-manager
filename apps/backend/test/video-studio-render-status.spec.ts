import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { interruptedStudioRender, loadStudioRenderStatus, saveStudioRenderStatus, StudioRenderStatus } from '../src/video-studio/render-status-store';

describe('Studio durable render status', () => {
  let root: string;
  const editId = randomUUID();
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-render-state-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const record = (state: StudioRenderStatus['state']): StudioRenderStatus => ({
    state, runId: randomUUID(), ownerPid: process.pid, started: new Date().toISOString(),
  });

  it('writes and reads a complete state atomically', () => {
    const running = record('running');
    saveStudioRenderStatus(root, editId, running);
    expect(loadStudioRenderStatus(root, editId)).toEqual(running);
    const done: StudioRenderStatus = { ...running, state: 'done', output: 'midia/saida/studio.mp4' };
    saveStudioRenderStatus(root, editId, done);
    expect(loadStudioRenderStatus(root, editId)).toEqual(done);
    expect(fs.readdirSync(path.join(root, 'studio'))).toEqual([editId + '.render-status.json']);
  });

  it('preserves running jobs whose owner is alive', () => {
    const active = record('running');
    expect(interruptedStudioRender(active)).toEqual(active);
  });

  it('marks a dead worker render as interrupted', () => {
    const dead = { ...record('running'), ownerPid: 2147483647 };
    expect(interruptedStudioRender(dead)).toMatchObject({ state: 'failed' });
  });

  it('persists stage progress and survives a second reader', () => {
    const active = { ...record('running'), stage: 'validating' as const, progress: 3 };
    saveStudioRenderStatus(root, editId, active);
    expect(loadStudioRenderStatus(root, editId)).toMatchObject({stage:'validating',progress:3});
    saveStudioRenderStatus(root, editId, {...active,stage:'inspecting',progress:92});
    expect(loadStudioRenderStatus(root, editId)).toMatchObject({stage:'inspecting',progress:92});
  });

  it('rejects invalid persisted progress', () => {
    const filename = path.join(root, 'studio', editId + '.render-status.json');
    fs.mkdirSync(path.dirname(filename));
    fs.writeFileSync(filename, JSON.stringify({...record('running'),progress:101}));
    expect(() => loadStudioRenderStatus(root, editId)).toThrow('Invalid persisted');
  });

    it('refuses malformed persisted state', () => {
    const filename = path.join(root, 'studio', editId + '.render-status.json');
    fs.mkdirSync(path.dirname(filename));
    fs.writeFileSync(filename, '{"state":"running"}');
    expect(() => loadStudioRenderStatus(root, editId)).toThrow('Invalid persisted');
  });
});
