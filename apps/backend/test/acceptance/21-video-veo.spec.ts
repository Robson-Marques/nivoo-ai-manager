/**
 * Vídeo com o Veo pela API do Gemini (chave de API), contra uma API do Google SIMULADA localmente com o
 * mesmo formato REST da biblioteca oficial (@google/genai): listar modelos, predictLongRunning, consultar a
 * operação e baixar o vídeo. Cobre: modelos escolhíveis (lista da própria chave), plano da conversa com
 * etapa de vídeo e imagem anexada como primeiro quadro, arquivo salvo no projeto, custo estimado, limite de
 * gasto ANTES de gerar e recusa pelas regras de segurança do Google.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { GeminiVideoProvider } from '../../src/providers/gemini-video.provider';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const VIDEO = Buffer.from('\x00\x00\x00\x18ftypmp42 VIDEO-FALSO-DO-TESTE');
const CHAVE = 'AIzaSy-CHAVE-DE-TESTE-VEO-0123456789';

const MUSICA = (() => {
  const d = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'musica-'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:a', 'libmp3lame', path.join(d, 'm.mp3')]);
  return fs.readFileSync(path.join(d, 'm.mp3'));
})();

describe('Vídeo com o Veo (API do Gemini simulada)', () => {
  let h: Harness;
  let google: http.Server;
  const pedidos: Array<{ url: string; chave: string; corpo: any }> = [];
  let recusar = false;
  let semVeoNaLista = false; // a lista da chave não traz o Veo e o primeiro modelo "automático" não existe
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    process.env.NIVOO_VEO_INTERVALO_MS = '100';
    fs.rmSync(CTL, { recursive: true, force: true });
    let consultas = 0;
    google = http.createServer((req, res) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => {
        const u = new URL(req.url!, 'http://x');
        const chave = String(req.headers['x-goog-api-key'] ?? '');
        pedidos.push({ url: req.method + ' ' + u.pathname + u.search, chave, corpo: d ? JSON.parse(d) : null });
        const json = (st: number, b: unknown) => {
          res.writeHead(st, { 'content-type': 'application/json' });
          res.end(JSON.stringify(b));
        };
        if (chave !== CHAVE) return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
        // Música (Lyria, generateContent): devolve um mp3 de verdade em base64.
        if (u.pathname === '/v1beta/models/lyria-3-pro-preview:generateContent' && req.method === 'POST') {
          return json(200, { candidates: [{ content: { parts: [{ text: 'trilha' }, { inlineData: { mimeType: 'audio/mpeg', data: MUSICA.toString('base64') } }] } }] });
        }
        // Gemini Omni Flash (Interactions): cria em segundo plano, consulta o andamento, devolve o vídeo por endereço.
        if (u.pathname === '/v1beta/interactions' && req.method === 'POST') {
          const corpo = JSON.parse(d);
          if (semVeoNaLista && corpo.model === 'gemini-omni-1.2-flash') return json(404, { error: { code: 404, message: 'model not found', status: 'NOT_FOUND' } });
          consultas = 0;
          return json(200, { id: `int-${pedidos.length}`, status: 'in_progress' });
        }
        if (/^\/v1beta\/interactions\/int-\d+$/.test(u.pathname) && req.method === 'GET') {
          consultas++;
          const id = u.pathname.split('/').pop();
          if (consultas < 2) return json(200, { id, status: 'in_progress' });
          if (recusar) return json(200, { id, status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'O pedido viola a política de uso.' }] }] });
          return json(200, {
            id,
            status: 'completed',
            steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', uri: `http://127.0.0.1:${(google.address() as AddressInfo).port}/v1beta/files/abc123:download?alt=media` }] }],
          });
        }
        if (u.pathname === '/v1beta/models' && semVeoNaLista) return json(200, { models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }] });
        if (u.pathname === '/v1beta/models') {
          return json(200, {
            models: [
              { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-omni-1.1-flash', displayName: 'Gemini Omni 1.1 Flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/veo-3.1-fast-generate-preview', displayName: 'Veo 3.1 Fast', supportedGenerationMethods: ['predictLongRunning'] },
              { name: 'models/gemini-omni-1.2-flash', displayName: 'Gemini Omni 1.2 Flash', supportedGenerationMethods: ['generateContent'] },
            ],
          });
        }
        const gerar = /^\/v1beta\/models\/([^/:]+):predictLongRunning$/.exec(u.pathname);
        if (gerar && req.method === 'POST' && semVeoNaLista && gerar[1] === 'veo-3.1-fast-generate-preview') return json(404, { error: { code: 404, message: 'models/veo-3.1-fast-generate-preview is not found for API version v1beta', status: 'NOT_FOUND' } });
        if (gerar && req.method === 'POST') {
          consultas = 0;
          return json(200, { name: `models/${gerar[1]}/operations/op-${pedidos.length}` });
        }
        if (/^\/v1beta\/models\/[^/]+\/operations\//.test(u.pathname)) {
          consultas++;
          if (consultas < 2) return json(200, { name: u.pathname.slice(8), done: false });
          if (recusar) return json(200, { name: u.pathname.slice(8), done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['O pedido viola a política de uso.'] } } });
          return json(200, {
            name: u.pathname.slice(8),
            done: true,
            response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `http://127.0.0.1:${(google.address() as AddressInfo).port}/v1beta/files/abc123:download?alt=media` } }] } },
          });
        }
        if (u.pathname === '/v1beta/files/abc123:download' && u.searchParams.get('alt') === 'media') {
          res.writeHead(200, { 'content-type': 'video/mp4' });
          return res.end(VIDEO);
        }
        json(404, { error: { message: 'não encontrado' } });
      });
    });
    await new Promise<void>((ok) => google.listen(0, '127.0.0.1', ok));
    process.env.NIVOO_GEMINI_API_BASE = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    for (const c of (await h.http().get('/api/accounts')).body) await h.http().delete(`/api/accounts/${c.id}`);
    await h.close();
    google.close();
    for (const k of ['NIVOO_CLAUDE_BIN', 'NIVOO_VEO_INTERVALO_MS', 'NIVOO_GEMINI_API_BASE']) delete process.env[k];
    fs.rmSync(CTL, { recursive: true, force: true });
  });

  const resposta = (pid: string, cid: string, n: number) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body;
      const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
      return r.length >= n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
    });
  const fim = (pid: string, jid: string) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${jid}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 30_000);

  it('modelos Veo da chave, plano da conversa com vídeo a partir de imagem anexada, vídeo salvo no projeto e custo', async () => {
    // Sem conexão com chave: não disponível, e a lista de modelos explica.
    expect((await h.http().get('/api/accounts/gemini-video/models').expect(200)).body.aviso).toMatch(/Gemini — chave de API/);
    const c = (await h.http().post('/api/accounts').send({ tipo: 'gemini-api', nome: 'Gemini vídeos' }).expect(201)).body;
    await h.http().post(`/api/accounts/${c.id}/key`).send({ key: CHAVE }).expect(201);
    const modelos = (await h.http().get('/api/accounts/gemini-video/models').expect(200)).body.opcoes;
    // O Veo (desligado pelo Google na API do Gemini) não aparece, mesmo que a lista o traga; o Omni atual primeiro.
    expect(modelos).toEqual([
      { id: 'gemini-omni-1.2-flash', nome: 'Gemini Omni 1.2 Flash — o atual do Google, com som (3 a 15 s) (~US$ 0,10/s)' },
      { id: 'gemini-omni-1.1-flash', nome: 'Gemini Omni 1.1 Flash — versão anterior, com som (~US$ 0,10/s)' },
    ]);

    const p = (await h.http().post('/api/projects').send({ name: 'Campanha', provider: 'claude-code-cli' }).expect(201)).body;
    // O modelo de vídeo fica guardado no projeto sem trocar a IA do projeto.
    const ajustado = (await h.http().patch(`/api/projects/${p.id}`).send({ model: 'veo-3.1-fast-generate-preview', modeloDe: 'gemini-video' }).expect(200)).body;
    expect(ajustado.provider).toBe('claude-code-cli');
    expect(ajustado.aiModels['gemini-video']).toBe('veo-3.1-fast-generate-preview');

    // A IA da conversa sabe que pode gerar vídeo.
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n{"tipo":"resposta","texto":"Recebi o logo.","memoria":[]}\n```');
    const r1 = (await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'meu logo', anexos: [{ nome: 'logo.png', contentBase64: PNG.toString('base64') }] }).expect(201)).body;
    const minha = r1.messages.find((m: any) => m.role === 'USUARIO');
    await resposta(p.id, conv.id, 1);
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toContain('"provider":"gemini-video"');

    ctl(
      'resposta.txt',
      '```json\n' +
        JSON.stringify({
          tipo: 'plano',
          texto: 'Vou gerar 1 vídeo vertical de 8 segundos a partir do seu logo.',
          job: {
            title: 'Vídeo do logo',
            objective: 'videos/abertura.mp4 gerado a partir do logo',
            anexosNoProjeto: [{ anexo: `contexto/anexos/${minha.id}/logo.png`, para: 'midia/logo.png' }],
            steps: [
              {
                key: 'video',
                title: 'Gerar o vídeo de abertura',
                provider: 'gemini-video',
                instructions: 'O logo gira devagar sobre fundo laranja, câmera se aproxima, som de whoosh.',
                providerOptions: { arquivo: 'videos/abertura.mp4', duracaoSeg: 8, proporcao: '9:16', imagem: 'midia/logo.png', negativo: 'texto borrado' },
              },
            ],
            criteria: [{ key: 'v', description: 'vídeo existe', kind: 'FILE_EXISTS', config: { path: 'videos/abertura.mp4' } }],
          },
          memoria: [],
        }) +
        '\n```',
    );
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'Faça um vídeo com ele' }).expect(201);
    const plano = await resposta(p.id, conv.id, 2);
    expect(plano.kind).toBe('plano');
    const aprovado = (await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson' }).expect(201)).body;
    const job = await fim(p.id, aprovado.messages.find((m: any) => m.id === plano.id).jobId);
    expect(job.status).toBe('CONCLUIDO');
    expect(job.steps.map((s: any) => s.key)).toEqual(['video']); // etapa do sistema: sem conferência por IA

    // O modelo escolhido (Veo 3.1, desligado pelo Google) vira o automático: Gemini Omni pelo Interactions.
    expect(pedidos.some((x) => x.url.includes('predictLongRunning'))).toBe(false);
    const gerar = pedidos.find((x) => x.url === 'POST /v1beta/interactions')!;
    expect(gerar.chave).toBe(CHAVE);
    expect(gerar.corpo).toEqual({
      model: 'gemini-omni-1.2-flash',
      input: [
        { type: 'image', data: PNG.toString('base64'), mime_type: 'image/png' },
        { type: 'text', text: 'O logo gira devagar sobre fundo laranja, câmera se aproxima, som de whoosh.\n\nNão mostrar: texto borrado' },
      ],
      response_format: { type: 'video', delivery: 'uri', aspect_ratio: '9:16', duration: '8s' },
      background: true,
    });
    expect(pedidos.some((x) => /^GET \/v1beta\/interactions\/int-\d+$/.test(x.url))).toBe(true);

    // O vídeo está na pasta principal do projeto; custo estimado registrado (8 s x US$ 0,10).
    const noProjeto = execFileSync('git', ['show', 'main:videos/abertura.mp4'], { cwd: path.join(p.workspacePath, 'repo') });
    expect(Buffer.compare(noProjeto, VIDEO)).toBe(0);
    expect(Number(job.costSpentUsd)).toBeCloseTo(0.8, 2);
    expect(job.attempts[0].output).toMatch(/Vídeo gerado: videos\/abertura\.mp4 \(8 s, modelo gemini-omni-1\.2-flash/);

    // Limite de gasto do projeto: o próximo vídeo é barrado ANTES de chamar o Google.
    await h.http().patch(`/api/projects/${p.id}`).send({ maxCostUsd: 1 }).expect(200);
    const antes = pedidos.length;
    const j2 = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'outro vídeo', objective: 'x', defaultProvider: 'gemini-video',
        steps: [{ key: 'v2', provider: 'gemini-video', instructions: 'um gato', providerOptions: { arquivo: 'videos/gato.mp4', duracaoSeg: 8 } }],
        criteria: [{ key: 'v', description: 'v', kind: 'FILE_EXISTS', config: { path: 'videos/gato.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j2.id}/start`).expect(201);
    const barrado = await fim(p.id, j2.id);
    expect(barrado.blockedReason).toBe('LIMITE_ORCAMENTO_PROJETO');
    expect(barrado.statusDetail).toMatch(/custaria cerca de US\$ 0\.80 e passaria o limite do projeto/);
    expect(pedidos.length).toBe(antes);

    // Opções inválidas são recusadas no plano.
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'x', objective: 'x', steps: [{ key: 'v', provider: 'gemini-video', instructions: 'x', providerOptions: { arquivo: '../fora.mp4' } }], criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'a' } }] }).expect(400);
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('o Google recusa pelas regras de segurança: a etapa explica e nenhum arquivo é criado', async () => {
    recusar = true;
    const p = (await h.http().post('/api/projects').send({ name: 'Recusado' }).expect(201)).body;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'vídeo recusado', objective: 'x', defaultProvider: 'gemini-video', limits: { maxAttemptsPerStep: 1 },
        steps: [{ key: 'v', provider: 'gemini-video', instructions: 'algo proibido', providerOptions: { arquivo: 'videos/x.mp4' } }],
        criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'videos/x.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const r = await fim(p.id, j.id);
    expect(r.status).not.toBe('CONCLUIDO');
    expect(r.attempts[0].error).toMatch(/terminou sem devolver vídeo \(pode ter recusado pelas regras de segurança dele\).*O pedido viola a política de uso/);
    expect(fs.existsSync(path.join(p.workspacePath, 'worktrees', j.id, 'videos', 'x.mp4'))).toBe(false);
    recusar = false;
  });

  it('automático com a lista da chave sem modelos de vídeo: tenta os conhecidos (o Omni mais novo primeiro) até um aceitar', async () => {
    semVeoNaLista = true;
    (h.app.get(GeminiVideoProvider) as any).cache = null;
    const p = (await h.http().post('/api/projects').send({ name: 'Sem lista', provider: 'claude-code-cli' }).expect(201)).body;
    const antes = pedidos.length;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'cena', objective: 'x', defaultProvider: 'gemini-video',
        steps: [{ key: 'c1', provider: 'gemini-video', instructions: 'queijo derretido', providerOptions: { arquivo: 'videos/c1.mp4', duracaoSeg: 4 } }],
        criteria: [{ key: 'v', description: 'v', kind: 'FILE_EXISTS', config: { path: 'videos/c1.mp4' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await fim(p.id, j.id);
    semVeoNaLista = false;
    expect(x.status).toBe('CONCLUIDO');
    const posts = pedidos.slice(antes).filter((r) => r.url.startsWith('POST')).map((r) => `${r.url} ${r.corpo?.model}`);
    expect(posts).toEqual(['POST /v1beta/interactions gemini-omni-1.2-flash', 'POST /v1beta/interactions gemini-omni-1.1-flash']);
    // E a tela de escolha não fica vazia: mostra os conhecidos, com o motivo.
    const lista = (await h.http().get('/api/accounts/gemini-video/models').expect(200)).body;
    expect(lista.opcoes.map((o: any) => o.id)).toEqual(['gemini-omni-1.2-flash', 'gemini-omni-1.1-flash']);
    expect(lista.aviso).toMatch(/não traz modelos de vídeo/);
  });

  it('trilha gerada pelo Google (Lyria) para o vídeo inteiro; juntar de novo reaproveita a mesma música sem pagar outra', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Com trilha' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    fs.mkdirSync(path.join(repo, 'videos', 'm'), { recursive: true });
    for (const n of ['01', '02']) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=24:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(repo, `videos/m/cena-${n}.mp4`)]);
    }
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cenas'], { cwd: repo });
    const juntar = async () => {
      const j = (
        await h.http().post(`/api/projects/${p.id}/jobs`).send({
          title: 'juntar', objective: 'x', defaultProvider: 'juntar-videos',
          steps: [{ key: 'f', provider: 'juntar-videos', instructions: 'junta', providerOptions: { cenas: ['videos/m/cena-01.mp4', 'videos/m/cena-02.mp4'], arquivo: 'videos/m/m-completo.mp4', trilha: { descricao: 'violão acústico alegre' } } }],
          criteria: [{ key: 'v', description: 'v', kind: 'FILE_EXISTS', config: { path: 'videos/m/m-completo.mp4' } }],
        }).expect(201)
      ).body;
      await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
      return fim(p.id, j.id);
    };
    const antes = pedidos.filter((x) => x.url.includes('lyria')).length;
    const x = await juntar();
    expect(x.status).toBe('CONCLUIDO');
    expect(x.attempts[0].output).toMatch(/trilha gerada \(lyria-3-pro-preview\) em videos\/m\/m-completo-trilha\.mp3/);
    expect(Number(x.costSpentUsd)).toBeCloseTo(0.08, 2);
    const pedido = pedidos.filter((r) => r.url.includes('lyria')).pop()!;
    expect(pedido.chave).toBe(CHAVE);
    expect(pedido.corpo.contents[0].parts[0].text).toMatch(/violão acústico alegre[\s\S]*INSTRUMENTAL/);
    expect(execFileSync('git', ['ls-tree', '-r', '--name-only', 'main', 'videos/m'], { cwd: repo }).toString()).toContain('m-completo-trilha.mp3');
    // Juntar de novo (ex.: outra transição): a mesma trilha, sem novo pedido ao Google.
    const y = await juntar();
    expect(y.status).toBe('CONCLUIDO');
    expect(y.attempts[0].output).toMatch(/reaproveitada/);
    expect(pedidos.filter((r) => r.url.includes('lyria')).length).toBe(antes + 1);
  });
});
