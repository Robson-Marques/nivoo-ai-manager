import { Injectable } from '@nestjs/common';
import { secretEnv } from '../accounts/secrets';
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
 * Variáveis repassadas além do ambiente mínimo: CLAUDE_CONFIG_DIR e as credenciais da tela "Contas de IA"
 * (CLAUDE_CODE_OAUTH_TOKEN do login oficial `claude setup-token`, ou ANTHROPIC_API_KEY).
 */
@Injectable()
export class ClaudeCodeCliProvider implements AiProvider {
  readonly id = 'claude-code-cli';
  readonly label = 'Claude';
  readonly kind = 'cli' as const;
  private readonly bin = process.env.NIVOO_CLAUDE_BIN ?? 'claude';
  private readonly passKeys = ['CLAUDE_CONFIG_DIR'];

  static readonly DENIED = ['Bash', 'WebFetch', 'WebSearch'];

  /** Aceita somente regras restritas ao diretório atual, ex.: "Edit(./src/**)". Regras genéricas são recusadas. */
  static scopedAllowRules(raw: string | undefined): string[] {
    if (!raw) return [];
    const rules = raw.split(/[\s,]+/).filter(Boolean);
    for (const r of rules) {
      const m = /^(Read|Edit|Write|Glob|Grep)\((\.\/[^)]*)\)$/.exec(r);
      if (!m || m[2].includes('..')) {
        throw new Error(`NIVOO_CLAUDE_ALLOWED_TOOLS: regra "${r}" não permitida (use apenas Ferramenta(./caminho), sem "..")`);
      }
    }
    return rules;
  }

  /**
   * Estimativa de custo pelos tokens das mensagens já recebidas (cada mensagem contada uma vez).
   * Preços por milhão de tokens configuráveis; padrão conservador de modelo intermediário.
   */
  static estimateFromStream(stdout: string): { costUsd: number; inputTokens: number; outputTokens: number } {
    const perMessage = new Map<string, any>();
    for (const line of stdout.split('\n')) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'assistant' && ev.message?.usage) perMessage.set(ev.message.id ?? `${perMessage.size}`, ev.message.usage);
      } catch {
        /* linha parcial */
      }
    }
    const pin = Number(process.env.NIVOO_PRECO_ENTRADA_USD_MTOK ?? 3);
    const pout = Number(process.env.NIVOO_PRECO_SAIDA_USD_MTOK ?? 15);
    let input = 0;
    let output = 0;
    let cost = 0;
    for (const u of perMessage.values()) {
      const inp = u.input_tokens ?? 0;
      const create = u.cache_creation_input_tokens ?? 0;
      const read = u.cache_read_input_tokens ?? 0;
      const out = u.output_tokens ?? 0;
      input += inp + create + read;
      output += out;
      cost += ((inp + create * 1.25 + read * 0.1) * pin + out * pout) / 1_000_000;
    }
    return { costUsd: Math.round(cost * 10000) / 10000, inputTokens: input, outputTokens: output };
  }

  /** Resume um evento stream-json do Claude Code em uma linha de log legível. */
  static logEvent(line: string, onLog: (l: string, level?: 'INFO' | 'WARN' | 'ERROR') => void): void {
    if (!line.trim()) return;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      onLog(line.slice(0, 500));
      return;
    }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') {
          const i = c.input ?? {};
          onLog(`[ferramenta] ${c.name} ${i.file_path ?? i.path ?? i.pattern ?? i.command ?? ''}`.trim());
        } else if (c.type === 'text' && c.text) onLog(`[agente] ${String(c.text).slice(0, 1500)}`);
      }
    } else if (ev.type === 'user') {
      for (const c of ev.message?.content ?? []) {
        if (c?.type === 'tool_result' && c.is_error) onLog(`[ferramenta negada/erro] ${String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 300)}`, 'WARN');
      }
    } else if (ev.type === 'rate_limit_event') {
      onLog(`[limite do provedor] ${JSON.stringify(ev).slice(0, 300)}`, 'WARN');
    }
  }

  private env(extra: Record<string, string> = {}) {
    // Token oficial / chave de API entregues pela tela "Contas de IA" (ou pelo administrador no ambiente).
    return minimalEnv({ ...secretEnv(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']), ...extra }, this.passKeys);
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
    if (base.authenticated === false) base.errors.push('não conectado (conecte em Contas de IA)');
    base.available = base.authenticated !== false;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    // Isolamento: NENHUMA regra genérica (ex.: "Write") — ela liberaria escrita em qualquer caminho.
    // Com acceptEdits e sem regras extras, o Claude Code só lê/edita dentro do diretório de trabalho;
    // fora dele a permissão é negada no modo não interativo (comprovado em test/integration/real-01).
    // --restricted: ignora configurações de usuário/projeto/local (hooks, plugins, CLAUDE.md do workspace),
    // remove ferramentas que executam código e confina as ferramentas de arquivo ao diretório de trabalho.
    // --strict-mcp-config: nenhum servidor MCP além dos passados explicitamente (nenhum).
    // Comprovado: sem isso, um .claude/settings.json plantado no workspace executava shell na sessão seguinte.
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--restricted', '--strict-mcp-config',
      '--permission-mode', 'acceptEdits', '--disallowedTools', ...ClaudeCodeCliProvider.DENIED,
    ];
    const extra = ClaudeCodeCliProvider.scopedAllowRules(process.env.NIVOO_CLAUDE_ALLOWED_TOOLS);
    if (extra.length) args.push('--allowedTools', ...extra);
    const model = req.options?.model ?? process.env.NIVOO_CLAUDE_MODEL;
    if (model) args.push('--model', model);
    const maxTurns = req.options?.maxTurns ?? (process.env.NIVOO_CLAUDE_MAX_TURNS ? Number(process.env.NIVOO_CLAUDE_MAX_TURNS) : undefined);
    if (maxTurns) args.push('--max-turns', String(maxTurns));
    req.onLog(`claude ${args.join(' ')} (cwd=${req.cwd})`);
    // Perfil do projeto como instrução de sistema: pesa mais que o texto do prompt (vai também no prompt).
    if (req.systemPrompt) args.push('--append-system-prompt', req.systemPrompt);
    let pending = '';
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_JOB_ID: req.jobId }),
      input: buildPrompt(req),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
      // Cada evento do agente (ferramentas usadas, permissões negadas) vai para o log do job.
      onStdout: (c) => {
        pending += c;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const l of lines) ClaudeCodeCliProvider.logEvent(l, req.onLog);
      },
      onStderr: (c) => c.split('\n').filter(Boolean).forEach((l) => req.onLog(l, 'WARN')),
    });
    // Sessão encerrada à força: o CLI não emite o custo final. Estima pelos tokens já informados no stream,
    // para que o orçamento do job e do projeto continue valendo.
    if (r.aborted || r.timedOut) {
      const est = ClaudeCodeCliProvider.estimateFromStream(r.stdout);
      const base = { exitCode: -1, output: '', costUsd: est.costUsd, costEstimated: true, inputTokens: est.inputTokens, outputTokens: est.outputTokens };
      return r.aborted ? { ...base, interrupted: true, error: 'interrompido' } : { ...base, error: `timeout após ${req.timeoutMs} ms` };
    }
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    let parsed: any = null;
    for (const line of r.stdout.trim().split('\n').reverse()) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'result') {
          parsed = ev;
          break;
        }
      } catch {
        /* linha não-JSON */
      }
    }
    const text = parsed?.result ?? (parsed ? '' : r.stdout);
    const stopReason: string | undefined = parsed?.terminal_reason ?? parsed?.subtype;
    // Fim de sessão por limite de turnos: o agente trabalhou, mas a sessão acabou. Não é falha.
    const sessionEnded = parsed?.subtype === 'error_max_turns' || parsed?.terminal_reason === 'max_turns';
    const isError = !sessionEnded && (r.exitCode !== 0 || parsed?.is_error === true);
    req.onLog(`[sessão ${parsed?.session_id ?? '?'}] término=${stopReason ?? '?'} turnos=${parsed?.num_turns ?? '?'}`);
    if (text) req.onLog(String(text).slice(0, 4000));
    const errText = isError ? `${stopReason ?? 'erro'}: ${String(text).slice(0, 500)} ${r.stderr.slice(0, 500)}`.trim() : undefined;
    return {
      exitCode: sessionEnded ? 0 : isError ? r.exitCode || 1 : 0,
      output: String(text),
      error: errText,
      sessionEnded,
      sessionId: parsed?.session_id,
      stopReason,
      numTurns: parsed?.num_turns,
      resourceUnavailable: isError && looksLikeResourceProblem(`${text} ${r.stderr}`),
      costUsd: typeof parsed?.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined,
      inputTokens: parsed?.usage?.input_tokens,
      outputTokens: parsed?.usage?.output_tokens,
    };
  }
}
