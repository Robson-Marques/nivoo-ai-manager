import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gravarSegredoDaConexao } from '../../src/accounts/secrets';
import { NVIDIA_SPECIAL_ENDPOINTS, NvidiaSpecializedService } from '../../src/providers/nvidia-specialized.service';

describe('NVIDIA: conectores especializados de verdade por endpoint', () => {
  let dir: string;
  let antigoSecrets: string | undefined;
  let antigoEnv: string | undefined;
  const service = new NvidiaSpecializedService();
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-nvidia-special-'));
    antigoSecrets = process.env.NIVOO_SECRETS_FILE;
    antigoEnv = process.env.NVIDIA_API_KEY;
    process.env.NIVOO_SECRETS_FILE = path.join(dir, 'segredos.json');
    delete process.env.NVIDIA_API_KEY;
    gravarSegredoDaConexao(null, 'NVIDIA_API_KEY', 'nvapi-chave-ficticia-testes');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (antigoSecrets === undefined) delete process.env.NIVOO_SECRETS_FILE;
    else process.env.NIVOO_SECRETS_FILE = antigoSecrets;
    if (antigoEnv === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = antigoEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function mock(body: unknown, status = 200) {
    return jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  it('rejeita chave ausente e conexão que não seja NVIDIA', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    await expect(service.conversa('gemini-api', { modelo: 'nvidia/nemotron-3.5-bolt-e4b', prompt: 'Olá' }))
      .rejects.toThrow('NVIDIA válida');
    expect(spy).not.toHaveBeenCalled();
    gravarSegredoDaConexao(null, 'NVIDIA_API_KEY', null);
    await expect(service.conversa('nvidia-api', { modelo: 'nvidia/nemotron-3.5-bolt-e4b', prompt: 'Olá' }))
      .rejects.toThrow('Cadastre');
    expect(spy).not.toHaveBeenCalled();
  });

  it('chat de texto opera sem a ferramenta de editar código', async () => {
    const spy = mock({ choices: [{ message: { content: 'Resposta NVIDIA' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const r = await service.conversa('nvidia-api', { modelo: 'nvidia/nemotron-3.5-bolt-e4b', prompt: 'Olá' });
    expect(r).toMatchObject({ tipo: 'conversa', texto: 'Resposta NVIDIA', tokensEntrada: 10 });
    expect(spy.mock.calls[0][0]).toBe(NVIDIA_SPECIAL_ENDPOINTS.chat);
    const corpo = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(corpo.tools).toBeUndefined();
    expect(corpo.messages[0]).toEqual({ role: 'user', content: 'Olá' });
  });

  it('embedding usa /v1/embeddings, query/passage e entrega vetor integral', async () => {
    const spy = mock({ data: [{ embedding: [0.2, -0.4, 0.6] }] });
    const r = await service.embedding('nvidia-api', { modelo: 'nvidia/nemotron-3.5-embed-1b', texto: 'Vencimento de cartão', inputType: 'passage' });
    expect(r).toMatchObject({ tipo: 'embedding', dimensoes: 3, vetor: [0.2, -0.4, 0.6], inputType: 'passage' });
    expect(spy.mock.calls[0][0]).toBe(NVIDIA_SPECIAL_ENDPOINTS.embeddings);
    const corpo = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(corpo.input_type).toBe('passage');
    expect(corpo.truncate).toBe('END');
  });

  it('reranking ordena trechos com endpoint especializado (não é chat)', async () => {
    const spy = mock({ rankings: [
      { index: 0, logit: 0.2 }, { index: 1, logit: 1.5 },
    ] });
    const r = await service.rerank('nvidia-api', { consulta: 'vencimento', trechos: ['fechamento 20', 'vencimento 28'] });
    expect(r).toMatchObject({ tipo: 'rerank', resultados: [
      { indice: 1, texto: 'vencimento 28', pontuacao: 1.5 },
      { indice: 0, texto: 'fechamento 20', pontuacao: 0.2 },
    ] });
    expect(spy.mock.calls[0][0]).toBe(NVIDIA_SPECIAL_ENDPOINTS.rerank);
    const corpo = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(corpo.query).toEqual({ text: 'vencimento' });
    expect(corpo.passages[1]).toEqual({ text: 'vencimento 28' });
  });

  it('FLUX.1 Schnell usa endpoint de imagem, resolução 1024 e JPEG', async () => {
    const spy = mock({ artifacts: [{ base64: Buffer.from('imagem-de-teste').toString('base64') }] });
    const r = await service.imagem('nvidia-api', { prompt: 'Uma pizza na mesa' });
    expect(r).toMatchObject({ tipo: 'imagem', mime: 'image/jpeg', largura: 1024, altura: 1024 });
    expect(spy.mock.calls[0][0]).toBe(NVIDIA_SPECIAL_ENDPOINTS.imageFluxSchnell);
    const corpo = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(corpo).toMatchObject({ mode: 'base', width: 1024, height: 1024, steps: 4, cfg_scale: 0 });
  });

  it('modelo desconhecido ou de outra especialidade é bloqueado sem chamadas', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    await expect(service.embedding('nvidia-api', { modelo: 'nvidia/wan-video', texto: 'x' })).rejects.toThrow('embeddings');
    await expect(service.rerank('nvidia-api', { modelo: 'nvidia/nemotron-3.5-embed-8b', consulta: 'x', trechos: ['y'] })).rejects.toThrow('reranking');
    await expect(service.conversa('nvidia-api', { modelo: 'nvidia/novo-chat-qualquer', prompt: 'Olá' })).rejects.toThrow('não confirmado');
    expect(spy).not.toHaveBeenCalled();
  });

  it('falhas NVIDIA redigem a chave no erro e mantêm o status HTTP', async () => {
    const spy = mock({ error: { message: 'invalid nvapi-chave-ficticia-testes' } }, 402);
    await expect(service.embedding('nvidia-api', { texto: 'x' })).rejects.toThrow(/HTTP 402.*chave oculta/);
    expect(spy.mock.calls[0][0]).toBe(NVIDIA_SPECIAL_ENDPOINTS.embeddings);
  });
});
