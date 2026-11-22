/**
 * Optional video tool adapters. No API route is exposed by this module.
 * A caller must enforce project permissions, quota, worker leases and artifact ownership.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

export type VideoTool = 'remotion' | 'hyperframes' | 'whisper' | 'yt-dlp';
export type ToolResult = { exitCode: number; stdout: string; stderr: string };
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
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Only HTTPS media URLs without credentials or custom ports are supported');
  }
  // Strict domain allowlist avoids arbitrary hosts and direct IP access.
  const hosts = ['youtube.com', 'youtu.be', 'vimeo.com'];
  const host = url.hostname.toLowerCase();
  if (!hosts.some(h => host === h || host.endsWith('.' + h))) {
    throw new Error('Media host not allowed');
  }
  return url.toString();
}

export async function runVideoTool(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<ToolResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) {
    throw new Error('Invalid timeout');
  }
  await mkdir(cwd, { recursive: true });
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], {
      cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '', stderr = '', settled = false;
    const append = (prev: string, chunk: Buffer) => (prev + chunk.toString('utf8')).slice(-MAX_LOG);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) { settled = true; reject(new Error('Video tool timeout')); }
    }, timeoutMs);
    child.on('error', err => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolveResult({ exitCode: code ?? -1, stdout, stderr }); }
    });
  });
}

export async function probeVideoTools(cwd: string): Promise<Record<VideoTool, ToolResult | { error: string }>> {
  const entries: [VideoTool, string, string[]][] = [
    ['remotion', 'remotion', ['--version']],
    ['hyperframes', 'hyperframes', ['--version']],
    ['whisper', 'whisper', ['--help']],
    ['yt-dlp', 'yt-dlp', ['--version']],
  ];
  const output = await Promise.all(entries.map(async ([name, bin, args]) => {
    try { return [name, await runVideoTool(bin, args, cwd, 10_000)] as const; }
    catch (e) { return [name, { error: e instanceof Error ? e.message : String(e) }] as const; }
  }));
  return Object.fromEntries(output) as Record<VideoTool, ToolResult | { error: string }>;
}

export async function importAuthorizedVideo(url: string, root: string, relativeOutputDir: string): Promise<ToolResult> {
  const output = assertWorkspacePath(root, resolve(root, relativeOutputDir));
  return runVideoTool('yt-dlp', [
    '--ignore-config', '--no-playlist', '--no-progress', '--no-overwrites',
    '--restrict-filenames', '--max-filesize', '500M',
    '--socket-timeout', '15', '--retries', '2',
    '--output', '%(id)s.%(ext)s', validateMediaUrl(url),
  ], output, 300_000);
}
