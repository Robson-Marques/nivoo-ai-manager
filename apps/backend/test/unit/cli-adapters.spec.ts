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
    cwd, outputDir: path.join(cwd, 'out'), dataDir: cwd, timeoutMs: 10000,
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
    expect(s2.errors.join()).toMatch(/sem login/);
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
