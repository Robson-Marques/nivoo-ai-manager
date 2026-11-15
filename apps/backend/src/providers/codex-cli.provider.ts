import { Injectable } from '@nestjs/common';
import { isolatedHome } from '../accounts/secrets';
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
  /** Um evento do `codex exec --json` em linha de log legível. */
  static logEvento(line: string, onLog: ExecutionRequest['onLog']): void {
    if (!line.trim()) return;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      onLog(line.slice(0, 500));
      return;
    }
    const it = ev.item ?? {};
    if (ev.type === 'item.completed') {
      if (it.type === 'command_execution') onLog(`[comando] ${String(it.command ?? '').slice(0, 300)}`);
      else if (it.type === 'file_change') onLog(`[arquivos] ${(it.changes ?? []).map((c: any) => `${c.kind ?? ''} ${c.path ?? ''}`.trim()).join(', ').slice(0, 300)}`);
      else onLog(`[${it.type}] ${String(it.text ?? it.command ?? '').slice(0, 500)}`);
    } else if (ev.type === 'error' || ev.type === 'turn.failed') onLog(`[erro] ${JSON.stringify(ev.error ?? ev.message ?? ev).slice(0, 300)}`, 'WARN');
  }

  readonly id: string = 'codex-cli';
  readonly label: string = 'ChatGPT (conta)';
  readonly kind = 'cli' as const;
  protected readonly bin = process.env.NIVOO_CODEX_BIN ?? 'codex';
  protected readonly passKeys = ['CODEX_HOME'];

  /** Conexão adicional (ex.: "ChatGPT 2"): id próprio, nome dado pelo usuário, credenciais e pasta próprias. */
  conexao: string | null = null;

  /** Instância desta IA para uma conexão adicional. */
  paraConexao(id: string, nome: string): this {
    const p = new (this.constructor as new () => this)();
    Object.assign(p, { id, label: nome, conexao: id });
    return p;
  }

  /** Ambiente do CLI. Conta: CODEX_HOME padrão do serviço (login com a conta do ChatGPT). */
  env(extra: Record<string, string> = {}) {
    if (this.conexao) return minimalEnv({ CODEX_HOME: isolatedHome(this.conexao), ...extra });
    return minimalEnv(extra, this.passKeys);
  }

  /** Conta: login feito com a conta do ChatGPT (não com chave de API). */
  protected loggedIn(exitCode: number | null, out: string): boolean {
    return exitCode === 0 && !/api key/i.test(out);
  }

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
    const env = this.env();
    const v = await runProcess(this.bin, ['--version'], { cwd: process.cwd(), env, timeoutMs: 15000 });
    if (v.exitCode !== 0) {
      base.errors.push(v.spawnError ? `CLI não encontrado (${this.bin})` : v.stderr.trim());
      return base;
    }
    base.installed = true;
    base.version = v.stdout.trim();
    const s = await runProcess(this.bin, ['login', 'status'], { cwd: process.cwd(), env, timeoutMs: 15000 });
    base.authenticated = this.loggedIn(s.exitCode, `${s.stdout}\n${s.stderr}`);
    if (!base.authenticated) base.errors.push('não conectado (conecte em Conexões)');
    base.available = base.authenticated === true;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    // project_doc_max_bytes=0: não carrega AGENTS.md do workspace (canal de contexto fora do prompt auditado).
    const args = ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-c', 'project_doc_max_bytes=0', '-C', req.cwd];
    const model = req.options?.model ?? process.env.NIVOO_CODEX_MODEL;
    if (model) args.push('--model', model);
    for (const img of req.options?.images ?? []) args.push('--image', img);
    args.push('-');
    req.onLog(`codex ${args.join(' ')}`);
    let pendente = '';
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_JOB_ID: req.jobId }),
      input: buildPrompt(req),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
      // Cada passo do agente vai para o log na hora (a tela mostra o que a IA está fazendo, sem esperar a sessão acabar).
      onStdout: (c) => {
        pendente += c;
        const linhas = pendente.split('\n');
        pendente = linhas.pop() ?? '';
        for (const l of linhas) CodexCliProvider.logEvento(l, req.onLog);
      },
    });
    if (pendente.trim()) CodexCliProvider.logEvento(pendente, req.onLog);
    if (r.aborted) return { exitCode: -1, output: r.stdout, interrupted: true, error: 'interrompido' };
    if (r.timedOut) return { exitCode: -1, output: r.stdout, error: `timeout após ${req.timeoutMs} ms` };
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    let lastMessage = '';
    let sessionId: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    const errors: string[] = [];
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'thread.started') sessionId = ev.thread_id ?? sessionId;
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') lastMessage = ev.item.text ?? lastMessage;
        if (ev.type === 'turn.completed' && ev.usage) {
          inputTokens = ev.usage.input_tokens;
          outputTokens = ev.usage.output_tokens;
        }
        if (ev.type === 'error' || ev.type === 'turn.failed') errors.push(JSON.stringify(ev.error ?? ev.message ?? ev));
      } catch {
        /* linha não-JSON: já foi para o log durante a sessão */
      }
    }
    const failed = r.exitCode !== 0 || errors.length > 0;
    const errText = failed ? `${errors.join('; ')} ${r.stderr.slice(0, 500)}`.trim() : undefined;
    return {
      exitCode: failed ? r.exitCode || 1 : 0,
      output: lastMessage || r.stdout.slice(-4000),
      error: errText,
      resourceUnavailable: failed && looksLikeResourceProblem(errText ?? ''),
      sessionId,
      stopReason: failed ? 'erro' : 'completed',
      inputTokens,
      outputTokens,
    };
  }
}

/**
 * ChatGPT com chave de API da OpenAI (cobrança por uso). Mesmo CLI; CODEX_HOME próprio, onde a chave é
 * registrada pelo comando oficial `codex login --with-api-key` — não mexe no login da conta.
 */
@Injectable()
export class CodexApiProvider extends CodexCliProvider {
  readonly id: string = 'codex-api';
  readonly label: string = 'ChatGPT (API)';

  env(extra: Record<string, string> = {}) {
    return minimalEnv({ CODEX_HOME: isolatedHome(this.conexao ?? 'codex-api'), ...extra });
  }

  protected loggedIn(exitCode: number | null): boolean {
    return exitCode === 0;
  }
}
