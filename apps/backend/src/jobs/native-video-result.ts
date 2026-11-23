import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type VideoResult = { ok: boolean; detail: string; absolutePath?: string; frames?: number; seconds?: number };

/**
 * Contrato TÉCNICO mínimo do MP4. Não revisa arte nem reexecuta a animação.
 * Mídia do projeto mora fora do worktree em NIVOO_MIDIA_DIR/saida/.
 * Não executar shell nem grep sobre paths relativos: é a origem do loop
 * "625/625 -> MP4 salvo -> test -s não achou -> render novamente".
 */
export function videoGeradoPorEtapa(provider: string, instructions: string, opts: Record<string, unknown>): string | null {
  if (provider === 'local-shell' && /\bnivoo-renderizar-motion\b/.test(instructions)) {
    const match = /--saida\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(instructions);
    const output = match?.[1] ?? match?.[2] ?? match?.[3];
    return output && /^midia\/saida\/[a-zA-Z0-9._-]+\.mp4$/.test(output) ? output : null;
  }
  if (provider === 'juntar-videos') {
    const output = opts.arquivo;
    return typeof output === 'string' && /^midia\/saida\/[a-zA-Z0-9._-]+\.mp4$/.test(output) ? output : null;
  }
  return null;
}

export function caminhoRealDoVideo(mediaDir: string, relativePath: string): string | null {
  if (!/^midia\/saida\/[a-zA-Z0-9._-]+\.mp4$/.test(relativePath)) return null;
  const candidato = path.resolve(mediaDir, relativePath.slice('midia/'.length));
  try {
    const raiz = fs.realpathSync(mediaDir);
    const video = fs.realpathSync(candidato);
    if (!video.startsWith(raiz + path.sep)) return null;
    return video;
  } catch { return null; }
}

export function inspecionarVideoGerado(
  mediaDir: string,
  relativePath: string,
  provider: string,
  instructions: string,
  opts: Record<string, unknown> = {},
): VideoResult {
  const abs = caminhoRealDoVideo(mediaDir, relativePath);
  if (!abs) return { ok: false, detail: 'arquivo MP4 não encontrado na pasta de mídia do projeto: ' + relativePath };
  const stat = fs.statSync(abs);
  if (!stat.isFile() || stat.size < 1024) return { ok: false, detail: 'arquivo MP4 vazio ou incompleto: ' + relativePath };
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,nb_frames:format=duration',
    '-of', 'json', abs,
  ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1_000_000 });
  if (probe.error || probe.status !== 0) {
    return { ok: false, detail: 'ffprobe não conseguiu ler o MP4: ' + (probe.error?.message ?? probe.stderr ?? 'erro desconhecido').slice(0, 250) };
  }
  let info: { streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; nb_frames?: string }>; format?: { duration?: string } };
  try { info = JSON.parse(probe.stdout); }
  catch { return { ok: false, detail: 'ffprobe devolveu metadados inválidos do MP4' }; }
  const video = info.streams?.find(s => s.codec_type === 'video');
  const audio = info.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(info.format?.duration);
  if (!video?.codec_name || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, detail: 'arquivo MP4 não contém vídeo reproduzível com duração válida' };
  }
  const tamanho = /--tamanho\s+(\d{2,5})x(\d{2,5})/.exec(instructions);
  if (provider === 'local-shell' && tamanho &&
      (video.width !== Number(tamanho[1]) || video.height !== Number(tamanho[2]))) {
    return { ok: false, detail: 'resolução incorreta: ' + video.width + 'x' + video.height + '; esperada ' + tamanho[1] + 'x' + tamanho[2] };
  }
  const segundos = /--segundos\s+(\d+(?:\.\d+)?)/.exec(instructions);
  if (provider === 'local-shell' && segundos && Math.abs(duration - Number(segundos[1])) > 0.6) {
    return { ok: false, detail: 'duração incorreta: ' + duration.toFixed(2) + 's; esperada ' + segundos[1] + 's' };
  }
  if (provider === 'juntar-videos' && !!(opts.trilha || opts.narracao) && !audio?.codec_name) {
    return { ok: false, detail: 'montagem concluída sem trilha/narração de áudio no MP4' };
  }
  const frames = Number(video.nb_frames);
  return {
    ok: true,
    detail: relativePath + ' — ' + stat.size + ' bytes, ' + video.width + 'x' + video.height +
      ', ' + duration.toFixed(2) + 's' + (Number.isFinite(frames) ? ', ' + frames + ' quadros' : '') +
      (audio ? ', áudio presente' : ', sem áudio'),
    absolutePath: abs,
    seconds: duration,
    frames: Number.isFinite(frames) ? frames : undefined,
  };
}
