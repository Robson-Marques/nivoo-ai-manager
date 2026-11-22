import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderRemotionComposition } from '../src/video/video-remotion-runner';

describe('Remotion runner boundaries', () => {
  let root: string;
  let bundle: string;
  let props: string;
  let output: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nivoo-remotion-'));
    bundle = join(root, 'bundle');
    props = join(root, 'props.json');
    output = join(root, 'out.mp4');
    await mkdir(bundle);
    await writeFile(props, '{}');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('rejects output paths outside workspace before invoking CLI', async () => {
    await expect(renderRemotionComposition(root, bundle, 'Video', props, '/tmp/other/out.mp4'))
      .rejects.toThrow('outside');
  });

  it('rejects symlinked props before invoking CLI', async () => {
    const link = join(root, 'props-link.json');
    await symlink(props, link);
    await expect(renderRemotionComposition(root, bundle, 'Video', link, output))
      .rejects.toThrow('symlink');
  });

  it('rejects invalid composition identifiers', async () => {
    await expect(renderRemotionComposition(root, bundle, '../../unsafe', props, output))
      .rejects.toThrow('composition ID');
  });

  it('rejects malformed props before starting a render', async () => {
    await writeFile(props, '{broken');
    await expect(renderRemotionComposition(root, bundle, 'Video', props, output))
      .rejects.toThrow('JSON');
  });

  it('rejects oversized props before starting a render', async () => {
    await writeFile(props, '{"padding":"' + 'x'.repeat(1_000_000) + '"}');
    await expect(renderRemotionComposition(root, bundle, 'Video', props, output))
      .rejects.toThrow('bounded');
  });

  it('rejects arbitrary media paths before invoking CLI', async () => {
    await writeFile(props,JSON.stringify({
      fps:30,durationInFrames:30,
      layers:[{type:'video',src:'/etc/passwd'}],
    }));
    await expect(renderRemotionComposition(root,bundle,'Video',props,output))
      .rejects.toThrow('staged');
  });

  it('rejects missing render metadata before invoking CLI', async () => {
    await writeFile(props,'{}');
    await expect(renderRemotionComposition(root,bundle,'Video',props,output))
      .rejects.toThrow('metadata');
  });

  it('rejects invalid output extensions', async () => {
    await expect(renderRemotionComposition(root, bundle, 'Video', props, join(root, 'out.js')))
      .rejects.toThrow('output file');
  });
});
