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

describe('Vídeo com o Veo (API do Gemini simulada)', () => {
  let h: Harness;
  let google: http.Server;
  const pedidos: Array<{ url: string; chave: string; corpo: any }> = [];
  let recusar = false;
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
        if (u.pathname === '/v1beta/models') {
          return json(200, {
            models: [
              { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/veo-3.0-generate-001', displayName: 'Veo 3', supportedGenerationMethods: ['predictLongRunning'] },
              { name: 'models/veo-3.1-fast-generate-preview', displayName: 'Veo 3.1 Fast', supportedGenerationMethods: ['predictLongRunning'] },
              { name: 'models/veo-3.1-generate-preview', displayName: 'Veo 3.1', supportedGenerationMethods: ['predictLongRunning'] },
            ],
          });
        }
        const gerar = /^\/v1beta\/models\/([^/:]+):predictLongRunning$/.exec(u.pathname);
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
    expect(modelos).toEqual([
      { id: 'veo-3.1-generate-preview', nome: 'Veo 3.1 — melhor qualidade, com som (~US$ 0,40/s)' },
      { id: 'veo-3.1-fast-generate-preview', nome: 'Veo 3.1 Fast — mais rápido e barato, com som (~US$ 0,15/s)' },
      { id: 'veo-3.0-generate-001', nome: 'Veo 3 — com som (~US$ 0,40/s)' },
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

    // Pedido feito ao Google como a biblioteca oficial faz.
    const gerar = pedidos.find((x) => x.url.startsWith('POST /v1beta/models/'))!;
    expect(gerar.url).toBe('POST /v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning');
    expect(gerar.chave).toBe(CHAVE);
    expect(gerar.corpo.instances[0].prompt).toBe('O logo gira devagar sobre fundo laranja, câmera se aproxima, som de whoosh.');
    expect(gerar.corpo.instances[0].image).toEqual({ bytesBase64Encoded: PNG.toString('base64'), mimeType: 'image/png' });
    expect(gerar.corpo.parameters).toEqual({ sampleCount: 1, durationSeconds: 8, aspectRatio: '9:16', negativePrompt: 'texto borrado' });

    // O vídeo está na pasta principal do projeto; custo estimado registrado (modelo rápido: 8 s x US$ 0,15).
    const noProjeto = execFileSync('git', ['show', 'main:videos/abertura.mp4'], { cwd: path.join(p.workspacePath, 'repo') });
    expect(Buffer.compare(noProjeto, VIDEO)).toBe(0);
    expect(Number(job.costSpentUsd)).toBeCloseTo(1.2, 2);
    expect(job.attempts[0].output).toMatch(/Vídeo gerado: videos\/abertura\.mp4 \(8 s, modelo veo-3\.1-fast-generate-preview/);

    // Limite de gasto do projeto: o próximo vídeo é barrado ANTES de chamar o Google.
    await h.http().patch(`/api/projects/${p.id}`).send({ maxCostUsd: 2 }).expect(200);
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
    expect(barrado.statusDetail).toMatch(/custaria cerca de US\$ 1\.20 e passaria o limite do projeto/);
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
    expect(r.attempts[0].error).toMatch(/recusou gerar este vídeo pelas regras de segurança dele: O pedido viola a política de uso/);
    expect(fs.existsSync(path.join(p.workspacePath, 'worktrees', j.id, 'videos', 'x.mp4'))).toBe(false);
    recusar = false;
  });
});
