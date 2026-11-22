import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type StudioRuntimeCapability = {
  id: 'ffmpeg'|'ffprobe'|'faster-whisper'|'whisperx'|'remotion'|'hyperframes'|'kokoro'|'yt-dlp';
  state: 'ready'|'unavailable'|'blocked';
  detail: string;
};

function executable(bin: string, args: string[], timeout = 5000): boolean {
  const result = spawnSync(bin, args, {
    timeout, encoding: 'utf8', stdio: 'ignore', windowsHide: true,
  });
  return result.status === 0 && !result.error;
}

function studioPython(): string {
  return process.env.NIVOO_STUDIO_PYTHON?.trim() || '/opt/nivoo/studio-venv/bin/python';
}

function pythonModule(moduleName: string): boolean {
  const python = studioPython();
  if (!existsSync(python)) return false;
  return executable(python, ['-c', 'import ' + moduleName], 10000);
}

/**
 * Read-only, bounded diagnostic. This never downloads, installs or runs a render.
 * CLI presence is not proof of render parity, so experimental engines stay blocked.
 */
export function inspectStudioRuntime(): StudioRuntimeCapability[] {
  const ffmpeg = executable('ffmpeg', ['-version']);
  const ffprobe = executable('ffprobe', ['-version']);
  const whisper = pythonModule('faster_whisper');
  const whisperx = pythonModule('whisperx');
  const remotion = executable('remotion', ['--version']);
  const hyperframes = executable('hyperframes', ['--help']);
  const kokoroUrl = process.env.NIVOO_KOKORO_URL || 'http://127.0.0.1:8880';
  const localKokoro = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(kokoroUrl);
  return [
    { id: 'ffmpeg', state: ffmpeg ? 'ready' : 'unavailable', detail: ffmpeg ? 'Exportação FFmpeg instalada' : 'FFmpeg ausente no servidor' },
    { id: 'ffprobe', state: ffprobe ? 'ready' : 'unavailable', detail: ffprobe ? 'Inspeção de mídia instalada' : 'FFprobe ausente no servidor' },
    { id: 'faster-whisper', state: whisper ? 'ready' : 'unavailable', detail: whisper ? 'Transcrição Python instalada' : 'Instale pelo nivoo update' },
    { id: 'whisperx', state: whisperx ? 'ready' : 'unavailable', detail: whisperx ? 'Alinhamento de palavras instalado' : 'Alinhamento avançado não instalado' },
    { id: 'remotion', state: 'blocked', detail: remotion ? 'CLI detectada; bundle e paridade não validados' : 'Bundle e CLI não provisionados; exportação bloqueada' },
    { id: 'hyperframes', state: 'blocked', detail: hyperframes ? 'CLI detectada; projeto e prévia não validados' : 'CLI e fluxo de prévia não provisionados' },
    { id: 'kokoro', state: 'blocked', detail: localKokoro ? 'Verifique disponibilidade da API local antes de gerar voz' : 'Endpoint local inválido ou não configurado' },
    { id: 'yt-dlp', state: 'blocked', detail: 'Importação remota desativada até isolamento de rede' },
  ];
}
