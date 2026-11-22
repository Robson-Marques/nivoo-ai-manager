import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeWhisperCaptions } from '../src/video/video-whisper-pipeline';
import { VideoComposition } from '../src/video/video-composition';

describe('Whisper pipeline safety', () => {
  let root: string;
  let input: string;
  let output: string;
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'test', revision: 'r1',
    width: 1080, height: 1920, fps: 30, durationMs: 5000, layers: [],
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nivoo-whisper-'));
    input = join(root, 'voice.mp3');
    output = join(root, 'job');
    await writeFile(input, 'fake-media');
    await mkdir(output);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('rejects stale subtitles without invoking Whisper', async () => {
    await writeFile(join(output, 'voice.srt'), '1\n00:00:00,000 --> 00:00:01,000\nOld');
    await expect(proposeWhisperCaptions(root, input, output, composition))
      .rejects.toThrow('already exists');
  });

  it('respects cancellation before executing Whisper', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(proposeWhisperCaptions(root, input, output, composition, 'pt', controller.signal))
      .rejects.toThrow('aborted');
  });

  it('rejects media outside the project workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'nivoo-outside-'));
    try {
      const file = join(outside, 'voice.mp3');
      await writeFile(file, 'fake');
      await expect(proposeWhisperCaptions(root, file, output, composition)).rejects.toThrow('outside');
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
