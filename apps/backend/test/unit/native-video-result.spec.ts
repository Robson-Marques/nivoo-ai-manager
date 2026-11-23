import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { caminhoRealDoVideo, inspecionarVideoGerado, videoGeradoPorEtapa } from '../../src/jobs/native-video-result';

describe('MP4 técnico no diretório permanente de mídia', () => {
  let dir: string;
  let media: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-media-'));
    media = path.join(dir, 'midia');
    fs.mkdirSync(path.join(media, 'saida'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('identifica a saída do render e da montagem sem comandos de revisão', () => {
    const rel = 'midia/saida/novo-mudo.mp4';
    expect(videoGeradoPorEtapa('local-shell',
      'nivoo-renderizar-motion motion/v3 --saida ' + rel + ' --segundos 25 --tamanho 1080x1920', {})).toBe(rel);
    expect(videoGeradoPorEtapa('juntar-videos', 'juntar trilha',
      { arquivo: 'midia/saida/novo-final.mp4', trilha: { arquivo: 'midia/entrada/trilha.mp3' } }))
      .toBe('midia/saida/novo-final.mp4');
    expect(videoGeradoPorEtapa('nvidia-api', 'Vou renderizar depois', {})).toBeNull();
  });

  it('não aceita symlink para fora da pasta de mídia do projeto', () => {
    const externo = path.join(dir, 'externo.mp4');
    fs.writeFileSync(externo, 'video externo');
    fs.symlinkSync(externo, path.join(media, 'saida', 'atalho.mp4'));
    expect(caminhoRealDoVideo(media, 'midia/saida/atalho.mp4')).toBeNull();
  });

  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
  (ffmpeg ? it : it.skip)('verifica MP4 no diretório de mídia, não no worktree temporário', () => {
    const output = path.join(media, 'saida', 'novo-mudo.mp4');
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=25:d=1',
      '-frames:v', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
    ], { encoding: 'utf8', timeout: 30_000 });
    expect(generated.status).toBe(0);
    const cmd = 'nivoo-renderizar-motion motion/v3 --saida midia/saida/novo-mudo.mp4 --segundos 1 --tamanho 16x16';
    const check = inspecionarVideoGerado(media, 'midia/saida/novo-mudo.mp4',
      'local-shell', cmd);
    expect(check.ok).toBe(true);
    expect(check.absolutePath).toBe(output);
    expect(check.frames).toBe(25);
    expect(check.detail).toContain('sem áudio');
    expect(inspecionarVideoGerado(media, 'midia/saida/novo-mudo.mp4',
      'local-shell', cmd.replace('--tamanho 16x16', '--tamanho 1080x1920')).ok).toBe(false);
  });

  (ffmpeg ? it : it.skip)('exige áudio tecnicamente presente somente na montagem com trilha', () => {
    const output = path.join(media, 'saida', 'novo-final.mp4');
    const gen = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'color=c=black:s=16x16:r=25:d=1', '-frames:v', '25',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
    ], { encoding: 'utf8', timeout: 30_000 });
    expect(gen.status).toBe(0);
    const check = inspecionarVideoGerado(media, 'midia/saida/novo-final.mp4',
      'juntar-videos', 'montar', { trilha: { arquivo: 'midia/entrada/trilha.mp3' } });
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/sem trilha/);
  });
});
