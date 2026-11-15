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
    expect(fim.attempts[0].output).toMatch(/Vídeo completo: videos\/pizzaria\/pizzaria-completo\.mp4 \(2 cenas, [45] s/);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-final-'));
    const final = path.join(tmp, 'final.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/pizzaria/pizzaria-completo.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    expect(ffprobe(final, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x')).toBe('1280x720');
    expect(ffprobe(final, '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0')).toBe('aac');
    // 2 s + 3 s com meio segundo de fusão entre as cenas (imagem e som), sem corte seco.
    expect(Number(ffprobe(final, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(4.5, 1);
    // A tela baixa o vídeo pela API: bytes idênticos (antes vinham corrompidos como texto) e tipo de vídeo.
    const pelaApi = await h.http().get(`/api/projects/${p.id}/files/content`).query({ path: 'videos/pizzaria/pizzaria-completo.mp4' }).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(pelaApi.headers['content-type']).toMatch(/^video\/mp4/);
    expect(Buffer.compare(pelaApi.body as Buffer, fs.readFileSync(final))).toBe(0);
    // As cenas continuam na pasta (dá para trocar uma e juntar de novo).
    const arquivos = execFileSync('git', ['ls-tree', '-r', '--name-only', 'main', 'videos'], { cwd: repo }).toString().trim().split('\n');
    expect(arquivos.sort()).toEqual(['videos/pizzaria/cena-01.mp4', 'videos/pizzaria/cena-02.mp4', 'videos/pizzaria/pizzaria-completo.mp4']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('legendas de cada cena gravadas no vídeo (e .srt ao lado, no tempo certo) e transição escolhida', async () => {
    const plano = comVideoCompleto(
      [
        { key: 'c1', provider: 'gemini-video', instructions: 'x', providerOptions: { arquivo: 'videos/p/cena-01.mp4', legenda: 'Queijo derretido', transicao: 'fadeblack' } },
        { key: 'c2', provider: 'gemini-video', instructions: 'x', providerOptions: { arquivo: 'videos/p/cena-02.mp4', legenda: 'Peça já a sua' } },
      ],
      'x',
    ) as any[];
    expect(plano[2].providerOptions).toMatchObject({ legendas: ['Queijo derretido', 'Peça já a sua'], transicoes: ['fadeblack'] });

    const p = (await h.http().post('/api/projects').send({ name: 'Legendas' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    const pasta = path.join(repo, 'videos', 'p');
    fs.mkdirSync(pasta, { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    for (const n of ['01', '02']) ff('-f', 'lavfi', '-i', 'color=c=blue:size=720x1280:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(pasta, `cena-${n}.mp4`));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cenas'], { cwd: repo });
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'x', objective: 'x', defaultProvider: 'juntar-videos', steps: [{ key: 'f', provider: 'juntar-videos', instructions: 'x', providerOptions: { cenas: ['videos/p/cena-01.mp4', 'videos/p/cena-02.mp4'], arquivo: 'videos/p/f.mp4', transicao: 'explodir' } }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(400);
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'legendas', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'junta', providerOptions: plano[2].providerOptions }],
        criteria: [{ key: 'v', description: 'v', kind: 'FILE_EXISTS', config: { path: 'videos/p/p-completo.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    expect(fim.attempts[0].output).toMatch(/com legendas \(videos\/p\/p-completo\.srt\)/);
    const srt = execFileSync('git', ['show', 'main:videos/p/p-completo.srt'], { cwd: repo }).toString();
    // Cena 1: do começo até o meio da transição (3 s - 0,5 s + 0,25 s); cena 2: dali até o fim (5,5 s).
    const blocos = [...srt.matchAll(/(\d+)\n00:00:(\d\d),(\d{3}) --> 00:00:(\d\d),(\d{3})\n(.+)\n/g)].map((m) => [Number(`${m[2]}.${m[3]}`), Number(`${m[4]}.${m[5]}`), m[6]]);
    expect(blocos.map((b) => b[2])).toEqual(['Queijo derretido', 'Peça já a sua']);
    expect(blocos[0][0]).toBeCloseTo(0.2, 1);
    expect(blocos[0][1]).toBeCloseTo(2.75, 1);
    expect(blocos[1][0]).toBe(blocos[0][1]); // a segunda começa onde a primeira termina (no meio da transição)
    expect(blocos[1][1]).toBeCloseTo(5.3, 0);
    // A legenda foi gravada na imagem: o quadro do meio da cena 1 não é mais azul puro.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leg-'));
    const final = path.join(tmp, 'f.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/p/p-completo.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    const quadro = (seg: string) => execFileSync('ffmpeg', ['-v', 'error', '-ss', seg, '-i', final, '-frames:v', '1', '-vf', 'scale=72:128', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const naoAzul = (b: Buffer) => { let n = 0; for (let i = 0; i < b.length; i += 3) if (!(b[i] < 40 && b[i + 1] < 40 && b[i + 2] > 200)) n++; return n; };
    expect(naoAzul(quadro('1.5'))).toBeGreaterThan(20);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
