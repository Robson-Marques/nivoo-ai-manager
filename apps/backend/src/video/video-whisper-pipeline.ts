import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { VideoComposition } from './video-composition';
import { applySubtitleCues } from './video-caption-composition';
import { parseWhisperSrt } from './video-subtitles';
import { assertWorkspacePath, transcribeWithWhisper } from './video-tool-adapters';

/**
 * Server-side Whisper transcription pipeline. The output is a proposed
 * composition; persistence and approval belong to the caller.
 */
export async function proposeWhisperCaptions(
  workspaceRoot: string,
  inputFile: string,
  outputDir: string,
  composition: VideoComposition,
  language = 'pt',
  signal?: AbortSignal,
): Promise<VideoComposition> {
  const root = await realpath(workspaceRoot);
  const input = await realpath(inputFile);
  assertWorkspacePath(root, input);
  const target = assertWorkspacePath(root, outputDir);
  const expected = join(target, basename(input).replace(/\.[^.]+$/, '') + '.srt');
  assertWorkspacePath(root, expected);
  // Whisper's output must be freshly produced. Do not accidentally consume a
  // previous transcription if the CLI fails without overwriting its file.
  try {
    await lstat(expected);
    throw new Error('Transcription output already exists: use a fresh job directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (signal?.aborted) throw new Error('Video tool aborted');
  const result = await transcribeWithWhisper(root, input, target, language, signal);
  if (result.exitCode !== 0) throw new Error('Whisper transcription failed: exit ' + result.exitCode);
  if (signal?.aborted) throw new Error('Video tool aborted');
  const actual = await realpath(expected);
  assertWorkspacePath(root, actual);
  if (actual !== expected) throw new Error('Unexpected Whisper subtitle output path');
  if (!(await stat(actual)).isFile()) throw new Error('Whisper subtitle output is not a file');
  const info = await stat(actual);
  if (info.size > 2_000_000) throw new Error('Whisper subtitle output too large');
  const srt = await readFile(actual, 'utf8');
  const cues = parseWhisperSrt(srt, composition.durationMs);
  return applySubtitleCues(composition, cues);
}
