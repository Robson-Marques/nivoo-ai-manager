import { spawn, ChildProcess } from 'node:child_process';

export type StudioCommandOptions = {
  timeoutMs: number;
  maxOutputBytes?: number;
  onSpawn?: (child: ChildProcess) => void;
  isCancelled?: () => boolean;
};

/** Bounded, asynchronous media process execution. Never invoke a shell. */
export function runStudioMediaCommand(
  executable: 'ffmpeg' | 'ffprobe',
  args: string[],
  options: StudioCommandOptions,
): Promise<string> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 ||
      options.timeoutMs > 3_600_000) throw new Error('Invalid media command timeout');
  const limit = options.maxOutputBytes ?? 256_000;
  if (!Number.isSafeInteger(limit) || limit < 512 || limit > 2_000_000) throw new Error('Invalid media output limit');
  if (options.isCancelled?.()) return Promise.reject(new Error('Renderização cancelada'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = '', bytes = 0, settled = false;
    let timedOut = false, overflow = false, cancelled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancelPoll);
      if (forceKill) clearTimeout(forceKill);
      if (error) reject(error); else resolve(stdout);
    };
    const terminate = () => {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    };
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const failProcess = () => {
      if (forceKill || settled) return;
      terminate();
      forceKill = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 3000);
      forceKill.unref?.();
    };
    const timer = setTimeout(() => { timedOut = true; failProcess(); }, options.timeoutMs);
    const cancelPoll = setInterval(() => {
      try {
        if (options.isCancelled?.()) { cancelled=true; failProcess(); }
      } catch { cancelled=true; failProcess(); }
    }, 250);
    cancelPoll.unref?.();
    const append = (chunk: Buffer, channel: 'stdout'|'stderr') => {
      bytes += chunk.length;
      if (bytes > limit) { overflow = true; failProcess(); return; }
      if (channel === 'stdout') stdout += chunk.toString('utf8');
      else stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'));
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (cancelled || options.isCancelled?.()) return finish(new Error('Renderização cancelada'));
      if (timedOut) return finish(new Error(executable + ' excedeu o tempo limite'));
      if (overflow) return finish(new Error(executable + ' excedeu o limite de saída'));
      if (code !== 0) return finish(new Error(executable + ': ' + stderr.slice(-800)));
      finish();
    });
    try { options.onSpawn?.(child); }
    catch (error) { failProcess(); finish(error as Error); }
  });
}

export type StudioProbe = { video?: { width: number; height: number }; audio: boolean; duration: number };
export async function probeStudioMedia(file: string, options?: {
  onSpawn?: (child: ChildProcess) => void;
  isCancelled?: () => boolean;
}): Promise<StudioProbe> {
  const output = await runStudioMediaCommand('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json', file,
  ], { timeoutMs: 30_000, maxOutputBytes: 100_000, ...options });
  let parsed: any;
  try { parsed = JSON.parse(output); }
  catch { throw new Error('ffprobe retornou dados inválidos'); }
  if (!parsed || !Array.isArray(parsed.streams) || !parsed.format) throw new Error('Metadados de mídia inválidos');
  const video = parsed.streams.find((s: any) => s.codec_type === 'video');
  const duration = Number(parsed.format.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86_400) throw new Error('Duração de mídia inválida');
  if (video && (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) ||
      video.width < 2 || video.height < 2)) throw new Error('Resolução de mídia inválida');
  return { ...(video ? { video: { width: video.width, height: video.height } } : {}),
    audio: parsed.streams.some((s: any) => s.codec_type === 'audio'), duration };
}
