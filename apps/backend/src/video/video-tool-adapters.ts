/**
 * Optional video tool adapters. No API route is exposed by this module.
 * A caller must enforce project permissions, quota, worker leases and artifact ownership.
 */
import { spawn } from 'node:child_process';
import { mkdir, realpath, stat, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

export type VideoTool = 'remotion' | 'hyperframes' | 'whisper' | 'yt-dlp';
export type ToolResult = { exitCode: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean };
const MAX_LOG = 16_384;

export function assertWorkspacePath(root: string, target: string): string {
  const base = resolve(root);
  const file = resolve(target);
  const rel = relative(base, file);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('Path outside project workspace');
  }
  return file;
}

export function validateMediaUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Invalid media URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Only HTTPS media URLs without credentials or custom ports are supported');
  }
  // Strict domain allowlist avoids arbitrary hosts and direct IP access.
  const hosts = ['youtube.com', 'youtu.be', 'vimeo.com'];
  const host = url.hostname.toLowerCase();
  if (!hosts.some(h => host === h || host.endsWith('.' + h))) {
    throw new Error('Media host not allowed');
  }
  if (!['', '443'].includes(url.port)) throw new Error('Unexpected media URL port');
  return url.toString();
}

export async function runVideoTool(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
  isolatedEnv?: NodeJS.ProcessEnv,
): Promise<ToolResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) {
    throw new Error('Invalid timeout');
  }
  if (signal?.aborted) throw new Error('Video tool aborted');
  await mkdir(cwd, { recursive: true });
  if (signal?.aborted) throw new Error('Video tool aborted');
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], {
      cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...(isolatedEnv ?? process.env), NO_COLOR: '1' },
    });
    let stdout = '', stderr = '', settled = false;
    let stdoutBytes = 0, stderrBytes = 0;
    const abort = () => {
      child.kill('SIGKILL');
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(new Error('Video tool aborted')); }
    };
    const append = (prev: string, chunk: Buffer) => (prev + chunk.toString('utf8')).slice(-MAX_LOG);
    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += chunk.length; stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) { settled = true; signal?.removeEventListener('abort', abort); reject(new Error('Video tool timeout')); }
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', err => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(err); }
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!settled) { settled = true; resolveResult({ exitCode: code ?? -1, stdout, stderr, stdoutTruncated: stdoutBytes > MAX_LOG, stderrTruncated: stderrBytes > MAX_LOG }); }
    });
  });
}

export async function probeVideoTools(cwd: string): Promise<Record<VideoTool, ToolResult | { error: string }>> {
  const entries: [VideoTool, string, string[]][] = [
    ['remotion', 'remotion', ['--version']],
    // HyperFrames publishes a CLI; use a preinstalled binary, never npx (which may download code).
    ['hyperframes', 'hyperframes', ['--help']],
    ['whisper', 'whisper', ['--help']],
    ['yt-dlp', 'yt-dlp', ['--version']],
  ];
  const output = await Promise.all(entries.map(async ([name, bin, args]) => {
    try { return [name, await runVideoTool(bin, args, cwd, 10_000)] as const; }
    catch (e) { return [name, { error: e instanceof Error ? e.message : String(e) }] as const; }
  }));
  return {
    ...Object.fromEntries(output),
  } as Record<VideoTool, ToolResult | { error: string }>;
}

export async function importAuthorizedVideo(url: string, root: string, relativeOutputDir: string): Promise<ToolResult> {
  validateMediaUrl(url);
  assertWorkspacePath(root, resolve(root, relativeOutputDir));
  // yt-dlp follows redirects and may fetch additional media URLs on other hosts.
  // An initial URL allowlist is NOT sufficient SSRF protection. Do not enable
  // until the worker runs in an egress-restricted network sandbox.
  throw new Error('Media URL import disabled until network egress isolation is configured');
}

/**
 * Transcribe a local media file with the optional Whisper CLI.
 * The worker is responsible for assigning an isolated output directory.
 * Symlinks are resolved before verifying workspace containment.
 */
export async function transcribeWithWhisper(
  workspaceRoot: string,
  inputFile: string,
  outputDir: string,
  language = 'pt',
  signal?: AbortSignal,
): Promise<ToolResult> {
  const root = await realpath(workspaceRoot);
  const input = await realpath(inputFile);
  assertWorkspacePath(root, input);
  if (!(await stat(input)).isFile()) throw new Error('Transcription input must be a file');
  if (!/^[a-z]{2,3}$/.test(language)) throw new Error('Invalid transcription language');
  const target = assertWorkspacePath(root, outputDir);
  // Check every pre-existing path segment to prevent symlink traversal.
  const relativeTarget = relative(root, target);
  let cursor = root;
  for (const segment of relativeTarget.split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Output path contains a symlink');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await mkdir(target, { recursive: true });
  assertWorkspacePath(root, await realpath(target));
  return runVideoTool('whisper', [
    input, '--language', language, '--output_dir', target,
    '--output_format', 'srt', '--verbose', 'False',
  ], target, 900_000, signal);
}
