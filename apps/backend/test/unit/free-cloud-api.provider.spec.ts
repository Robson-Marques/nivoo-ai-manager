import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gravarSegredoDaConexao, segredoDaConexao } from '../../src/accounts/secrets';
import { ExecutionRequest } from '../../src/providers/provider.interface';
import { GroqFreeProvider, modeloGroqDeTexto, modeloOpenRouterGratuito, OpenRouterFreeProvider } from '../../src/providers/free-cloud-api.provider';

describe('Provedores hospedados gratuitos — OpenRouter e GroqCloud', () => {
  let dir: string;
  let secretsAnterior: string | undefined;
  let openAnterior: string | undefined;
  let groqAnterior: string | undefined;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-free-cloud-'));
    secretsAnterior = process.env.NIVOO_SECRETS_FILE;
    openAnterior = process.env.OPENROUTER_API_KEY;
    groqAnterior = process.env.GROQ_API_KEY;
    process.env.NIVOO_SECRETS_FILE = path.join(dir, 'segredos.json');
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (secretsAnterior === undefined) delete process.env.NIVOO_SECRETS_FILE;
    else process.env.NIVOO_SECRETS_FILE = secretsAnterior;
    if (openAnterior === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = openAnterior;
    if (groqAnterior === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = groqAnterior;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function pedido(model: string): ExecutionRequest {
    return {
      jobId: 'job', stepId: 'step', attemptId: 'attempt',
      instructions: 'Crie um relatório em out/relatorio.md', context: 'Workspace de teste',
      cwd: dir, outputDir: path.join(dir, 'out'), timeoutMs: 120_000,
      signal: new AbortController().signal, onLog: () => undefined,
      options: { model },
    };
  }

  it('bloqueia rotas pagas no OpenRouter ANTES de fazer qualquer chamada externa', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-chave-ficticia-de-teste';
    const spy = jest.spyOn(globalThis, 'fetch');
    const p = new OpenRouterFreeProvider();
    for (const model of ['anthropic/claude-sonnet', 'openai/gpt-5', 'openrouter/auto']) {
      expect(modeloOpenRouterGratuito(model)).toBe(false);
      const r = await p.execute(pedido(model));
      expect(r.exitCode).toBe(1);
      expect(r.error).toContain('Modelo pago bloqueado');
    }
    expect(spy).not.toHaveBeenCalled();
    expect(modeloOpenRouterGratuito('openrouter/free')).toBe(true);
    expect(modeloOpenRouterGratuito('nvidia/nemotron-3-ultra:free')).toBe(true);
  });

  it('não oferece modelos pagos, embeddings ou modelos sem ferramentas na lista OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-chave-ficticia-de-teste';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'openai/gpt-5', supported_parameters: ['tools'] },
      { id: 'meta/free-chat:free', supported_parameters: ['tools'] },
      { id: 'meta/free-simples:free', supported_parameters: ['response_format'] },
      { id: 'nvidia/free-embed:free', supported_parameters: ['tools'] },
    ] }), { status: 200 }));
    const opcoes = await new OpenRouterFreeProvider().modelos();
    expect(opcoes.map(m => m.id)).toContain('openrouter/free');
    expect(opcoes.map(m => m.id)).toContain('meta/free-chat:free');
    expect(opcoes.map(m => m.id)).not.toContain('openai/gpt-5');
    expect(opcoes.map(m => m.id)).not.toContain('meta/free-simples:free');
  });

  it('guarda várias chaves separadas sem compartilhar a conta', () => {
    gravarSegredoDaConexao(null, 'OPENROUTER_API_KEY', 'chave-principal');
    gravarSegredoDaConexao('openrouter-free-api--abcdef12', 'OPENROUTER_API_KEY', 'chave-secundaria');
    expect(segredoDaConexao(null, 'OPENROUTER_API_KEY')).toBe('chave-principal');
    expect(segredoDaConexao('openrouter-free-api--abcdef12', 'OPENROUTER_API_KEY')).toBe('chave-secundaria');
    expect(segredoDaConexao('openrouter-free-api--12345678', 'OPENROUTER_API_KEY')).toBeUndefined();
  });

  it('valida chave OpenRouter com /key em vez de apenas consultar o catálogo público /models', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-chave-ficticia-de-teste';
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { label: 'free' } }), { status: 200 }));
    const status = await new OpenRouterFreeProvider().checkAvailability();
    expect(status).toMatchObject({ available: true, authenticated: true });
    expect(String(spy.mock.calls[0][0])).toBe('https://openrouter.ai/api/v1/key');
  });

  it('respeita erro de chave sem revelar token', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-chave-ficticia-de-teste';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'revogada: sk-or-chave-ficticia-de-teste' },
    }), { status: 401 }));
    const status = await new OpenRouterFreeProvider().checkAvailability();
    expect(status.available).toBe(false);
    expect(status.errors.join(' ')).not.toContain('sk-or-chave-ficticia-de-teste');
  });

  it('filtra áudio na GroqCloud e mantém modelos de texto da conta', async () => {
    process.env.GROQ_API_KEY = 'gsk_chave-ficticia-de-teste';
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-120b' },
      { id: 'meta-llama/llama-4-scout' },
    ] }), { status: 200 }));
    expect(modeloGroqDeTexto('whisper-large-v3')).toBe(false);
    const modelos = await new GroqFreeProvider().modelos();
    expect(modelos.map(m => m.id)).toEqual(['meta-llama/llama-4-scout', 'openai/gpt-oss-120b']);
    expect(String(spy.mock.calls[0][0])).toBe('https://api.groq.com/openai/v1/models');
  });

  it('agente gratuito chama ferramentas do Nivoo e entrega arquivo sem executar terminal', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-chave-ficticia-de-teste';
    const calls = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [
        { id: 'meta/free-chat:free', supported_parameters: ['tools'] },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: null, tool_calls: [{ id: 'tc1', function: {
          name: 'escrever_arquivo', arguments: JSON.stringify({ caminho: 'out/relatorio.md', conteudo: 'feito\n' }),
        } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 30, completion_tokens: 15 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Relatório criado.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 25, completion_tokens: 10 },
      }), { status: 200 }));
    const r = await new OpenRouterFreeProvider().execute(pedido('meta/free-chat:free'));
    expect(r).toMatchObject({ exitCode: 0, output: 'Relatório criado.', inputTokens: 55, outputTokens: 25 });
    expect(fs.readFileSync(path.join(dir, 'out/relatorio.md'), 'utf8')).toBe('feito\n');
    expect(calls).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String((calls.mock.calls[2][1] as RequestInit).body)).messages)
      .toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', tool_call_id: 'tc1' })]));
  });
});
