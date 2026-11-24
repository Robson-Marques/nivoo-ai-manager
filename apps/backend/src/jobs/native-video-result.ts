import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mediaDeliveries,type MediaDelivery } from '../specialties/media/delivery';
import { resolveMidiaOuTrabalho } from '../common/path-guard';

export type VideoResult = { ok: boolean; detail: string; absolutePath?: string; frames?: number; seconds?: number };

/**
 * Contrato TÉCNICO mínimo do MP4. Não revisa arte nem reexecuta a animação.
 * Mídia do projeto mora fora do worktree em NIVOO_MIDIA_DIR/saida/.
 * Não executar shell nem grep sobre paths relativos: é a origem do loop
 * "625/625 -> MP4 salvo -> test -s não achou -> render novamente".
 */
export function videoGeradoPorEtapa(provider: string, instructions: string, opts: Record<string, unknown>): string | null {
  const outputs=mediaDeliveries(provider,instructions,opts).filter(d=>d.kind==='video'&&/^midia\/saida\/[a-zA-Z0-9._-]+\.mp4$/.test(d.path));
  return outputs.length===1?outputs[0].path:null;
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
  const delivery=mediaDeliveries(provider,instructions,opts).find(d=>d.path===relativePath)??{path:relativePath,kind:'video' as const};
  return inspectMediaDelivery(mediaDir,mediaDir,delivery);
}

/** One technical inspection at the existing verification boundary, for all
 * declared video/audio outputs, including worktree and durable paths. */
export function inspectMediaDelivery(mediaDir:string,worktree:string,delivery:MediaDelivery):VideoResult{
  const relativePath=delivery.path;
  let abs:string;
  try{abs=resolveMidiaOuTrabalho(mediaDir,worktree,relativePath);}
  catch{return {ok:false,detail:'caminho de mídia inválido: '+relativePath};}
  let stat:fs.Stats;
  try{stat=fs.statSync(abs);}
  catch{return {ok:false,detail:'arquivo de mídia não encontrado: '+relativePath};}
  if (!stat.isFile() || stat.size < 1024) return { ok: false, detail: 'arquivo de mídia vazio ou incompleto: ' + relativePath };
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,nb_frames:format=duration',
    '-of', 'json', abs,
  ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1_000_000 });
  if (probe.error || probe.status !== 0) {
    return { ok: false, detail: 'ffprobe não conseguiu ler a mídia: ' + (probe.error?.message ?? probe.stderr ?? 'erro desconhecido').slice(0, 250) };
  }
  let info: { streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; nb_frames?: string }>; format?: { duration?: string } };
  try { info = JSON.parse(probe.stdout); }
  catch { return { ok: false, detail: 'ffprobe devolveu metadados inválidos da mídia' }; }
  const video = info.streams?.find(s => s.codec_type === 'video');
  const audio = info.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(info.format?.duration);
  if(!Number.isFinite(duration)||duration<=0)return {ok:false,detail:'mídia sem duração válida: '+relativePath};
  if(delivery.kind==='audio'){
    return audio?.codec_name
      ? {ok:true,detail:relativePath+' — áudio '+duration.toFixed(2)+'s',absolutePath:abs,seconds:duration}
      : {ok:false,detail:'arquivo sem áudio reproduzível: '+relativePath};
  }
  if(!video?.codec_name)return {ok:false,detail:'arquivo MP4 não contém vídeo reproduzível'};
  if(delivery.width&&delivery.height&&(video.width!==delivery.width||video.height!==delivery.height))
    return {ok:false,detail:'resolução incorreta: '+video.width+'x'+video.height+'; esperada '+delivery.width+'x'+delivery.height};
  if(delivery.seconds!==undefined&&Math.abs(duration-delivery.seconds)>0.6)
    return {ok:false,detail:'duração incorreta: '+duration.toFixed(2)+'s; esperada '+delivery.seconds+'s'};
  if(delivery.requiresAudio&&!audio?.codec_name)
    return {ok:false,detail:'montagem concluída sem trilha/narração de áudio no MP4'};
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
