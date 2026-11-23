import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { retryAfterHeaderMs, resourceRateLimitDelayMs, isTransientRateLimit } from '../../src/providers/resource-rate-limit';
import { conferenciaGrepAlternativasLegada } from '../../src/jobs/verification-legacy-grep';
import { executarFerramentaNvidia, NvidiaApiProvider } from '../../src/providers/nvidia-api.provider';
import { ExecutionRequest } from '../../src/providers/provider.interface';

describe('Resiliência do Nivoo com a NVIDIA NIM e planos legados', () => {
  const oldKey = process.env.NVIDIA_API_KEY;
  const oldSecrets = process.env.NIVOO_SECRETS_FILE;
  let work: string;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-nvidia-rate-'));
    process.env.NIVOO_SECRETS_FILE = path.join(work, 'segredos.json');
    process.env.NVIDIA_API_KEY = 'nvapi-chave-unitaria-nunca-real';
  });
  afterEach(() => {
    if (oldKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = oldKey;
    if (oldSecrets === undefined) delete process.env.NIVOO_SECRETS_FILE;
    else process.env.NIVOO_SECRETS_FILE = oldSecrets;
    jest.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('interpreta Retry-After em segundos e data HTTP, com limite de 24h', () => {
    expect(retryAfterHeaderMs('120', 0)).toBe(120_000);
    expect(retryAfterHeaderMs('Mon, 23 Nov 2026 15:05:00 GMT', Date.parse('2026-11-23T15:00:00Z'))).toBe(300_000);
    expect(retryAfterHeaderMs('360000', 0)).toBe(86_400_000);
    expect(retryAfterHeaderMs('invalido')).toBeUndefined();
  });

  it('reprograma 429 progressivamente em 2m, 5m, 15m, 30m, 1h e 2h', () => {
    expect(Array.from({ length: 7 }, (_, i) => resourceRateLimitDelayMs(i)))
      .toEqual([120_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 7_200_000]);
    expect(resourceRateLimitDelayMs(0, 900_000)).toBe(900_000);
    expect(isTransientRateLimit('NVIDIA HTTP 429: Too Many Requests')).toBe(true);
    expect(isTransientRateLimit('NVIDIA HTTP 401')).toBe(false);
  });

  it('corrige correspondência legada do grep sem trocar testes funcionais', () => {
    const comando = "test -f scripts/waha-container.js && grep -q 'digest\\|imageId\\|sha256' scripts/waha-container.js";
    const compat = conferenciaGrepAlternativasLegada(comando);
    expect(compat).toContain('grep -qi');
    expect(conferenciaGrepAlternativasLegada("test -f a.ts && grep -q 'algo' a.ts")).toBeNull();
    expect(conferenciaGrepAlternativasLegada("npm test && " + comando)).toBeNull();
    expect(conferenciaGrepAlternativasLegada("test -f a.ts && grep -q '/status\\|/reconnect' a.ts")).toBeNull();
  });

  it('aceita caminho absoluto dentro do worktree e protege caminhos externos', () => {
    fs.mkdirSync(path.join(work, 'apps'), { recursive: true });
    fs.writeFileSync(path.join(work, 'apps', 'arquivo.ts'), 'export const ok = true;');
    const absoluto = path.join(work, 'apps', 'arquivo.ts');
    expect(executarFerramentaNvidia(work, 'ler_arquivo', { caminho: absoluto })).toContain('export const ok = true');
    expect(executarFerramentaNvidia(work, 'ler_arquivo', { caminho: 'apps/arquivo.js' })).toContain('foi lido o arquivo TypeScript');
    expect(() => executarFerramentaNvidia(work, 'ler_arquivo', { caminho: '/etc/passwd' })).toThrow();
    expect(() => executarFerramentaNvidia(work, 'ler_arquivo', { caminho: '.env' })).toThrow();
  });

  it('não repete indefinidamente a mesma leitura de arquivo na sessão', async () => {
    fs.writeFileSync(path.join(work, 'arquivo.ts'), 'export const teste = true;');
    const chamada = (id: number) => new Response(JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{
        id: 'read-' + id, type: 'function',
        function: { name: 'ler_arquivo', arguments: JSON.stringify({ caminho: 'arquivo.ts' }) },
      }] }, finish_reason: 'tool_calls' }],
    }), { status: 200 });
    const spy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(chamada(1))
      .mockResolvedValueOnce(chamada(2))
      .mockResolvedValueOnce(chamada(3))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Entendi. Vou editar o arquivo.' }, finish_reason: 'stop' }],
      }), { status: 200 }));
    const r = await new NvidiaApiProvider().execute({
      jobId: 'job', stepId: 'step', attemptId: 'attempt',
      cwd: work, outputDir: path.join(work, 'out'),
      instructions: 'Analise o arquivo', context: 'Teste de repetição',
      timeoutMs: 120_000, signal: new AbortController().signal,
      onLog: () => undefined, options: { model: 'nvidia/nemotron-3.5-bolt-e4b' },
    });
    expect(r.exitCode).toBe(0);
    const ultimaChamada = JSON.parse(String((spy.mock.calls[3][1] as RequestInit).body));
    const toolReplies = ultimaChamada.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolReplies).toHaveLength(3);
    expect(toolReplies[2].content).toContain('não houve edição');
    expect(toolReplies[2].content).not.toContain('export const teste = true;');
  });

  it('HTTP 429 devolve Retry-After sem novas chamadas enquanto há cooldown', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ status: 429, title: 'Too Many Requests' }),
      { status: 429, headers: { 'Retry-After': '900' } },
    ));
    const request: ExecutionRequest = {
      jobId: 'job', stepId: 'step', attemptId: 'attempt',
      cwd: work, outputDir: path.join(work, 'out'), instructions: 'Criar arquivo', context: 'Teste',
      timeoutMs: 120_000, signal: new AbortController().signal,
      onLog: () => undefined, options: { model: 'nvidia/nemotron-3.5-bolt-e4b' },
    };
    const provider = new NvidiaApiProvider();
    const primeiro = await provider.execute(request);
    expect(primeiro).toMatchObject({ exitCode: 1, resourceUnavailable: true, retryAfterMs: 900_000 });
    const segundo = await provider.execute(request);
    expect(segundo.resourceUnavailable).toBe(true);
    expect((segundo.retryAfterMs ?? 0)).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
