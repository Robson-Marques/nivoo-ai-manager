import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { probeStudioMedia, runStudioMediaCommand } from '../src/video-studio/studio-media-process';

const hasFfmpeg = spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status === 0 &&
  spawnSync('ffprobe',['-version'],{stdio:'ignore'}).status === 0;

(hasFfmpeg ? describe : describe.skip)('Studio media process execution', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-media-process-')); });
  afterEach(() => { fs.rmSync(dir, {recursive:true,force:true}); });

  it('probes real media asynchronously and returns bounded metadata', async () => {
    const target=path.join(dir,'clip.mp4');
    await runStudioMediaCommand('ffmpeg',[
      '-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:r=10',
      '-t','1','-c:v','mpeg4','-y',target,
    ],{timeoutMs:30_000});
    const probe=await probeStudioMedia(target);
    expect(probe.video).toMatchObject({width:64,height:64});
    expect(probe.audio).toBe(false);
    expect(probe.duration).toBeGreaterThan(0);
  });

  it('rejects invalid media instead of returning a successful empty probe', async () => {
    const file=path.join(dir,'bad.mp4');
    fs.writeFileSync(file,'not a movie');
    await expect(probeStudioMedia(file)).rejects.toThrow();
  });

  it('honors cancellation before launching a subprocess', async () => {
    await expect(runStudioMediaCommand('ffprobe',['-version'],{
      timeoutMs:1000,isCancelled:()=>true,
    })).rejects.toThrow('cancelada');
  });

  it('rejects invalid resource bounds', async () => {
    await expect(runStudioMediaCommand('ffprobe',['-version'],{timeoutMs:0})).rejects.toThrow('timeout');
  });
});
