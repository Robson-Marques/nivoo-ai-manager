import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
type Quadro = '08' | '30' | '58' | '85' | 'final';
const tempos: Record<Quadro, number> = { '08': 0.08, '30': 0.30, '58': 0.58, '85': 0.85, final: 0.99 };
// Aceita tanto out/quadro-08.png quanto out/qualidade/quadro-08.png.
// A versão anterior exigia subpasta e ignorava silenciosamente o plano real.
const padrao = /test\s+-s\s+['"]?(out\/(?:[A-Za-z0-9_.-]+\/)*quadro-(08|30|58|85|final)\.png)['"]?/g;

/** Detecta somente conferências que exigem quadros reais de um MP4. */
export function quadrosRequeridos(command: string): Array<{ destino: string; momento: Quadro }> {
  const seen = new Set<string>();
  const list: Array<{ destino: string; momento: Quadro }> = [];
  for (const match of command.matchAll(padrao)) {
    const destino = match[1], momento = match[2] as Quadro;
    const partes = destino.split('/');
    if (partes.includes('..') || partes.includes('.') || seen.has(destino)) continue;
    seen.add(destino);
    list.push({ destino, momento });
  }
  // Não intercepta validações genéricas de imagem: só storyboard 3+ quadros.
  return list.length >= 3 ? list : [];
}

/**
 * A etapa do backend lê a mídia permanente, sem precisar da sandbox da IA.
 * Cria somente PNGs ausentes. Não altera MP4 nem executa renderização.
 */
export async function prepararQuadrosDoVideo(
  worktree: string,
  mediaDir: string,
  command: string,
  saidasPlanejadas: string[],
): Promise<{ gerados: string[]; video?: string; erro?: string }> {
  const required = quadrosRequeridos(command);
  if (!required.length) return { gerados: [] };
  const missing = required.filter(({ destino }) => {
    const target = path.resolve(worktree, destino);
    return !fs.existsSync(target) || fs.statSync(target).size === 0;
  });
  if (!missing.length) return { gerados: [] };

  let chosen: string | null = null;
  let filename = '';
  const seen = new Set<string>();
  for (const item of [...saidasPlanejadas].reverse()) {
    const m = /^midia\/saida\/([A-Za-z0-9._-]+\.mp4)$/i.exec(item);
    if (!m || seen.has(item)) continue;
    seen.add(item);
    const root = fs.existsSync(mediaDir) ? fs.realpathSync(mediaDir) : '';
    const target = path.resolve(mediaDir, 'saida', m[1]);
    try {
      const real = fs.realpathSync(target);
      if (!root || !real.startsWith(root + path.sep) || !fs.statSync(real).isFile() || fs.statSync(real).size === 0) continue;
      chosen = real;
      filename = item;
      break;
    } catch { /* tenta a saída anterior do mesmo trabalho */ }
  }
  if (!chosen) return { gerados: [], erro: 'MP4 deste trabalho não encontrado na mídia permanente; não iniciar sessões de IA para gerar PNGs inacessíveis' };

  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', chosen], {
      timeout: 20000, maxBuffer: 512 * 1024,
    });
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
    const duration = Number(info.format?.duration);
    const video = info.streams?.find(s => s.codec_type === 'video');
    if (!Number.isFinite(duration) || duration <= 0 || !video?.width || !video.height) {
      return { gerados: [], erro: 'MP4 sem duração ou faixa de vídeo válida no ffprobe' };
    }
    const generated: string[] = [];
    for (const { destino, momento } of missing) {
      const target = path.resolve(worktree, destino);
      if (!target.startsWith(path.resolve(worktree) + path.sep)) return { gerados: generated, erro: 'Destino de quadro fora do trabalho' };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const instant = Math.max(0, Math.min(duration - 0.08, duration * tempos[momento]));
      try {
        await exec('ffmpeg', [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', instant.toFixed(3),
          '-i', chosen, '-map', '0:v:0', '-frames:v', '1', '-an', target,
        ], { timeout: 30000, maxBuffer: 128 * 1024 });
      } catch (e) {
        return { gerados: generated, video: filename, erro: 'Falha na extração de ' + destino + ': ' + (e instanceof Error ? e.message : String(e)).slice(0, 300) };
      }
      if (!fs.existsSync(target) || fs.statSync(target).size === 0) return { gerados: generated, video: filename, erro: 'FFmpeg não criou ' + destino };
      generated.push(destino);
    }
    // Evidência independente: metadados técnicos sem afirmar aprovação artística.
    const folder = path.dirname(path.resolve(worktree, required[0].destino));
    const report = path.join(folder, 'conferencia-video.json');
    fs.writeFileSync(report, JSON.stringify({
      video: filename, durationSeconds: duration, width: video.width, height: video.height,
      hasAudio: info.streams?.some(s => s.codec_type === 'audio') ?? false,
      frames: required.map(x => ({ path: x.destino, instantSeconds: Math.max(0, Math.min(duration - 0.08, duration * tempos[x.momento])) })),
      origin: 'ffprobe/ffmpeg executados pelo backend; qualidade visual exige revisão separada',
    }, null, 2));
    return { gerados: generated, video: filename };
  } catch (e) {
    return { gerados: [], video: filename, erro: 'Conferência técnica indisponível: ' + (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
