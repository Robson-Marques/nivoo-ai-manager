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

  it('enforces bounded output from a noisy command', async () => {
    await expect(runStudioMediaCommand('ffmpeg',['-hide_banner','-filters'],{
      timeoutMs:30_000,maxOutputBytes:512,
    })).rejects.toThrow('limite de saída');
  });

  it('times out a long-running encode rather than leaving a child forever', async () => {
    await expect(runStudioMediaCommand('ffmpeg',[
      '-nostdin','-hide_banner','-loglevel','error','-re',
      '-f','lavfi','-i','color=c=black:s=16x16:r=30',
      '-t','15','-f','null','-',
    ],{timeoutMs:1000})).rejects.toThrow('tempo limite');
  });

    it('interrupts a running encode after the cancellation flag changes', async () => {
    let cancelled=false;
    const started=Date.now();
    const job=runStudioMediaCommand('ffmpeg',[
      '-nostdin','-hide_banner','-loglevel','error','-re',
      '-f','lavfi','-i','color=c=black:s=16x16:r=30',
      '-t','15','-f','null','-',
    ],{timeoutMs:30_000,isCancelled:()=>cancelled});
    setTimeout(()=>{cancelled=true},500);
    await expect(job).rejects.toThrow('cancelada');
    expect(Date.now()-started).toBeLessThan(10_000);
  });

    it('rejects invalid resource bounds', async () => {
    await expect(runStudioMediaCommand('ffprobe',['-version'],{timeoutMs:0})).rejects.toThrow('timeout');
  });
});
