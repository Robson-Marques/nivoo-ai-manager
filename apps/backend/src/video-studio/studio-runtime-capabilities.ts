import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Caminho do bundle Remotion provisionado (o instalador grava NIVOO_REMOTION_BUNDLE); undefined se não houver. */
export function remotionBundlePath(): string | undefined {
  const b = process.env.NIVOO_REMOTION_BUNDLE?.trim();
  return b && existsSync(join(b, 'index.html')) ? b : undefined;
}

/** A presença da CLI e do bundle não comprova renderização nem paridade. */
function remotionCapability(cliOk: boolean): { state: StudioRuntimeCapability['state']; detail: string } {
  if (cliOk && remotionBundlePath()) return { state: 'ready', detail: 'Remotion experimental disponível para teste após atualização; paridade final e MP4 exigem homologação' };
  if (cliOk) return { state: 'blocked', detail: 'CLI detectada; bundle não provisionado (rode nivoo update)' };
  return { state: 'blocked', detail: 'Bundle e CLI não provisionados; exportação bloqueada' };
}

export type StudioRuntimeCapability = {
  id: 'ffmpeg'|'ffprobe'|'faster-whisper'|'whisperx'|'remotion'|'hyperframes'|'kokoro'|'yt-dlp';
  state: 'ready'|'unavailable'|'blocked';
  detail: string;
};

function executable(bin: string, args: string[], timeout = 4000): Promise<boolean> {
  return new Promise(resolve => {
    execFile(bin, args, { timeout, maxBuffer: 1 << 20, windowsHide: true },
      error => resolve(!error)); // 1 MB: 2 KB estourava em CLIs verbosas (ex.: remotion versions) e dava falso-negativo
  });
}
function studioPython(): string {
  return process.env.NIVOO_STUDIO_PYTHON?.trim() || '/opt/nivoo/studio-venv/bin/python';
}
function pythonModule(moduleName: string): Promise<boolean> {
  const python = studioPython();
  return existsSync(python)
    ? executable(python, ['-c', 'import ' + moduleName], 8000)
    : Promise.resolve(false);
}

/** Non-blocking, cached read-only inventory; CLI presence does not prove render parity. */
let cached: { expires: number; result: StudioRuntimeCapability[] } | undefined;
let pending: Promise<StudioRuntimeCapability[]> | undefined;
export function inspectStudioRuntime(): Promise<StudioRuntimeCapability[]> {
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.result);
  if (pending) return pending;
  pending = (async () => {
    const [ffmpeg, ffprobe, whisper, whisperx, remotion, hyperframes] = await Promise.all([
      executable('ffmpeg', ['-version']), executable('ffprobe', ['-version']),
      pythonModule('faster_whisper'), pythonModule('whisperx'),
      executable('remotion', ['--help']), executable('hyperframes', ['--help']),
    ]);
    const result: StudioRuntimeCapability[] = [
      { id: 'ffmpeg', state: ffmpeg ? 'ready' : 'unavailable', detail: ffmpeg ? 'Exportação FFmpeg instalada' : 'FFmpeg ausente no servidor' },
      { id: 'ffprobe', state: ffprobe ? 'ready' : 'unavailable', detail: ffprobe ? 'Inspeção de mídia instalada' : 'FFprobe ausente no servidor' },
      { id: 'faster-whisper', state: whisper ? 'ready' : 'unavailable', detail: whisper ? 'Transcrição Python instalada' : 'Instale pelo nivoo update' },
      { id: 'whisperx', state: whisperx ? 'ready' : 'unavailable', detail: whisperx ? 'Alinhamento de palavras instalado' : 'Alinhamento avançado não instalado' },
      { id: 'remotion', ...remotionCapability(remotion) },
      { id: 'hyperframes', state: hyperframes ? 'ready' : 'unavailable',
        detail: hyperframes ? 'CLI detectada; geração de motion disponível para teste; confirme o navegador no primeiro render' : 'CLI ausente: a próxima atualização instala o HyperFrames' },
      { id: 'kokoro', state: 'blocked', detail: 'Serviço de voz não verificado neste diagnóstico; utilize a geração de locução do Studio' },
      { id: 'yt-dlp', state: 'blocked', detail: 'Importação remota desativada até isolamento de rede' },
    ];
    cached = { expires: Date.now() + 60_000, result };
    return result;
  })().finally(() => { pending = undefined; });
  return pending;
}
