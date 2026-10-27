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
 * OpenAI Codex CLI (`codex exec`) usando o login oficial existente (`codex login`) no host do worker.
 * Sandbox do próprio Codex: workspace-write (escrita restrita ao diretório de trabalho).
 */
@Injectable()
export class CodexCliProvider implements AiProvider {
  readonly id = 'codex-cli';
  readonly label = 'OpenAI Codex CLI';
  readonly kind = 'cli' as const;
  private readonly bin = process.env.NIVOO_CODEX_BIN ?? 'codex';
  private readonly passKeys = ['CODEX_HOME'];

  async checkAvailability(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: false,
      installed: false,
      authenticated: false,
      limits: { observacao: 'limites do plano ChatGPT/OpenAI da conta; erros de limite causam reagendamento' },
      capabilities: ['editar-codigo', 'executar-ferramentas', 'sandbox-workspace-write'],
      errors: [],
      checkedAt: new Date().toISOString(),
      isAi: true,
    };
    const env = minimalEnv({}, this.passKeys);
    const v = await runProcess(this.bin, ['--version'], { cwd: process.cwd(), env, timeoutMs: 15000 });
    if (v.exitCode !== 0) {
      base.errors.push(v.spawnError ? `CLI não encontrado (${this.bin})` : v.stderr.trim());
      return base;
    }
    base.installed = true;
    base.version = v.stdout.trim();
    const s = await runProcess(this.bin, ['login', 'status'], { cwd: process.cwd(), env, timeoutMs: 15000 });
    base.authenticated = s.exitCode === 0;
    if (!base.authenticated) base.errors.push('CLI instalado mas sem login no host do worker (execute `codex login`)');
    base.available = base.authenticated === true;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const args = ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', req.cwd];
    if (process.env.NIVOO_CODEX_MODEL) args.push('--model', process.env.NIVOO_CODEX_MODEL);
    args.push('-');
    req.onLog(`codex ${args.join(' ')}`);
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: minimalEnv({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_DATA_DIR: req.dataDir, NIVOO_JOB_ID: req.jobId }, this.passKeys),
      input: buildPrompt(req),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
    });
    if (r.aborted) return { exitCode: -1, output: r.stdout, interrupted: true, error: 'interrompido' };
    if (r.timedOut) return { exitCode: -1, output: r.stdout, error: `timeout após ${req.timeoutMs} ms` };
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    let lastMessage = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    const errors: string[] = [];
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') lastMessage = ev.item.text ?? lastMessage;
        if (ev.type === 'turn.completed' && ev.usage) {
          inputTokens = ev.usage.input_tokens;
          outputTokens = ev.usage.output_tokens;
        }
        if (ev.type === 'error' || ev.type === 'turn.failed') errors.push(JSON.stringify(ev.error ?? ev.message ?? ev));
        if (ev.type === 'item.completed') req.onLog(`[${ev.item?.type}] ${String(ev.item?.text ?? ev.item?.command ?? '').slice(0, 500)}`);
      } catch {
        req.onLog(line);
      }
    }
    const failed = r.exitCode !== 0 || errors.length > 0;
    const errText = failed ? `${errors.join('; ')} ${r.stderr.slice(0, 500)}`.trim() : undefined;
    return {
      exitCode: failed ? r.exitCode || 1 : 0,
      output: lastMessage || r.stdout.slice(-4000),
      error: errText,
      resourceUnavailable: failed && looksLikeResourceProblem(errText ?? ''),
      inputTokens,
      outputTokens,
    };
  }
}
