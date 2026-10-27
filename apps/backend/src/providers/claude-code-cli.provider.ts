import { Injectable } from '@nestjs/common';
import { minimalEnv, runProcess } from '../common/exec';
import {
  AiProvider,
  buildPrompt,
  ExecutionRequest,
  ExecutionResult,
  looksLikeResourceProblem,
  ProviderStatus,
} from './provider.interface';

/**
 * Claude Code CLI (`claude -p`) usando o login oficial já existente no host do worker.
 * Não lê nem copia credenciais: apenas invoca o binário oficial com HOME do usuário do worker.
 * Variáveis repassadas além do ambiente mínimo: CLAUDE_CONFIG_DIR e CLAUDE_CODE_OAUTH_TOKEN
 * (token gerado oficialmente via `claude setup-token`), se configuradas pelo operador.
 */
@Injectable()
export class ClaudeCodeCliProvider implements AiProvider {
  readonly id = 'claude-code-cli';
  readonly label = 'Claude Code CLI';
  readonly kind = 'cli' as const;
  private readonly bin = process.env.NIVOO_CLAUDE_BIN ?? 'claude';
  private readonly passKeys = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'];

  private env(extra: Record<string, string> = {}) {
    return minimalEnv(extra, this.passKeys);
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: false,
      installed: false,
      authenticated: false,
      limits: {
        observacao: 'limites do plano da conta (janela de uso) aplicados pelo provedor; o sistema reage a erros de limite reagendando',
      },
      capabilities: ['editar-codigo', 'executar-ferramentas', 'saida-json', 'custo-por-execucao'],
      errors: [],
      checkedAt: new Date().toISOString(),
      isAi: true,
    };
    const v = await runProcess(this.bin, ['--version'], { cwd: process.cwd(), env: this.env(), timeoutMs: 15000 });
    if (v.exitCode !== 0) {
      base.errors.push(v.spawnError ? `CLI não encontrado (${this.bin})` : v.stderr.trim());
      return base;
    }
    base.installed = true;
    base.version = v.stdout.trim();
    const auth = await runProcess(this.bin, ['auth', 'status'], { cwd: process.cwd(), env: this.env(), timeoutMs: 15000 });
    try {
      const parsed = JSON.parse(auth.stdout);
      base.authenticated = parsed.loggedIn === true;
      if (parsed.authMethod) base.limits.metodoAutenticacao = String(parsed.authMethod);
    } catch {
      base.authenticated = auth.exitCode === 0 ? 'desconhecido' : false;
    }
    if (base.authenticated === false) base.errors.push('CLI instalado mas sem login no host do worker (execute `claude` e faça login oficial)');
    base.available = base.authenticated !== false;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const allowed = process.env.NIVOO_CLAUDE_ALLOWED_TOOLS ?? 'Read,Edit,Write,Glob,Grep';
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', allowed];
    if (process.env.NIVOO_CLAUDE_MODEL) args.push('--model', process.env.NIVOO_CLAUDE_MODEL);
    req.onLog(`claude ${args.join(' ')} (cwd=${req.cwd})`);
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_DATA_DIR: req.dataDir, NIVOO_JOB_ID: req.jobId }),
      input: buildPrompt(req),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
      onStderr: (c) => c.split('\n').filter(Boolean).forEach((l) => req.onLog(l, 'WARN')),
    });
    if (r.aborted) return { exitCode: -1, output: r.stdout, interrupted: true, error: 'interrompido' };
    if (r.timedOut) return { exitCode: -1, output: r.stdout, error: `timeout após ${req.timeoutMs} ms` };
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    let parsed: any = null;
    try {
      parsed = JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
    } catch {
      /* saída não-JSON */
    }
    const text = parsed?.result ?? r.stdout;
    const isError = r.exitCode !== 0 || parsed?.is_error === true;
    req.onLog(String(text).slice(0, 4000));
    const errText = isError ? `${parsed?.subtype ?? 'erro'}: ${String(text).slice(0, 500)} ${r.stderr.slice(0, 500)}` : undefined;
    return {
      exitCode: isError ? r.exitCode || 1 : 0,
      output: String(text),
      error: errText,
      resourceUnavailable: isError && looksLikeResourceProblem(`${text} ${r.stderr}`),
      costUsd: typeof parsed?.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined,
      inputTokens: parsed?.usage?.input_tokens,
      outputTokens: parsed?.usage?.output_tokens,
    };
  }
}
