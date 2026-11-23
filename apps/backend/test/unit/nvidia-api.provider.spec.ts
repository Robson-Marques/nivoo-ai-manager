import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExecutionRequest } from '../../src/providers/provider.interface';
import { executarFerramentaNvidia, NVIDIA_API_BASE, NvidiaApiProvider } from '../../src/providers/nvidia-api.provider';

describe('NVIDIA NIM API — integração no Nivoo', () => {
  let cwd: string;
  let chaveAnterior: string | undefined;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-nvidia-'));
    chaveAnterior = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
  });
  afterEach(() => {
    if (chaveAnterior === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = chaveAnterior;
    jest.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('sem chave fica desconectado e não chama a internet', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const p = new NvidiaApiProvider();
    const status = await p.checkAvailability();
    expect(status).toMatchObject({ id: 'nvidia-api', installed: true, authenticated: false, available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('testa a chave com GET /models sem expor o segredo e filtra modelos que não são chat', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-chave-de-teste-nunca-real';
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'nvidia/nemotron-3-nano' }, { id: 'nvidia/nv-embed-qa' }, { id: 'meta/llama-3.1-8b-instruct' }],
    }), { status: 200 }));
    const p = new NvidiaApiProvider();
    expect((await p.checkAvailability()).available).toBe(true);
    expect((await p.modelos()).map((m) => m.id)).toEqual(['nvidia/nemotron-3-nano', 'meta/llama-3.1-8b-instruct']);
    expect(String(spy.mock.calls[0][0])).toBe(NVIDIA_API_BASE + '/models');
    const request = spy.mock.calls[0][1] as RequestInit;
    expect((request.headers as Record<string, string>).Authorization).toBe('Bearer nvapi-chave-de-teste-nunca-real');
    expect(request.redirect).toBe('error');
  });

  it('permite ler e editar código no worktree, sem tocar na pasta do servidor', () => {
    fs.writeFileSync(path.join(cwd, 'codigo.ts'), 'const valor = 1;\n');
    expect(executarFerramentaNvidia(cwd, 'ler_arquivo', { caminho: 'codigo.ts' })).toContain('const valor = 1;');
    executarFerramentaNvidia(cwd, 'substituir_texto', {
      caminho: 'codigo.ts', antes: 'valor = 1', depois: 'valor = 2',
    });
    expect(fs.readFileSync(path.join(cwd, 'codigo.ts'), 'utf8')).toBe('const valor = 2;\n');
    expect(() => executarFerramentaNvidia(cwd, 'escrever_arquivo', { caminho: '../fora.txt', conteudo: 'x' })).toThrow();
    expect(() => executarFerramentaNvidia(cwd, 'escrever_arquivo', { caminho: '.env', conteudo: 'x' })).toThrow();
    expect(() => executarFerramentaNvidia(cwd, 'ler_arquivo', { caminho: '.git/config' })).toThrow();
    expect(() => executarFerramentaNvidia(cwd, 'executar_bash', { comando: 'id' })).toThrow();
  });

  it('rejeita symlink que tenta escapar do worktree', () => {
    fs.symlinkSync(os.tmpdir(), path.join(cwd, 'fora'));
    expect(() => executarFerramentaNvidia(cwd, 'ler_arquivo', { caminho: 'fora/arquivo.txt' })).toThrow();
  });

  it('chama chat completions, executa tool-call de arquivo e entrega o texto final', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-chave-de-teste-nunca-real';
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{
        id: 'call_1', type: 'function', function: {
          name: 'escrever_arquivo', arguments: JSON.stringify({ caminho: 'out/relatorio.md', conteudo: '# Feito\n' }),
        },
      }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 40, completion_tokens: 20 },
    }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'Relatório gerado.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    }), { status: 200 }));
    const logs: string[] = [];
    const req: ExecutionRequest = {
      jobId: 'job', stepId: 'step', attemptId: 'attempt', instructions: 'Crie out/relatorio.md',
      context: 'Projeto de teste', cwd, outputDir: path.join(cwd, 'out'),
      timeoutMs: 120_000, signal: new AbortController().signal,
      onLog: (line) => logs.push(line), options: { model: 'nvidia/nemotron-3-nano' },
    };
    const r = await new NvidiaApiProvider().execute(req);
    expect(r).toMatchObject({ exitCode: 0, output: 'Relatório gerado.', inputTokens: 70, outputTokens: 30 });
    expect(fs.readFileSync(path.join(cwd, 'out/relatorio.md'), 'utf8')).toBe('# Feito\n');
    expect(spy).toHaveBeenCalledTimes(2);
    const chamada = spy.mock.calls[1][1] as RequestInit;
    const corpo = JSON.parse(String(chamada.body));
    expect(corpo.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_1' }),
    ]));
    expect(logs.some((l) => l.includes('escrever_arquivo'))).toBe(true);
  });

  it('não envia chave em logs quando NVIDIA recusa autenticação', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-chave-de-teste-nunca-real';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'invalid key nvapi-chave-de-teste-nunca-real' },
    }), { status: 401 }));
    const status = await new NvidiaApiProvider().checkAvailability();
    expect(status.available).toBe(false);
    expect(status.authenticated).toBe(false);
    expect(status.errors.join(' ')).not.toContain('nvapi-chave-de-teste-nunca-real');
  });
});
