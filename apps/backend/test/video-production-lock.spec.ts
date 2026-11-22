import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withVideoProductionLock } from '../src/video/video-production-lock';
import { VideoProductionPlan } from '../src/video/video-production-plan';

const plan: VideoProductionPlan = {
  schemaVersion: 1, projectId: 'project-1', revision: 'v1',
  renderEngine: 'remotion', stages: ['render', 'quality-review'],
  budgetCents: 0, currency: 'BRL', requiresApprovalAboveCents: 0,
};

describe('cross-process video production lock', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nivoo-lock-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('rejects concurrent execution of the same revision', async () => {
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const first = withVideoProductionLock(root, plan, async () => {
      entered();
      await wait;
      return 'done';
    });
    await inside;
    try {
      await expect(withVideoProductionLock(root, plan, async () => 'duplicate'))
        .rejects.toThrow('already locked');
    } finally {
      release();
    }
    expect(await first).toBe('done');
    expect(await withVideoProductionLock(root, plan, async () => 'next')).toBe('next');
  });

  it('releases lock when a production stage fails', async () => {
    await expect(withVideoProductionLock(root, plan, async () => {
      throw new Error('renderer failed');
    })).rejects.toThrow('renderer failed');
    expect(await withVideoProductionLock(root, plan, async () => 42)).toBe(42);
  });
});
