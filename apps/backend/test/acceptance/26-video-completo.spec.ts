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
    const comLocucao = comVideoCompleto([
      { ...cena('n1'), providerOptions: { arquivo: 'videos/n/cena-01.mp4', narracao: { texto: 'Olá', motor: 'kokoro', voz: 'pf_dora' } } },
      cena('n2', 'videos/n/cena-02.mp4'),
    ], 'x') as any[];
    expect(comLocucao[0].providerOptions.semAudio).toBe(true);
    expect(comLocucao[1].providerOptions.semAudio).toBe(true);
    expect(comLocucao[2].providerOptions).toMatchObject({ narracao: { texto: 'Olá', motor: 'kokoro', voz: 'pf_dora' }, volumeCenas: 0 });
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

  it('edição: corta início/fim de um clipe e acelera outro (ffmpeg, sem IA) — duração final confere', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Edição' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    const pasta = path.join(repo, 'videos', 'corte');
    fs.mkdirSync(pasta, { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    // Clipe 1: 5 s (vou cortar para [1,3] = 2 s). Clipe 2: 4 s (vou acelerar 2x = 2 s). Os dois 1280x720 com som.
    ff('-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(pasta, 'a.mp4'));
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(pasta, 'b.mp4'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'clipes'], { cwd: repo });
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'editar', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'edita', providerOptions: {
          cenas: ['videos/corte/a.mp4', 'videos/corte/b.mp4'],
          cortes: [{ inicio: 1, fim: 3 }, { velocidade: 2 }],
          transicoes: ['corte'],
          arquivo: 'videos/corte/final.mp4',
        } }],
        criteria: [{ key: 'v', description: 'final existe', kind: 'FILE_EXISTS', config: { path: 'videos/corte/final.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edicao-'));
    const final = path.join(tmp, 'final.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/corte/final.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    // 2 s (clipe 1 cortado) + 2 s (clipe 2 acelerado) com corte seco entre eles ≈ 4 s (não os ~9 s sem edição).
    expect(Number(ffprobe(final, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(4, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('vídeo enviado pelo app (streaming): entra na mídia fora do git, é editado em midia/saida e baixa pela API', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Edição enviada' }).expect(201)).body;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enviar-'));
    const origem = path.join(tmp, 'abertura.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', origem]);
    const bytes = fs.readFileSync(origem);
    // Envia por streaming (corpo bruto), como o navegador faz; não cabe no limite de 60 MB do JSON, mas aqui vai direto.
    const env = await h.http().post(`/api/projects/${p.id}/videos`).query({ nome: 'abertura.mp4' }).set('Content-Type', 'application/octet-stream').send(bytes).expect(201);
    expect(env.body).toMatchObject({ nome: 'abertura.mp4', pasta: 'entrada' });
    expect(env.body.caminho).toMatch(/^midia\/entrada\/[0-9a-f-]+\.mp4$/);
    expect(env.body.bytes).toBe(bytes.length);
    // Aparece na lista; nome inválido é recusado.
    expect((await h.http().get(`/api/projects/${p.id}/videos`).expect(200)).body.videos.map((v: any) => v.caminho)).toContain(env.body.caminho);
    await h.http().post(`/api/projects/${p.id}/videos`).query({ nome: 'arquivo.txt' }).set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(400);

    // Edita: corta o vídeo enviado para [1,3] e salva em midia/saida (fora do git).
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'editar enviado', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'edita', providerOptions: { cenas: [env.body.caminho], cortes: [{ inicio: 1, fim: 3 }], arquivo: 'midia/saida/final.mp4' } }],
        // Critério FILE_EXISTS sobre a MÍDIA (fora do git): tem de achar o arquivo em <projeto>/midia/, não na cópia do repo.
        criteria: [{ key: 'v', description: 'o vídeo final existe na mídia', kind: 'FILE_EXISTS', config: { path: 'midia/saida/final.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO'); // antes dava BLOQUEADO: o critério procurava midia/ dentro do git e não achava
    // O vídeo editado está na mídia (saida), baixa pela API com tipo de vídeo e dura ~2 s.
    const editados = (await h.http().get(`/api/projects/${p.id}/videos`)).body.videos.filter((v: any) => v.pasta === 'saida');
    expect(editados.map((v: any) => v.caminho)).toContain('midia/saida/final.mp4');
    const baixado = await h.http().get(`/api/projects/${p.id}/midia/content`).query({ path: 'midia/saida/final.mp4' }).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(baixado.headers['content-type']).toMatch(/^video\/mp4/);
    expect(baixado.headers['accept-ranges']).toBe('bytes');
    const final = path.join(tmp, 'baixado.mp4');
    fs.writeFileSync(final, baixado.body as Buffer);
    expect(Number(ffprobe(final, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(2, 0);
    // Player pede somente um intervalo: o servidor responde 206 sem baixar o vídeo inteiro.
    const trecho = await h.http().get(`/api/projects/${p.id}/midia/content`).query({ path: 'midia/saida/final.mp4' }).set('Range', 'bytes=10-109').expect(206);
    expect(trecho.headers['content-range']).toBe(`bytes 10-109/${fs.statSync(final).size}`);
    expect(trecho.headers['content-length']).toBe('100');
    expect((trecho.body as Buffer).length).toBe(100);
    // Nada de mídia foi para o git (vídeo é pesado): o repo não tem a pasta midia.
    const repo = path.join(p.workspacePath, 'repo');
    const noGit = execFileSync('git', ['ls-files'], { cwd: repo }).toString();
    expect(noGit).not.toMatch(/midia\//);
    // Apagar o enviado some da lista.
    const vid = env.body.caminho.split('/').pop();
    const apos = (await h.http().delete(`/api/projects/${p.id}/videos/${vid}`).expect(200)).body;
    expect(apos.videos.map((v: any) => v.caminho)).not.toContain(env.body.caminho);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('upload grande (vários pedaços) chega inteiro; corpo vazio é recusado com dica de proxy; resto de 0 byte some da lista', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Upload grande' }).expect(201)).body;
    // ~6 MB enviados pelo mesmo endpoint de streaming: tem de chegar byte a byte, sem perder pedaço.
    const grande = Buffer.alloc(6 * 1024 * 1024, 7);
    const env = await h.http().post(`/api/projects/${p.id}/videos`).query({ nome: 'cena-grande.mp4' }).set('Content-Type', 'application/octet-stream').send(grande).expect(201);
    expect(env.body.bytes).toBe(grande.length);
    expect((await h.http().get(`/api/projects/${p.id}/videos`).expect(200)).body.videos.find((v: any) => v.caminho === env.body.caminho)?.bytes).toBe(grande.length);
    // Corpo vazio (o que um proxy mal configurado entrega): recusado, com a dica de liberar o tamanho no proxy.
    const vazio = await h.http().post(`/api/projects/${p.id}/videos`).query({ nome: 'vazia.mp4' }).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(0)).expect(400);
    expect(JSON.stringify(vazio.body)).toMatch(/vazio|proxy|client_max_body_size/i);
    // Um resto de 0 byte largado na pasta (envio que falhou antes) não aparece na lista nem para a IA.
    const midia = path.join(p.workspacePath, 'midia', 'entrada');
    fs.mkdirSync(midia, { recursive: true });
    fs.writeFileSync(path.join(midia, 'resto-vazio.mp4'), '');
    const lista = (await h.http().get(`/api/projects/${p.id}/videos`).expect(200)).body.videos;
    expect(lista.some((v: any) => v.caminho.endsWith('resto-vazio.mp4'))).toBe(false);
    expect(lista.find((v: any) => v.caminho === env.body.caminho)?.bytes).toBe(grande.length);
  });

  it('upload em PEDAÇOS: os pedaços na ordem viram um vídeo só; pedaço fora de ordem é recusado', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Grande em partes', provider: 'claude-code-cli' }).expect(201)).body;
    const chunk = (q: Record<string, string>, buf: Buffer) =>
      h.http().post(`/api/projects/${p.id}/videos/chunk`).query(q).set('Content-Type', 'application/octet-stream').send(buf);
    const partes = [Buffer.alloc(2048, 1), Buffer.alloc(2048, 2), Buffer.alloc(1000, 3)];
    const total = partes.reduce((n, b) => n + b.length, 0);
    let off = 0;
    let fim: any = null;
    for (let i = 0; i < partes.length; i++) {
      const ehFinal = i === partes.length - 1;
      const q = { nome: 'comercial.mp4', id: 'upload-ABC-123', offset: String(off), tamanho: String(partes[i].length), final: ehFinal ? '1' : '0' };
      const r = await chunk(q, partes[i]).expect(201);
      off += partes[i].length;
      if (ehFinal) fim = r.body;
      else {
        expect(r.body).toEqual({ ok: true, bytes: off });
        // A resposta pode se perder depois da gravação. Repetir o mesmo pedaço confirma o offset sem duplicá-lo.
        expect((await chunk(q, partes[i]).expect(201)).body).toEqual({ ok: true, bytes: off });
      }
    }
    expect(fim.caminho).toMatch(/^midia\/entrada\/[0-9a-f-]+\.mp4$/);
    expect(fim.bytes).toBe(total);
    // Se só a resposta final se perder, repetir o último pedaço devolve o mesmo resultado (não outro arquivo).
    const offsetFinal = total - partes[partes.length - 1].length;
    const finalRepetido = (await chunk({ nome: 'comercial.mp4', id: 'upload-ABC-123', offset: String(offsetFinal), tamanho: String(partes[partes.length - 1].length), final: '1' }, partes[partes.length - 1]).expect(201)).body;
    expect(finalRepetido).toEqual(fim);
    expect((await h.http().get(`/api/projects/${p.id}/videos`).expect(200)).body.videos.find((v: any) => v.caminho === fim.caminho)?.bytes).toBe(total);
    // Pedaço fora de ordem (offset errado) é recusado.
    await chunk({ nome: 'x.mp4', id: 'upload-XYZ-999', offset: '50', tamanho: '10', final: '0' }, Buffer.alloc(10)).expect(400);
    // Extensão não-mídia é recusada já no primeiro pedaço.
    await chunk({ nome: 'x.txt', id: 'upload-TXT-000', offset: '0', final: '1' }, Buffer.alloc(10)).expect(400);
  });

  it('vídeo/áudio anexado À MENSAGEM: vai junto no envio e aparece como anexo da mensagem (não em bandeja separada)', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Reel', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const subir = async (nome: string, buf: Buffer) =>
      (await h.http().post(`/api/projects/${p.id}/videos`).query({ nome }).set('Content-Type', 'application/octet-stream').send(buf).expect(201)).body;
    const vid = await subir('clip.mp4', Buffer.alloc(2048, 7));
    const aud = await subir('trilha.wav', Buffer.alloc(1024, 3));
    // A mensagem leva a mídia por referência (sem base64): o arquivo já está em midia/entrada.
    const minha = (await h.http()
      .post(`/api/projects/${p.id}/conversations/${c.id}/messages`)
      .send({ content: 'vê esse vídeo com a trilha', midia: [{ nome: 'clip.mp4', caminho: vid.caminho }, { nome: 'trilha.wav', caminho: aud.caminho }] })
      .expect(201)).body.messages.find((m: any) => m.role === 'USUARIO');
    expect(minha.attachments).toEqual([
      { nome: 'clip.mp4', tipo: 'video', bytes: 2048, caminho: vid.caminho },
      { nome: 'trilha.wav', tipo: 'audio', bytes: 1024, caminho: aud.caminho },
    ]);
    // Caminho de mídia que não existe é recusado (não deixa anexar lixo) — validado antes mesmo da checagem de
    // "IA respondendo", então vale mesmo com a resposta anterior ainda pendente.
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'x', midia: [{ nome: 'z.mp4', caminho: 'midia/entrada/naoexiste.mp4' }] }).expect(400);
  });

  it('.zip com vários vídeos: o servidor extrai todos (até em subpasta); importar da pasta pega os jogados na mão, menos o do repo', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Zip e pasta' }).expect(201)).body;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
    const mkmp4 = (f: string) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=12:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
    // Zip com 2 vídeos (um numa subpasta) + 1 não-vídeo.
    fs.mkdirSync(path.join(tmp, 'cenas'));
    mkmp4(path.join(tmp, 'cenas', 'a.mp4'));
    mkmp4(path.join(tmp, 'b.mov'));
    fs.writeFileSync(path.join(tmp, 'leia.txt'), 'não é vídeo');
    execFileSync('zip', ['-r', '-q', 'pacote.zip', 'cenas', 'b.mov', 'leia.txt'], { cwd: tmp });
    const env = (await h.http().post(`/api/projects/${p.id}/videos/zip`).query({ nome: 'pacote.zip' }).set('Content-Type', 'application/octet-stream').send(fs.readFileSync(path.join(tmp, 'pacote.zip'))).expect(201)).body;
    expect(env.adicionados.length).toBe(2);
    expect(env.ignorados).toBeGreaterThanOrEqual(1); // o .txt
    expect(env.videos.map((v: any) => v.nome).sort()).toEqual(['a.mp4', 'b.mov']);
    // Zip sem nenhum vídeo é recusado.
    execFileSync('zip', ['-q', 'sotxt.zip', 'leia.txt'], { cwd: tmp });
    await h.http().post(`/api/projects/${p.id}/videos/zip`).query({ nome: 'sotxt.zip' }).set('Content-Type', 'application/octet-stream').send(fs.readFileSync(path.join(tmp, 'sotxt.zip'))).expect(400);

    // Importar da pasta: vídeos jogados na raiz e numa subpasta entram; o que está no repo (git) NÃO é importado.
    const root = p.workspacePath;
    mkmp4(path.join(root, 'solto.mp4'));
    fs.mkdirSync(path.join(root, 'uma-pasta'), { recursive: true });
    mkmp4(path.join(root, 'uma-pasta', 'dentro.mp4'));
    mkmp4(path.join(root, 'repo', 'do-repo.mp4'));
    const imp = (await h.http().post(`/api/projects/${p.id}/videos/importar-da-pasta`).expect(201)).body;
    const importados = imp.videos.map((v: any) => v.nome);
    expect(importados).toContain('solto.mp4');
    expect(importados).toContain('dentro.mp4');
    expect(importados).not.toContain('do-repo.mp4'); // repo/git fica fora da varredura
    expect(fs.existsSync(path.join(root, 'solto.mp4'))).toBe(false); // foi movido para a mídia
    expect(fs.existsSync(path.join(root, 'repo', 'do-repo.mp4'))).toBe(true); // o do repo continua onde estava
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('análise do vídeo (nivoo-analisar-video): extrai quadros e aponta trecho escuro e silêncio, para a IA sugerir cortes', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Análise' }).expect(201)).body;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analise-'));
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    // Vídeo 6 s: 2 s normal, 2 s PRETO + silêncio, 2 s normal.
    ff('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(tmp, 's1.mp4'));
    ff('-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=24:duration=2', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(tmp, 's2.mp4'));
    ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(tmp, 's3.mp4'));
    fs.writeFileSync(path.join(tmp, 'l.txt'), ['s1', 's2', 's3'].map((x) => `file '${path.join(tmp, x)}.mp4'`).join('\n'));
    ff('-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'l.txt'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(tmp, 'v.mp4'));
    const env = (await h.http().post(`/api/projects/${p.id}/videos`).query({ nome: 'v.mp4' }).set('Content-Type', 'application/octet-stream').send(fs.readFileSync(path.join(tmp, 'v.mp4'))).expect(201)).body;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'analisar', objective: 'x', defaultProvider: 'local-shell',
        steps: [{ key: 'analisar', provider: 'local-shell', instructions: `nivoo-analisar-video "${env.caminho}" --pasta out/analise/v`, verifyCommand: 'test -s out/analise/v/resumo.md' }],
        criteria: [{ key: 'c', description: 'x', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    const wt = path.join(p.workspacePath, 'worktrees', j.id, 'out', 'analise', 'v');
    const resumo = fs.readFileSync(path.join(wt, 'resumo.md'), 'utf8');
    expect(resumo).toMatch(/Trechos ESCUROS\/pretos: 0:02/);
    expect(resumo).toMatch(/SILÊNCIOS: 0:02/);
    expect(fs.readdirSync(wt).filter((f) => /^quadro-\d+\.jpg$/.test(f)).length).toBeGreaterThanOrEqual(5);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('motion design: a IA escreve uma animação de código e o sistema renderiza para vídeo (sem Veo) em midia/saida', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Motion' }).expect(201)).body;
    const anim = [
      '<!doctype html><html><head><meta charset=utf-8><style>',
      'html,body{margin:0;height:100%;background:#0b1020;overflow:hidden}',
      '.t{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font:60px sans-serif;opacity:0;animation:a 1s forwards}',
      '@keyframes a{to{opacity:1}}</style></head><body><div class=t>Nivoo</div>',
      '<script>window.__motionSegundos=2;setTimeout(()=>window.__motionFim=true,2100)</script></body></html>',
    ].join('');
    // Etapa de sistema (local-shell): escreve a animação e renderiza. Em um pedido real, a IA é quem escreve o index.html.
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'motion', objective: 'x', defaultProvider: 'local-shell',
        steps: [{ key: 'render', provider: 'local-shell', instructions: `mkdir -p motion/intro && cat > motion/intro/index.html <<'HTML'\n${anim}\nHTML\nnivoo-renderizar-motion motion/intro --saida midia/saida/intro.mp4 --segundos 2 --tamanho 640x360`, verifyCommand: 'true' }],
        criteria: [{ key: 'c', description: 'x', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 120_000);
    expect(fim.status).toBe('CONCLUIDO');
    // O vídeo do motion está na mídia (saida), baixa pela API e dura ~2 s, 640x360.
    const editados = (await h.http().get(`/api/projects/${p.id}/videos`)).body.videos.filter((v: any) => v.pasta === 'saida');
    expect(editados.map((v: any) => v.caminho)).toContain('midia/saida/intro.mp4');
    const baixado = await h.http().get(`/api/projects/${p.id}/midia/content`).query({ path: 'midia/saida/intro.mp4' }).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
    const mp4 = path.join(tmp, 'intro.mp4');
    fs.writeFileSync(mp4, baixado.body as Buffer);
    expect(ffprobe(mp4, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x')).toBe('640x360');
    expect(Number(ffprobe(mp4, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(2, 0);
    // A animação (código) ficou no projeto (reutilizável); o vídeo pesado não foi para o git.
    const repo = path.join(p.workspacePath, 'repo');
    const noGit = execFileSync('git', ['ls-files'], { cwd: repo }).toString();
    expect(noGit).toMatch(/motion\/intro\/index\.html/);
    expect(noGit).not.toMatch(/midia\//);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('narração (voz) de um áudio do projeto: entra por cima e o fundo abaixa sob a voz', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Narração' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    const pasta = path.join(repo, 'videos', 'n');
    fs.mkdirSync(pasta, { recursive: true });
    fs.mkdirSync(path.join(repo, 'audio'), { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    ff('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(pasta, 'cena-01.mp4'));
    // "Narração": um áudio de voz (aqui um tom) que o usuário já tem no projeto.
    ff('-f', 'lavfi', '-i', 'sine=frequency=550:duration=2', '-c:a', 'libmp3lame', path.join(repo, 'audio', 'voz.mp3'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cena e voz'], { cwd: repo });
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'narrar', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'junta', providerOptions: {
          cenas: ['videos/n/cena-01.mp4'], arquivo: 'videos/n/n-completo.mp4',
          trilha: { arquivo: 'audio/voz.mp3', volume: 0.2 }, // só para testar junto; a voz é a de baixo
          narracao: { arquivo: 'audio/voz.mp3', volumeFundoSobVoz: 0.3 },
        } }],
        criteria: [{ key: 'v', description: 'x', kind: 'FILE_EXISTS', config: { path: 'videos/n/n-completo.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    expect(fim.attempts[0].output).toMatch(/narração audio\/voz\.mp3/);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narr-'));
    const final = path.join(tmp, 'f.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/n/n-completo.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    expect(ffprobe(final, '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0')).toBe('aac'); // tem áudio
    expect(Number(ffprobe(final, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(3, 0);
    // Narração inválida (nem texto nem arquivo) é recusada.
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'x', objective: 'x', defaultProvider: 'juntar-videos', steps: [{ key: 'f', provider: 'juntar-videos', instructions: 'x', providerOptions: { cenas: ['videos/n/cena-01.mp4'], arquivo: 'a.mp4', narracao: { voz: 'Kore' } } }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(400);
    // Voz inexistente no catálogo é recusada, com a lista das vozes.
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'x', objective: 'x', defaultProvider: 'juntar-videos', steps: [{ key: 'f', provider: 'juntar-videos', instructions: 'x', providerOptions: { cenas: ['videos/n/cena-01.mp4'], arquivo: 'a.mp4', narracao: { texto: 'oi', voz: 'VozQueNaoExiste' } } }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(400);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('etapa local-shell e critério COMMAND acham midia/ (bash no worktree), como o juntar-videos — não travam', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Midia no bash' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    fs.mkdirSync(path.join(repo, 'videos', 'w'), { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=12:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(repo, 'videos', 'w', 'cena-01.mp4'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cena'], { cwd: repo });
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'montar e conferir com bash', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [
          { key: 'juntar', provider: 'juntar-videos', instructions: 'junta', providerOptions: { cenas: ['videos/w/cena-01.mp4'], arquivo: 'midia/saida/w-completo.mp4' } },
          // Como a IA às vezes monta: uma etapa local-shell (bash) que confere midia/saida no worktree. Tem de achar.
          { key: 'conferir', provider: 'local-shell', instructions: 'test -s midia/saida/w-completo.mp4 && ffprobe -v error -show_entries format=duration -of csv=p=0 midia/saida/w-completo.mp4', dependsOn: ['juntar'], verifyCommand: 'true' },
        ],
        criteria: [{ key: 'v', description: 'o mp4 final existe na mídia', kind: 'COMMAND', config: { command: 'test -s midia/saida/w-completo.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO'); // antes: "Fonte indisponível / Arquivo ausente" porque midia/ não estava no worktree
  });

  it('vídeo pronto SEM áudio + narração mais longa: ganha som e segura o último quadro até a fala acabar (não corta)', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Prévia pronta' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    fs.mkdirSync(path.join(repo, 'videos', 'pr'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'audio'), { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    // Prévia completa SEM faixa de áudio (como a que o usuário já editou em outro lugar), 2 s.
    ff('-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=24:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', path.join(repo, 'videos', 'pr', 'previa.mp4'));
    ff('-f', 'lavfi', '-i', 'sine=frequency=500:duration=4', '-c:a', 'libmp3lame', path.join(repo, 'audio', 'locucao.mp3'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'previa muda e locucao'], { cwd: repo });
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'som na prévia', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'junta', providerOptions: {
          cenas: ['videos/pr/previa.mp4'], arquivo: 'videos/pr/pr-completo.mp4',
          trilha: { arquivo: 'audio/locucao.mp3', volume: 0.2 },
          narracao: { arquivo: 'audio/locucao.mp3' },
        } }],
        criteria: [{ key: 'v', description: 'x', kind: 'FILE_EXISTS', config: { path: 'videos/pr/pr-completo.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'previa-'));
    const final = path.join(tmp, 'f.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/pr/pr-completo.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    expect(ffprobe(final, '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0')).toBe('aac'); // prévia muda ganhou áudio
    // O vídeo não foi cortado em 2 s: segurou o último quadro até a locução (4 s) acabar.
    expect(Number(ffprobe(final, '-show_entries', 'format=duration', '-of', 'csv=p=0'))).toBeCloseTo(4, 0);
    expect(Number(ffprobe(final, '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0'))).toBeCloseTo(4, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('seletor de voz: catálogo com gênero (feminina/masculina) e voz padrão do projeto guardada', async () => {
    const vozes = (await h.http().get('/api/projects/vozes-narracao').expect(200)).body as Array<{ id: string; motor: string; genero: string; estilo: string }>;
    expect(vozes.find((v) => v.id === 'pf_dora')).toMatchObject({ motor: 'kokoro', genero: 'feminina' });
    expect(vozes.find((v) => v.id === 'Kore')).toMatchObject({ motor: 'gemini', genero: 'feminina' });
    expect(vozes.some((v) => v.genero === 'masculina')).toBe(true);
    expect(vozes.every((v) => v.id && v.estilo && (v.genero === 'feminina' || v.genero === 'masculina'))).toBe(true);
    const p = (await h.http().post('/api/projects').send({ name: 'Voz padrão' }).expect(201)).body;
    expect(p).toMatchObject({ motorNarracao: 'kokoro', vozNarracao: 'pf_dora', velocidadeNarracao: 1, modoTrilha: 'sem-trilha' });
    const masc = vozes.find((v) => v.motor === 'kokoro' && v.genero === 'masculina')!;
    const atualizado = (await h.http().patch(`/api/projects/${p.id}`).send({ vozNarracao: masc.id }).expect(200)).body;
    expect(atualizado.vozNarracao).toBe(masc.id);
    await h.http().patch(`/api/projects/${p.id}`).send({ vozNarracao: 'NaoExiste' }).expect(400);
    expect((await h.http().get(`/api/projects/${p.id}`).expect(200)).body.vozNarracao).toBe(masc.id); // não mudou
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

  it('trilha de fundo única (áudio do projeto) de ponta a ponta, abaixando sob a fala das cenas; cenas pedidas sem música', async () => {
    // Plano com trilha: as cenas passam a ser pedidas sem música e a junção leva a trilha.
    const plano = comVideoCompleto(
      [
        { key: 'c1', provider: 'gemini-video', instructions: 'x', providerOptions: { arquivo: 'videos/t/cena-01.mp4', trilha: { arquivo: 'audio/trilha.mp3' } } },
        { key: 'c2', provider: 'gemini-video', instructions: 'x', providerOptions: { arquivo: 'videos/t/cena-02.mp4' } },
      ],
      'x',
    ) as any[];
    expect(plano.slice(0, 2).map((s) => s.providerOptions.semMusica)).toEqual([true, true]);
    expect(plano[2].providerOptions.trilha).toEqual({ arquivo: 'audio/trilha.mp3' });

    const p = (await h.http().post('/api/projects').send({ name: 'Trilha' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    fs.mkdirSync(path.join(repo, 'videos', 't'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'audio'), { recursive: true });
    const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
    // "Fala" só na cena 1 (tom de 1 kHz); cena 2 em silêncio. Trilha: 2 s de 220 Hz (curta: precisa repetir).
    ff('-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(repo, 'videos/t/cena-01.mp4'));
    ff('-f', 'lavfi', '-i', 'color=c=gray:size=640x360:rate=24:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(repo, 'videos/t/cena-02.mp4'));
    ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:a', 'libmp3lame', path.join(repo, 'audio/trilha.mp3'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cenas e trilha'], { cwd: repo });
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'trilha', objective: 'x', defaultProvider: 'juntar-videos',
        steps: [{ key: 'final', provider: 'juntar-videos', instructions: 'junta', providerOptions: plano[2].providerOptions }],
        criteria: [{ key: 'v', description: 'v', kind: 'FILE_EXISTS', config: { path: 'videos/t/t-completo.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 90_000);
    expect(fim.status).toBe('CONCLUIDO');
    expect(fim.attempts[0].output).toMatch(/trilha audio\/trilha\.mp3/);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
    const final = path.join(tmp, 'f.mp4');
    fs.writeFileSync(final, execFileSync('git', ['show', 'main:videos/t/t-completo.mp4'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }));
    // A música não para: o trecho da cena 2 (sem fala, depois da trilha original de 2 s acabar) tem som.
    const volume = (de: string, por: string) => {
      const r = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-ss', de, '-t', por, '-i', final, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? -99);
    };
    expect(volume('3.5', '1')).toBeGreaterThan(-50); // silêncio daria ~ -90 dB
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
