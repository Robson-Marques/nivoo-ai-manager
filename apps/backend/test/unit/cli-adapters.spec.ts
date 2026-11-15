/**
 * Testes dos ADAPTADORES de CLI com binários STUB (test/support/stubs, marcados TEST-ONLY).
 * Verificam montagem de argumentos, leitura de status e parsing de saída.
 * NÃO comprovam a integração real — para isso, ver test/integration (opt-in no host do worker).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const STUBS = path.join(__dirname, '..', 'support', 'stubs');
const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};

function req(cwd: string, logs: string[]) {
  return {
    jobId: 'j', stepId: 's', attemptId: 'a', instructions: 'faça X', context: '# contexto',
    cwd, outputDir: path.join(cwd, 'out'), timeoutMs: 10000,
    signal: new AbortController().signal, onLog: (l: string) => logs.push(l),
  };
}

describe('Adaptador Claude Code CLI (stub TEST-ONLY)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
  beforeEach(() => fs.rmSync(CTL, { recursive: true, force: true }));
  beforeAll(() => {
    process.env.NIVOO_CLAUDE_BIN = path.join(STUBS, 'claude-stub.sh');
  });
  afterAll(() => {
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
  });

  it('lê versão e status de login', async () => {
    const { ClaudeCodeCliProvider } = await import('../../src/providers/claude-code-cli.provider');
    const s = await new ClaudeCodeCliProvider().checkAvailability();
    expect(s).toMatchObject({ installed: true, authenticated: true, available: true, version: '9.9.9 (Claude Code STUB)' });
    ctl('logged_in', 'false');
    const s2 = await new ClaudeCodeCliProvider().checkAvailability();
    expect(s2.available).toBe(false);
    expect(s2.errors.join()).toMatch(/não conectado/);
    ctl('logged_in', null);
  });

  it('envia prompt com contexto e regras por stdin, sem bypass de permissões, e lê custo', async () => {
    const { ClaudeCodeCliProvider } = await import('../../src/providers/claude-code-cli.provider');
    const r = await new ClaudeCodeCliProvider().execute(req(tmp, []));
    expect(r).toMatchObject({ exitCode: 0, output: 'feito', costUsd: 0.0123, inputTokens: 10, outputTokens: 5 });
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toContain('# contexto');
    const args = fs.readFileSync(path.join(CTL, 'args.txt'), 'utf8');
    expect(args).toContain('--permission-mode acceptEdits');
    expect(args).not.toContain('dangerously');
    expect(args).not.toContain('--allowedTools'); // nenhuma regra genérica (isolamento)
    expect(args).toContain('--disallowedTools Bash WebFetch WebSearch');
  });

  it('recusa regras de permissão genéricas (liberariam escrita fora do workspace)', async () => {
    const { ClaudeCodeCliProvider } = await import('../../src/providers/claude-code-cli.provider');
    expect(() => ClaudeCodeCliProvider.scopedAllowRules('Write')).toThrow(/não permitida/);
    expect(() => ClaudeCodeCliProvider.scopedAllowRules('Edit(./../x/**)')).toThrow(/não permitida/);
    expect(() => ClaudeCodeCliProvider.scopedAllowRules('Edit(//etc/**)')).toThrow(/não permitida/);
    expect(ClaudeCodeCliProvider.scopedAllowRules('Edit(./src/**) Read(./dados/**)')).toEqual(['Edit(./src/**)', 'Read(./dados/**)']);
  });

  it('fim de sessão por limite de turnos é distinguido de falha', async () => {
    const { ClaudeCodeCliProvider } = await import('../../src/providers/claude-code-cli.provider');
    ctl('mode', 'max_turns');
    const r = await new ClaudeCodeCliProvider().execute(req(tmp, []));
    expect(r).toMatchObject({ exitCode: 0, sessionEnded: true, stopReason: 'max_turns', sessionId: 'stub-sessao' });
    expect(r.resourceUnavailable).toBeFalsy();
    ctl('mode', null);
  });

  it('erro de limite de uso é classificado como recurso indisponível', async () => {
    const { ClaudeCodeCliProvider } = await import('../../src/providers/claude-code-cli.provider');
    ctl('mode', 'limit');
    const r = await new ClaudeCodeCliProvider().execute(req(tmp, []));
    expect(r.exitCode).not.toBe(0);
    expect(r.resourceUnavailable).toBe(true);
    ctl('mode', null);
  });
});

describe('Adaptador Codex CLI (stub TEST-ONLY)', () => {
  beforeAll(() => {
    process.env.NIVOO_CODEX_BIN = path.join(STUBS, 'codex-stub.sh');
  });
  afterAll(() => delete process.env.NIVOO_CODEX_BIN);

  it('lê status e extrai a mensagem final e o uso do JSONL', async () => {
    const { CodexCliProvider } = await import('../../src/providers/codex-cli.provider');
    const p = new CodexCliProvider();
    expect((await p.checkAvailability()).available).toBe(true);
    const logs: string[] = [];
    const r = await p.execute(req(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-')), logs));
    expect(r).toMatchObject({ exitCode: 0, output: 'resposta final', inputTokens: 7, outputTokens: 3 });
    expect(logs.join('\n')).toContain('[command_execution] ls');
  });
});

describe('Adaptador Gemini CLI (saída stream-json real do CLI)', () => {
  // Formato capturado do Gemini CLI 0.68 (eventos init/message/result); o texto do agente vem em pedaços.
  const { GeminiCliProvider } = require('../../src/providers/gemini-cli.provider');
  const linhas = (evs: unknown[]) => evs.map((e) => JSON.stringify(e)).join('\n');

  it('junta a resposta do agente, sessão e tokens em caso de sucesso', () => {
    const logs: string[] = [];
    const r = GeminiCliProvider.parse(
      linhas([
        { type: 'init', session_id: 's-1', model: 'auto' },
        { type: 'message', role: 'user', content: 'oi' },
        { type: 'message', role: 'assistant', content: 'Olá, ', delta: true },
        { type: 'message', role: 'assistant', content: 'tudo certo.', delta: true },
        { type: 'result', status: 'success', stats: { input_tokens: 10, output_tokens: 4 } },
      ]),
      '',
      0,
      (l: string) => logs.push(l),
    );
    expect(r).toMatchObject({ exitCode: 0, output: 'Olá, tudo certo.', sessionId: 's-1', inputTokens: 10, outputTokens: 4, stopReason: 'completed' });
  });

  it('chave inválida ou limite vira "recurso indisponível" (reagendar), não falha do trabalho', () => {
    const r = GeminiCliProvider.parse(
      linhas([{ type: 'init', session_id: 's-2' }, { type: 'result', status: 'error', error: { type: 'unknown', message: 'API key not valid. Please pass a valid API key.' } }]),
      '',
      1,
      () => undefined,
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.resourceUnavailable).toBe(true);
    expect(r.error).toMatch(/API key not valid/);
  });

  it('Google encerrou o Gemini CLI com conta pessoal (saída real): recurso indisponível com o motivo, e a conexão fica marcada', () => {
    const stderr = [
      "      reason: 'Gemini Code Assist for individuals'",
      '    }',
      '  ]',
      '}',
      'An unexpected critical error occurred:IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google',
      '    at throwIneligibleOrProjectIdError (file:///usr/local/lib/node_modules/@google/gemini-cli/bundle/chunk-RCB6BI5H.js:312981:11)',
      '    at _doSetupUser (file:///usr/local/lib/node_modules/@google/gemini-cli/bundle/chunk-RCB6BI5H.js:312970:5)',
    ].join('\n');
    const r = GeminiCliProvider.parse('', stderr, 1, () => undefined);
    expect(r.resourceUnavailable).toBe(true);
    expect(r.error).toMatch(/^IneligibleTierError: This client is no longer supported/);
    const { ehFalhaDeLogin, GEMINI_CONTA_ENCERRADA } = require('../../src/accounts/connections');
    expect(ehFalhaDeLogin(r.error)).toBe(true);
    expect(GEMINI_CONTA_ENCERRADA.test(r.error)).toBe(true);
  });

  it('a conexão do Gemini (conta) fica marcada com a explicação certa, não "reconecte"', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conexoes-')), 'conexoes.json');
    process.env.NIVOO_CONEXOES_FILE = arq;
    try {
      const c = require('../../src/accounts/connections');
      c.gravarConexoes([{ id: 'gemini-cli', tipo: 'gemini-cli', nome: 'Gemini', padrao: true, criadaEm: '2026-11-15' }]);
      c.marcarFalhaLogin('gemini-cli', 'IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.');
      expect(c.acharConexao('gemini-cli').falhaLogin.mensagem).toBe(c.EXPLICACAO_GEMINI_ENCERRADA);
    } finally {
      delete process.env.NIVOO_CONEXOES_FILE;
    }
  });
});
