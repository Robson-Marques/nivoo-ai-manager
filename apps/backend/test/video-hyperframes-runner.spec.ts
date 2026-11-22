import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderHyperFramesProject } from '../src/video/video-hyperframes-runner';

describe('HyperFrames render boundary', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nivoo-hyperframes-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('rejects workspace root instead of executing untrusted project code', async () => {
    await expect(renderHyperFramesProject(root, root)).rejects.toThrow('subdirectory');
  });

  it('rejects a project outside the authorized workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'nivoo-outside-'));
    try {
      await expect(renderHyperFramesProject(root, outside)).rejects.toThrow('outside');
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it('rejects symlinked project directory segments', async () => {
    const target = join(root, 'real');
    await mkdir(target);
    const link = join(root, 'linked');
    await symlink(target, link);
    await expect(renderHyperFramesProject(root, link)).rejects.toThrow('symlink');
  });
});
