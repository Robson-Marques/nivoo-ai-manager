import { lstat, realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { assertWorkspacePath, runVideoTool } from './video-tool-adapters';
import { VideoQualityMeasurements } from './video-quality-gate';

type ProbeStream = { codec_type?: string };
type ProbeFormat = { duration?: string };
type ProbeData = { streams?: ProbeStream[]; format?: ProbeFormat };

function parseProbe(stdout: string): { durationMs: number; hasAudio: boolean } {
  let data: ProbeData;
  try { data = JSON.parse(stdout) as ProbeData; }
  catch { throw new Error('Invalid ffprobe JSON'); }
  const duration = Number(data?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) {
    throw new Error('Invalid probed video duration');
  }
  if (!Array.isArray(data.streams) || !data.streams.some(s => s.codec_type === 'video')) {
    throw new Error('Rendered file contains no video stream');
  }
  return { durationMs: Math.round(duration * 1000),
    hasAudio: data.streams.some(s => s.codec_type === 'audio') };
}

function parseBlackFrames(stderr: string): number {
  const matches = stderr.match(/black_start:/g);
  return matches?.length ?? 0;
}

function parseAudioPeak(stderr: string): number {
  const matches = [...stderr.matchAll(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/g)];
  if (!matches.length) throw new Error('Audio peak measurement missing');
  const value = Number(matches[matches.length - 1][1]);
  if (!Number.isFinite(value)) throw new Error('Invalid audio peak measurement');
  return value;
}

/**
 * Perform actual local measurements using preinstalled ffprobe/ffmpeg.
 * Caller must enforce authorization and choose a project-owned output path.
 * This adapter does not mark reviewComplete: independent human/agent review
 * is a separate step, and caption verification needs composition metadata.
 */
export async function inspectRenderedVideo(
  workspaceRoot: string,
  outputFile: string,
  signal?: AbortSignal,
): Promise<VideoQualityMeasurements> {
  const root = await realpath(workspaceRoot);
  const target = assertWorkspacePath(root, resolve(outputFile));
  if (target === root || relative(root, target) === '') throw new Error('Invalid output path');
  let cursor = root;
  for (const segment of relative(root, target).split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Video path contains symlink');
  }
  if (!target.toLowerCase().endsWith('.mp4')) throw new Error('Expected MP4 output');
  const actual = await realpath(target);
  if (actual !== target) throw new Error('Unexpected output path');
  const info = await stat(actual);
  if (!info.isFile() || info.size < 1024 || info.size > 20_000_000_000) {
    throw new Error('Invalid rendered video file');
  }
  const probe = await runVideoTool('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', actual,
  ], root, 30_000, signal);
  if (probe.exitCode !== 0) throw new Error('ffprobe inspection failed');
  const { durationMs, hasAudio } = parseProbe(probe.stdout);

  const black = await runVideoTool('ffmpeg', [
    '-nostdin', '-hide_banner', '-i', actual,
    '-vf', 'blackdetect=d=0.15:pix_th=0.10', '-an', '-f', 'null', '-',
  ], root, 180_000, signal);
  if (black.exitCode !== 0) throw new Error('Black frame inspection failed');

  let audioPeakDbfs: number | undefined;
  if (hasAudio) {
    const audio = await runVideoTool('ffmpeg', [
      '-nostdin', '-hide_banner', '-i', actual,
      '-vn', '-af', 'volumedetect', '-f', 'null', '-',
    ], root, 180_000, signal);
    if (audio.exitCode !== 0) throw new Error('Audio inspection failed');
    audioPeakDbfs = parseAudioPeak(audio.stderr);
  }
  return {
    outputExists: true, durationMs, blackFrameCount: parseBlackFrames(black.stderr),
    hasAudio, ...(audioPeakDbfs !== undefined ? { audioPeakDbfs } : {}),
    reviewComplete: false,
  };
}

export const videoProbeParsers = { parseProbe, parseBlackFrames, parseAudioPeak };
