import { executeGoldfishCli } from './goldfish-cli';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { configClaude, permissoesClaude } from '../mcp/para-ia';
import { Injectable } from '@nestjs/common';
import { isolatedHome, segredoDaConexao, secretEnv } from '../accounts/secrets';
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
 * Variáveis repassadas além do ambiente mínimo: CLAUDE_CONFIG_DIR e as credenciais da tela "Conexões"
 * (CLAUDE_CODE_OAUTH_TOKEN do login oficial `claude setup-token`, ou ANTHROPIC_API_KEY).
 */
@Injectable()
export class ClaudeCodeCliProvider implements AiProvider {
  readonly id: string = 'claude-code-cli';
  readonly label: string = 'Claude (conta)';
  readonly kind = 'cli' as const;
  protected readonly bin = process.env.NIVOO_CLAUDE_BIN ?? 'claude';
  protected readonly passKeys = ['CLAUDE_CONFIG_DIR'];

  /** Conexão adicional (ex.: "ChatGPT 2"): id próprio, nome dado pelo usuário, credenciais e pasta próprias. */
  conexao: string | null = null;

  /** Instância desta IA para uma conexão adicional. */
  paraConexao(id: string, nome: string): this {
    const p = new (this.constructor as new () => this)();
    Object.assign(p, { id, label: nome, conexao: id });
    return p;
  }

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
      // Aviso de rotina do Claude sobre o limite de uso: "liberado" não interessa à tela; perto do limite ou estourado,
      // em português e com a hora em que renova.
      const info = ev.rate_limit_info ?? {};
      const status = String(info.status ?? '');
      if (status && status !== 'allowed') {
        const tipo: Record<string, string> = { five_hour: 'de 5 horas', seven_day: 'semanal', seven_day_opus: 'semanal (Opus)' };
        const quando = Number(info.resetsAt) ? new Date(Number(info.resetsAt) * (Number(info.resetsAt) < 1e12 ? 1000 : 1)).toISOString() : '';
        const uso = typeof info.utilization === 'number' ? ` (${Math.round(info.utilization * (info.utilization <= 1 ? 100 : 1))}% usado)` : '';
        onLog(
          `[limite da IA] ${status === 'allowed_warning' ? 'perto do limite' : 'limite atingido'} ${tipo[info.rateLimitType] ?? ''}${uso}${quando ? `; renova em ${quando}` : ''}`.replace(/\s+/g, ' '),
          'WARN',
        );
      }
    }
  }

  /** Conta (assinatura): token oficial do login pela tela (ou do administrador). Nunca a chave de API. */
  protected credentials(): Record<string, string> {
    if (!this.conexao) return secretEnv(['CLAUDE_CODE_OAUTH_TOKEN']);
    const t = segredoDaConexao(this.conexao, 'CLAUDE_CODE_OAUTH_TOKEN');
    return { ...(t ? { CLAUDE_CODE_OAUTH_TOKEN: t } : {}), CLAUDE_CONFIG_DIR: isolatedHome(this.conexao) };
  }

  /** Ambiente do CLI desta IA (credenciais e pasta de configuração próprias). */
  env(extra: Record<string, string> = {}) {
    return minimalEnv({ ...this.credentials(), ...extra }, this.conexao ? [] : this.passKeys);
  }

  /** Conta: o próprio CLI diz se há login. */
  protected async authenticated(base: ProviderStatus): Promise<boolean | 'desconhecido'> {
    const auth = await runProcess(this.bin, ['auth', 'status'], { cwd: process.cwd(), env: this.env(), timeoutMs: 15000 });
    try {
      const parsed = JSON.parse(auth.stdout);
      if (parsed.authMethod) base.limits.metodoAutenticacao = String(parsed.authMethod);
      return parsed.loggedIn === true;
    } catch {
      return auth.exitCode === 0 ? 'desconhecido' : false;
    }
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
    base.authenticated = await this.authenticated(base);
    if (base.authenticated === false) base.errors.push('não conectado (conecte em Conexões)');
    base.available = base.authenticated !== false;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    if(req.options?.goldfishIsolatedReview===true)return executeGoldfishCli('claude',this.bin,this.env(),req);
    // Isolamento: NENHUMA regra genérica (ex.: "Write") — ela liberaria escrita em qualquer caminho.
    // Com acceptEdits e sem regras extras, o Claude Code só lê/edita dentro do diretório de trabalho;
    // fora dele a permissão é negada no modo não interativo (comprovado em test/integration/real-01).
    // --restricted: ignora configurações de usuário/projeto/local (hooks, plugins, CLAUDE.md do workspace),
    // remove ferramentas que executam código e confina as ferramentas de arquivo ao diretório de trabalho.
    // --strict-mcp-config: nenhum servidor MCP além dos passados explicitamente (nenhum).
    // Comprovado: sem isso, um .claude/settings.json plantado no workspace executava shell na sessão seguinte.
    const readOnly=req.options?.readOnlyReview===true;
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--restricted', '--strict-mcp-config',
      '--permission-mode', readOnly?'default':'acceptEdits', '--disallowedTools', ...ClaudeCodeCliProvider.DENIED,
      ...(readOnly?['Edit','Write','MultiEdit','NotebookEdit','Agent','Task']:[]),
    ];
    const extra = readOnly?[]:ClaudeCodeCliProvider.scopedAllowRules(process.env.NIVOO_CLAUDE_ALLOWED_TOOLS);
    // Ferramentas MCP do projeto: arquivo só desta sessão (fora da pasta do trabalho, 600) e permissão só a elas.
    let pastaMcp: string | null = null;
    if (!readOnly&&req.mcp?.length) {
      pastaMcp = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-mcp-'));
      const arq = path.join(pastaMcp, 'mcp.json');
      fs.writeFileSync(arq, JSON.stringify(configClaude(req.mcp)), { mode: 0o600 });
      args.push('--mcp-config', arq);
      extra.push(...permissoesClaude(req.mcp));
      req.onLog(`Ferramentas MCP nesta sessão: ${req.mcp.map((m) => m.nome).join(', ')}`);
    }
    if (extra.length) args.push('--allowedTools', ...extra);
    // Sem MCP, mostrar ao Claude SOMENTE ferramentas presentes neste executor.
    // --disallowedTools continua como defesa em profundidade; --tools evita oferecer Bash ao modelo.
    if (readOnly||!req.mcp?.length) args.push('--tools', readOnly?'Read,Glob,Grep':'Read,Edit,Write,Glob,Grep');
    const model = req.options?.model ?? process.env.NIVOO_CLAUDE_MODEL;
    if (model) args.push('--model', model);
    const maxTurns = req.options?.maxTurns ?? (process.env.NIVOO_CLAUDE_MAX_TURNS ? Number(process.env.NIVOO_CLAUDE_MAX_TURNS) : undefined);
    if (maxTurns) args.push('--max-turns', String(maxTurns));
    req.onLog(`claude ${args.join(' ')} (cwd=${req.cwd})`);
    // Instrução explícita à IA: ferramentas ocultas/desabilitadas não são alternativas válidas.
    // O shell pertence ao executor local em OUTRA etapa, não a esta sessão restrita.
    const toolsPolicy = [
      'AMBIENTE NIVOO: Bash/terminal, WebFetch e WebSearch NÃO existem nesta sessão, inclusive em subagentes.',
      'NUNCA invoque Bash, nem para head, cat, grep, testes, build ou inspecionar arquivos JS.',
      readOnly?'Revisão somente leitura: use Read, Glob e Grep; não edite arquivos nem acione subagentes.':'Use Read para arquivos, Glob para listas, Grep para pesquisa, Edit/Write para modificações.',
      'Se não conseguir ler ou editar, registre o caminho e o motivo real; não tente chamar ferramenta inexistente.',
      readOnly?'Entregue somente o parecer em texto; não solicite execução ou correção automática.':'O Nivoo executa testes e comandos locais em etapas separadas, sem consumir turnos desta IA.',
    ].join('\n');
    // Perfil integral no canal de sistema; não duplicar no prompt.
    args.push('--append-system-prompt', [toolsPolicy, req.systemPrompt].filter(Boolean).join('\n\n'));
    let pending = '';
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_JOB_ID: req.jobId }),
      input: buildPrompt(req,true),
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
    if (pastaMcp) fs.rmSync(pastaMcp, { recursive: true, force: true });
    // Sessão encerrada à força: o CLI não emite o custo final. Estima pelos tokens já informados no stream,
    // para que o orçamento do job e do projeto continue valendo.
    if (r.aborted || r.timedOut) {
      const est = ClaudeCodeCliProvider.estimateFromStream(r.stdout);
      const base = { exitCode: -1, output: '', costUsd: est.costUsd, costEstimated: true, usagePartial:true, inputTokens: est.inputTokens, outputTokens: est.outputTokens };
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
    // Sem o evento final, o stdout é a transcrição inteira (arquivos lidos, código do projeto): para erro,
    // vale só o que o CLI escreveu fora do JSON (ex.: "Invalid API key · Please run /login").
    const text = parsed?.result ?? (parsed ? '' : r.stdout.split('\n').filter((l) => l.trim() && !l.trimStart().startsWith('{')).slice(-20).join('\n'));
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
      inputExcludesCache:true,
      cacheReadInputTokens:parsed?.usage?.cache_read_input_tokens,
      cacheWriteInputTokens:parsed?.usage?.cache_creation_input_tokens,
      usagePartial:!parsed,
    };
  }
}

/**
 * Claude com chave de API (cobrança por uso, à parte da assinatura). Mesmo CLI e mesmas proteções; usa
 * só ANTHROPIC_API_KEY e uma pasta de configuração própria, para nunca misturar com o login da conta.
 */
@Injectable()
export class ClaudeApiProvider extends ClaudeCodeCliProvider {
  readonly id: string = 'claude-api';
  readonly label: string = 'Claude (API)';

  protected credentials(): Record<string, string> {
    const dir = isolatedHome(this.conexao ?? 'claude-api');
    const k = segredoDaConexao(this.conexao, 'ANTHROPIC_API_KEY');
    return { ...(k ? { ANTHROPIC_API_KEY: k } : {}), CLAUDE_CONFIG_DIR: dir };
  }

  /** Ambiente do CLI desta IA (credenciais e pasta de configuração próprias). */
  env(extra: Record<string, string> = {}) {
    return minimalEnv({ ...this.credentials(), ...extra });
  }

  protected async authenticated(base: ProviderStatus): Promise<boolean> {
    base.limits.metodoAutenticacao = 'chave de API';
    return !!segredoDaConexao(this.conexao, 'ANTHROPIC_API_KEY');
  }
}
