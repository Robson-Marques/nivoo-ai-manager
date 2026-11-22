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
  if (!Number.isFinite(duration) || duration <= 0 || duration > 14_400) {
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
  if (/max_volume:\s*-inf\s*dB/.test(stderr)) return -Infinity;
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
  if (probe.exitCode !== 0 || probe.stdoutTruncated) throw new Error('ffprobe inspection failed or output truncated');
  const { durationMs, hasAudio } = parseProbe(probe.stdout);

  // Long-form scans may take longer than the old fixed 180-second timeout.
  const analysisTimeout = Math.min(3_600_000, Math.max(180_000, durationMs * 2));
  const black = await runVideoTool('ffmpeg', [
    '-nostdin', '-hide_banner', '-i', actual,
    '-vf', 'blackdetect=d=0.15:pix_th=0.10', '-an', '-f', 'null', '-',
  ], root, analysisTimeout, signal);
  if (black.exitCode !== 0 || black.stderrTruncated) throw new Error('Black frame inspection failed or output truncated');

  let audioPeakDbfs: number | undefined;
  if (hasAudio) {
    const audio = await runVideoTool('ffmpeg', [
      '-nostdin', '-hide_banner', '-i', actual,
      '-vn', '-af', 'volumedetect', '-f', 'null', '-',
    ], root, analysisTimeout, signal);
    if (audio.exitCode !== 0 || audio.stderrTruncated) throw new Error('Audio inspection failed or output truncated');
    audioPeakDbfs = parseAudioPeak(audio.stderr);
  }
  return {
    outputExists: true, durationMs, blackFrameCount: parseBlackFrames(black.stderr),
    hasAudio, ...(audioPeakDbfs !== undefined ? { audioPeakDbfs } : {}),
    reviewComplete: false,
  };
}

export const videoProbeParsers = { parseProbe, parseBlackFrames, parseAudioPeak };
