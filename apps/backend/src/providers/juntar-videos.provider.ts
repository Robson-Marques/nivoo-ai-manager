import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

/**
 * Junta as cenas geradas (Veo gera 4–8 s por vez) num vídeo só, na ordem do plano, com o ffmpeg do servidor.
 * Sem IA e sem custo. Cada cena é padronizada (mesmo tamanho da primeira, 24 quadros/s, H.264 + AAC; cena
 * sem som ganha silêncio) e depois as cenas são emendadas sem perder qualidade de novo. As cenas continuam
 * na pasta (dá para trocar uma e juntar de novo).
 */
@Injectable()
export class JuntarVideosProvider implements AiProvider {
  readonly id = 'juntar-videos';
  readonly label = 'Juntar cenas em um vídeo (sistema)';
  readonly kind = 'executor' as const;

  async checkAvailability(): Promise<ProviderStatus> {
    const r = await runProcess('ffmpeg', ['-hide_banner', '-version'], { cwd: os.tmpdir(), env: minimalEnv(), timeoutMs: 15_000 });
    const ok = !r.spawnError && r.exitCode === 0;
    return {
      id: this.id, label: this.label, kind: this.kind, available: ok, installed: ok, authenticated: true, limits: {},
      capabilities: ['juntar-videos'], errors: ok ? [] : ['ffmpeg não está instalado no servidor (apt install ffmpeg)'],
      checkedAt: new Date().toISOString(), isAi: false,
    };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const o = (req.options ?? {}) as { cenas?: string[]; arquivo?: string };
    const cenas = o.cenas ?? [];
    if (cenas.length < 1 || !o.arquivo) return { exitCode: 1, output: '', error: 'etapa sem cenas ou sem o nome do vídeo final' };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-juntar-'));
    const ff = (args: string[], timeoutMs = 600_000) => runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: tmp, env: minimalEnv(), timeoutMs, signal: req.signal });
    const probe = (arq: string, args: string[]) => runProcess('ffprobe', ['-v', 'error', ...args, arq], { cwd: tmp, env: minimalEnv(), timeoutMs: 60_000 });
    try {
      const entradas: string[] = [];
      for (const c of cenas) {
        const abs = resolveInside(req.cwd, c);
        if (!fs.existsSync(abs) || !fs.statSync(abs).size) return { exitCode: 1, output: '', error: `cena não encontrada: ${c}` };
        entradas.push(abs);
      }
      // Tamanho do vídeo final = o da primeira cena (as outras se ajustam, com faixa se a proporção for outra).
      const dim = await probe(entradas[0], ['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x']);
      if (dim.spawnError) return { exitCode: 1, output: '', error: 'ffmpeg não está instalado no servidor (apt install ffmpeg)', resourceUnavailable: true };
      const [w, h] = dim.stdout.trim().split('x').map(Number);
      if (!w || !h) return { exitCode: 1, output: '', error: `não consegui ler o vídeo ${cenas[0]}` };
      const W = w - (w % 2);
      const H = h - (h % 2);
      req.onLog(`Juntando ${cenas.length} cena(s) em ${o.arquivo} (${W}x${H})`);
      const partes: string[] = [];
      for (let i = 0; i < entradas.length; i++) {
        if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
        const temSom = (await probe(entradas[i], ['-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0'])).stdout.trim() !== '';
        const parte = path.join(tmp, `parte-${String(i).padStart(3, '0')}.mp4`);
        const video = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`;
        const args = temSom
          ? ['-i', entradas[i], '-map', '0:v:0', '-map', '0:a:0']
          : ['-i', entradas[i], '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', '-shortest'];
        const r = await ff([...args, '-vf', video, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', parte]);
        if (r.exitCode !== 0) {
          if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
          return { exitCode: 1, output: '', error: `não consegui preparar ${cenas[i]}: ${r.stderr.trim().slice(-300)}` };
        }
        partes.push(parte);
        req.onLog(`cena ${i + 1}/${cenas.length} pronta: ${cenas[i]}`);
      }
      const saida = path.join(tmp, 'final.mp4');
      // Transição suave entre as cenas (fusão de imagem e de som), em vez do corte seco que deixava trancos e
      // micro-pausas no áudio. Cena curta demais para a fusão: emenda simples.
      const duracoes: number[] = [];
      for (const p of partes) duracoes.push(Number((await probe(p, ['-show_entries', 'format=duration', '-of', 'csv=p=0'])).stdout.trim()) || 0);
      const T = Number(process.env.NIVOO_VIDEO_TRANSICAO_SEG ?? 0.5);
      let r: Awaited<ReturnType<typeof ff>> | null = null;
      if (partes.length > 1 && T > 0 && duracoes.every((d) => d > T * 2)) {
        const filtros: string[] = [];
        let v = '0:v';
        let a = '0:a';
        let acumulado = duracoes[0];
        for (let i = 1; i < partes.length; i++) {
          const offset = (acumulado - T).toFixed(3);
          filtros.push(`[${v}][${i}:v]xfade=transition=fade:duration=${T}:offset=${offset}[v${i}]`);
          filtros.push(`[${a}][${i}:a]acrossfade=d=${T}:c1=tri:c2=tri[a${i}]`);
          v = `v${i}`;
          a = `a${i}`;
          acumulado += duracoes[i] - T;
        }
        r = await ff([
          ...partes.flatMap((p) => ['-i', p]),
          '-filter_complex', filtros.join(';'),
          '-map', `[${v}]`, '-map', `[${a}]`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', saida,
        ], 1_800_000);
        if (r.exitCode !== 0) req.onLog(`transição suave não deu certo (${r.stderr.trim().slice(-200)}); emendando sem transição`, 'WARN');
      }
      if (!r || r.exitCode !== 0) {
        const lista = path.join(tmp, 'lista.txt');
        fs.writeFileSync(lista, partes.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
        r = await ff(['-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', saida]);
      }
      if (r.exitCode !== 0) return { exitCode: 1, output: '', error: `não consegui juntar as cenas: ${r.stderr.trim().slice(-300)}`, interrupted: req.signal.aborted };
      const destino = resolveInside(req.cwd, o.arquivo);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(saida, destino);
      const dur = Number((await probe(destino, ['-show_entries', 'format=duration', '-of', 'csv=p=0'])).stdout.trim());
      const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
      const resumo = `Vídeo completo: ${o.arquivo} (${cenas.length} cenas, ${Number.isFinite(dur) ? `${Math.round(dur)} s, ` : ''}${mb} MB)`;
      req.onLog(resumo);
      return { exitCode: 0, output: resumo, stopReason: 'completed' };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
