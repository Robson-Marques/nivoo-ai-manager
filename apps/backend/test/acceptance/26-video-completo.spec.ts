/**
 * Vídeo inteiro, não cenas: o Veo gera 4–8 s por vez, então o plano com duas ou mais cenas ganha sozinho a
 * etapa do sistema "juntar-videos" (ffmpeg), que emenda as cenas na ordem num vídeo só — mesmo com tamanhos
 * diferentes e cena sem som. As cenas continuam na pasta.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { comVideoCompleto } from '../../src/jobs/jobs.service';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const ffprobe = (arq: string, ...args: string[]) => execFileSync('ffprobe', ['-v', 'error', ...args, arq]).toString().trim();

describe('Vídeo completo (cenas juntadas)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    await h.close();
  });

  it('plano com 2+ cenas ganha a etapa final; com 1 cena ou já com a etapa, nada muda', () => {
    const cena = (key: string, arquivo?: string) => ({ key, provider: 'gemini-video', instructions: 'x', ...(arquivo ? { providerOptions: { arquivo } } : {}) });
    const plano = comVideoCompleto([cena('c1', 'videos/pizzaria/cena-01.mp4'), cena('c2', 'videos/pizzaria/cena-02.mp4')], 'claude-code-cli') as any[];
    expect(plano).toHaveLength(3);
    expect(plano[2]).toMatchObject({
      key: 'video-completo', provider: 'juntar-videos', dependsOn: ['c1', 'c2'],
      providerOptions: { cenas: ['videos/pizzaria/cena-01.mp4', 'videos/pizzaria/cena-02.mp4'], arquivo: 'videos/pizzaria/pizzaria-completo.mp4' },
    });
    expect((comVideoCompleto([cena('a'), cena('b')], 'x') as any[])[2].providerOptions.arquivo).toBe('videos/video-completo.mp4');
    expect(comVideoCompleto([cena('a')], 'x')).toHaveLength(1);
    expect(comVideoCompleto(plano, 'x')).toHaveLength(3);
  });

  it('junta as cenas na ordem (tamanhos diferentes, uma sem som) num mp4 só, que entra na pasta do projeto', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Vídeo pizzaria' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    // Cenas já na pasta principal (como se o Veo tivesse gerado): 1280x720 com som; 640x480 sem som.
    const pasta = path.join(repo, 'videos', 'pizzaria');
    fs.mkdirSync(pasta, { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    ff('-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(pasta, 'cena-01.mp4'));
    ff('-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(pasta, 'cena-02.mp4'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cenas'], { cwd: repo });

    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'juntar', objective: 'vídeo completo', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'junta', providerOptions: { cenas: ['videos/pizzaria/cena-01.mp4', 'videos/pizzaria/cena-02.mp4'], arquivo: 'videos/pizzaria/pizzaria-completo.mp4' } }],
        criteria: [{ key: 'v', description: 'vídeo final existe', kind: 'FILE_EXISTS', config: { path: 'videos/pizzaria/pizzaria-completo.mp4' } }],
      }).expect(201)
    ).body;
    // Caminho fora do projeto ou final com nome de cena: recusado.
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'x', objective: 'x', defaultProvider: 'juntar-videos', steps: [{ key: 'f', provider: 'juntar-videos', instructions: 'x', providerOptions: { cenas: ['../fora.mp4'], arquivo: 'a.mp4' } }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(400);
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'x', objective: 'x', defaultProvider: 'juntar-videos', steps: [{ key: 'f', provider: 'juntar-videos', instructions: 'x', providerOptions: { cenas: ['a.mp4'], arquivo: 'a.mp4' } }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(400);

    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    expect(fim.attempts[0].output).toMatch(/Vídeo completo: videos\/pizzaria\/pizzaria-completo\.mp4 \(2 cenas, 5 s/);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-final-'));
    const final = path.join(tmp, 'final.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/pizzaria/pizzaria-completo.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    expect(ffprobe(final, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x')).toBe('1280x720');
    expect(ffprobe(final, '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0')).toBe('aac');
    expect(Number(ffprobe(final, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(5, 0);
    // As cenas continuam na pasta (dá para trocar uma e juntar de novo).
    const arquivos = execFileSync('git', ['ls-tree', '-r', '--name-only', 'main', 'videos'], { cwd: repo }).toString().trim().split('\n');
    expect(arquivos.sort()).toEqual(['videos/pizzaria/cena-01.mp4', 'videos/pizzaria/cena-02.mp4', 'videos/pizzaria/pizzaria-completo.mp4']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
