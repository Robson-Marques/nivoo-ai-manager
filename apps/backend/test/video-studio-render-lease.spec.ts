import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  acquireStudioRenderLease, readStudioRenderLease, releaseStudioRenderLease,
  recoverDeadStudioRenderLease,
} from '../src/video-studio/render-lease';

describe('Studio cross-process render lease', () => {
  let root: string;
  const editId = randomUUID();
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-render-lock-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('exclusively acquires a lease and rejects a duplicate render', () => {
    const lease = acquireStudioRenderLease(root, editId);
    expect(readStudioRenderLease(root, editId)).toEqual(lease);
    expect(() => acquireStudioRenderLease(root, editId)).toThrow('bloqueada');
    expect(recoverDeadStudioRenderLease(root, editId)).toBe(false);
    expect(releaseStudioRenderLease(root, editId, lease.runId)).toBe(true);
    expect(readStudioRenderLease(root, editId)).toBeUndefined();
  });

  it('does not release a lease owned by a different run', () => {
    const lease = acquireStudioRenderLease(root, editId);
    expect(releaseStudioRenderLease(root, editId, randomUUID())).toBe(false);
    expect(readStudioRenderLease(root, editId)).toEqual(lease);
    expect(releaseStudioRenderLease(root, editId, lease.runId)).toBe(true);
  });

  it('recovers a lease after its owner process has died', () => {
    const lease = acquireStudioRenderLease(root, editId);
    const owner = path.join(root, 'studio', editId + '.render-lock', 'owner.json');
    fs.writeFileSync(owner, JSON.stringify({ ...lease, ownerPid: 2147483647 }));
    expect(recoverDeadStudioRenderLease(root, editId)).toBe(true);
    expect(readStudioRenderLease(root, editId)).toBeUndefined();
    expect(acquireStudioRenderLease(root, editId).runId).toBeTruthy();
  });

  it('refuses to steal a malformed or ownerless lock', () => {
    const dir = path.join(root, 'studio', editId + '.render-lock');
    fs.mkdirSync(dir, { recursive: true });
    expect(recoverDeadStudioRenderLease(root, editId)).toBe(false);
    expect(() => acquireStudioRenderLease(root, editId)).toThrow('bloqueada');
  });
});
