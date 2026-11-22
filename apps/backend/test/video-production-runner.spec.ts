import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoProductionPlan } from '../src/video/video-production-plan';
import { VideoProductionCheckpointStore } from '../src/video/video-production-checkpoint-store';
import { runVideoProduction } from '../src/video/video-production-runner';

const plan: VideoProductionPlan = {
  schemaVersion: 1, projectId: 'project-1', revision: 'rev-1',
  renderEngine: 'remotion', stages: ['inspect-media', 'compose', 'render', 'quality-review'],
  budgetCents: 0, currency: 'BRL', requiresApprovalAboveCents: 0,
};

describe('durable video production execution', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nivoo-production-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('persists completed stages and resumes without repeating them', async () => {
    const store = new VideoProductionCheckpointStore(root);
    const called: string[] = [];
    const first = async (stage: string) => {
      called.push(stage);
      if (stage === 'render') throw new Error('render unavailable');
      return { artifactId: stage.replace(/-/g, '_'), verified: true };
    };
    await expect(runVideoProduction(plan, store, first, undefined, root)).rejects.toThrow('render unavailable');
    expect((await store.load(plan)).checkpoints.map(x => x.stage)).toEqual(['inspect-media', 'compose']);
    const second = await runVideoProduction(plan, new VideoProductionCheckpointStore(root),
      async stage => { called.push(stage); return { artifactId: stage.replace(/-/g, '_'), verified: true }; }, undefined, root);
    expect(second.executed).toEqual(['render', 'quality-review']);
    expect(called).toEqual(['inspect-media', 'compose', 'render', 'render', 'quality-review']);
  });

  it('rejects unverified artifacts without advancing the checkpoint', async () => {
    const store = new VideoProductionCheckpointStore(root);
    await expect(runVideoProduction(plan, store, async () => ({
      artifactId: 'invalid', verified: false,
    }), undefined, root)).rejects.toThrow('Unverified');
    expect((await store.load(plan)).checkpoints).toHaveLength(0);
  });

  it('rejects duplicate stage completion', async () => {
    const store = new VideoProductionCheckpointStore(root);
    await store.completeStage(plan, 'inspect-media', 'inspection', true);
    await expect(store.completeStage(plan, 'inspect-media', 'inspection', true)).rejects.toThrow('out of order');
  });
});
