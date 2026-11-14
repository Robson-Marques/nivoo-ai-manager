import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getSecret, secretEnv } from '../accounts/secrets';
import { minimalEnv, runProcess } from '../common/exec';
import { AiProvider, buildPrompt, ExecutionRequest, ExecutionResult, looksLikeResourceProblem, ProviderStatus } from './provider.interface';

/**
 * Gemini CLI (`gemini -p`), oficial do Google, com o login da conta Google do usuário (feito na tela
 * "Contas de IA", que usa o fluxo oficial do próprio CLI) ou com GEMINI_API_KEY.
 * Isolamento: configuração do usuário do serviço que exclui shell e acesso à web; edições aprovadas
 * automaticamente apenas dentro do diretório de trabalho (auto_edit); .gemini/ e GEMINI.md do workspace
 * são removidos antes da sessão (limpeza de harness do executor).
 */
@Injectable()
export class GeminiCliProvider implements AiProvider {
  readonly id = 'gemini-cli';
  readonly label = 'Gemini';
  readonly kind = 'cli' as const;
  private readonly bin = process.env.NIVOO_GEMINI_BIN ?? 'gemini';

  static readonly EXCLUDED_TOOLS = ['run_shell_command', 'web_fetch', 'google_web_search'];

  /** Credenciais do login com conta Google gravadas pelo próprio CLI no HOME do serviço. */
  static oauthFile(): string {
    return path.join(process.env.HOME ?? os.homedir(), '.gemini', 'oauth_creds.json');
  }

  /**
   * Configuração do usuário do serviço (~/.gemini/settings.json): método de login e ferramentas proibidas.
   * O CLI só aceita arquivo de configuração "de sistema" em pasta do root, e o serviço não roda como root;
   * por isso a configuração vai no HOME do serviço. .gemini/ do workspace é removido antes de cada sessão.
   */
  static ensureUserSettings(selectedType: 'oauth-personal' | 'gemini-api-key'): void {
    const file = path.join(process.env.HOME ?? os.homedir(), '.gemini', 'settings.json');
    let atual: any = {};
    try {
      atual = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      atual = {};
    }
    const settings = {
      ...atual,
      security: { ...(atual.security ?? {}), auth: { ...(atual.security?.auth ?? {}), selectedType } },
      tools: { ...(atual.tools ?? {}), exclude: GeminiCliProvider.EXCLUDED_TOOLS },
      general: { ...(atual.general ?? {}), enableAutoUpdate: false },
      privacy: { ...(atual.privacy ?? {}), usageStatisticsEnabled: false },
    };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }

  private env(extra: Record<string, string> = {}) {
    GeminiCliProvider.ensureUserSettings(getSecret('GEMINI_API_KEY') ? 'gemini-api-key' : 'oauth-personal');
    return minimalEnv({ ...secretEnv(['GEMINI_API_KEY']), ...extra });
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: false,
      installed: false,
      authenticated: false,
      limits: { observacao: 'limites da conta Google (plano Gemini) ou da chave de API; erros de limite causam reagendamento' },
      capabilities: ['editar-codigo', 'saida-json'],
      errors: [],
      checkedAt: new Date().toISOString(),
      isAi: true,
    };
    const v = await runProcess(this.bin, ['--version'], { cwd: process.cwd(), env: this.env(), timeoutMs: 20000 });
    if (v.exitCode !== 0) {
      base.errors.push(v.spawnError ? `CLI não encontrado (${this.bin})` : v.stderr.trim().slice(0, 300));
      return base;
    }
    base.installed = true;
    base.version = v.stdout.trim();
    base.authenticated = !!getSecret('GEMINI_API_KEY') || fs.existsSync(GeminiCliProvider.oauthFile());
    if (!base.authenticated) base.errors.push('não conectado (conecte em Contas de IA)');
    base.available = base.authenticated === true;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const args = ['-p', '', '--output-format', 'stream-json', '--approval-mode', 'auto_edit', '--skip-trust'];
    const model = req.options?.model ?? process.env.NIVOO_GEMINI_MODEL;
    if (model) args.push('--model', model);
    req.onLog(`gemini ${args.join(' ')} (cwd=${req.cwd})`);
    // Sem instrução de sistema separada no modo headless: o perfil do projeto vai no topo do prompt (contexto).
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_JOB_ID: req.jobId }),
      input: buildPrompt(req),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
    });
    if (r.aborted) return { exitCode: -1, output: r.stdout, interrupted: true, error: 'interrompido' };
    if (r.timedOut) return { exitCode: -1, output: r.stdout, error: `timeout após ${req.timeoutMs} ms` };
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    return GeminiCliProvider.parse(r.stdout, r.stderr, r.exitCode ?? 1, req.onLog);
  }

  /** Interpreta a saída stream-json do Gemini CLI. */
  static parse(stdout: string, stderr: string, exitCode: number, onLog: ExecutionRequest['onLog']): ExecutionResult {
    let text = '';
    let sessionId: string | undefined;
    let status: string | undefined;
    let error: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        onLog(line.slice(0, 500));
        continue;
      }
      if (ev.type === 'init') sessionId = ev.session_id;
      else if (ev.type === 'message' && ev.role === 'assistant' && typeof ev.content === 'string') text += ev.content;
      else if (ev.type === 'tool_use') onLog(`[ferramenta] ${ev.tool_name ?? ev.name ?? ''} ${JSON.stringify(ev.parameters ?? ev.args ?? {}).slice(0, 300)}`);
      else if (ev.type === 'tool_result' && ev.status === 'error') onLog(`[ferramenta negada/erro] ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`, 'WARN');
      else if (ev.type === 'error') error = String(ev.message ?? JSON.stringify(ev)).slice(0, 2000);
      else if (ev.type === 'result') {
        status = ev.status;
        if (ev.error) error = String(ev.error.message ?? JSON.stringify(ev.error)).slice(0, 2000);
        inputTokens = ev.stats?.input_tokens ?? inputTokens;
        outputTokens = ev.stats?.output_tokens ?? outputTokens;
      }
    }
    if (text) onLog(`[agente] ${text.slice(0, 1500)}`);
    const failed = status !== 'success' || exitCode !== 0;
    const errText = failed ? (error ?? stderr.slice(-800)).trim() : undefined;
    return {
      exitCode: failed ? exitCode || 1 : 0,
      output: text || stdout.slice(-4000),
      error: errText,
      resourceUnavailable: failed && looksLikeResourceProblem(errText ?? ''),
      sessionId,
      stopReason: failed ? 'erro' : 'completed',
      inputTokens,
      outputTokens,
    };
  }
}
