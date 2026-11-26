import * as os from 'node:os';
import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isolatedHome, segredoDaConexao } from '../accounts/secrets';
import { minimalEnv, runProcess } from '../common/exec';
import { serversGemini } from '../mcp/para-ia';
import { observeMcpCalls,redactMcpLog } from '../mcp/observe';
import { cliReadOnly,geminiSessionSettings } from './cli-session-policy';
import { nativeSkillReadObserver } from './cli-skill-observer';
import { AiProvider, buildPrompt, ExecutionRequest, ExecutionResult, looksLikeResourceProblem, ProviderStatus } from './provider.interface';

/**
 * Gemini por chave de API (Google AI Studio; cobrança por uso), pelo Gemini CLI oficial (`gemini -p`).
 * Cada conexão tem HOME próprio, com a configuração que exclui shell e acesso à web; edições aprovadas
 * automaticamente apenas dentro do diretório de trabalho (auto_edit); .gemini/ e GEMINI.md do workspace
 * são removidos antes da sessão (limpeza de harness do executor).
 * (O login com conta Google pessoal foi encerrado pelo Google e não existe mais no Nivoo.)
 */
@Injectable()
export class GeminiApiProvider implements AiProvider {
  readonly id: string = 'gemini-api';
  readonly label: string = 'Gemini (API)';
  readonly kind = 'cli' as const;
  protected readonly bin = process.env.NIVOO_GEMINI_BIN ?? 'gemini';

  static readonly EXCLUDED_TOOLS = ['run_shell_command', 'web_fetch', 'google_web_search'];

  /** Conexão adicional (ex.: "Gemini API 2"): id próprio, nome dado pelo usuário, chave e pasta próprias. */
  conexao: string | null = null;

  /** Instância desta IA para uma conexão adicional. */
  paraConexao(id: string, nome: string): this {
    const p = new (this.constructor as new () => this)();
    Object.assign(p, { id, label: nome, conexao: id });
    return p;
  }

  /**
   * Configuração do CLI no HOME da conexão (~/.gemini/settings.json): login por chave e ferramentas proibidas.
   * O CLI só aceita arquivo de configuração "de sistema" em pasta do root, e o serviço não roda como root.
   */
  static ensureUserSettings(home: string): void {
    const file = path.join(home, '.gemini', 'settings.json');
    let atual: any = {};
    try {
      atual = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      atual = {};
    }
    const settings = {
      ...atual,
      security: { ...(atual.security ?? {}), auth: { ...(atual.security?.auth ?? {}), selectedType: 'gemini-api-key' } },
      tools: { ...(atual.tools ?? {}), exclude: GeminiApiProvider.EXCLUDED_TOOLS },
      general: { ...(atual.general ?? {}), enableAutoUpdate: false },
      privacy: { ...(atual.privacy ?? {}), usageStatisticsEnabled: false },
    };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }

  /** Ambiente do CLI: HOME próprio da conexão e a chave dela. */
  env(extra: Record<string, string> = {}) {
    const home = extra.HOME??isolatedHome(this.conexao ?? 'gemini-api');
    if(!extra.HOME)GeminiApiProvider.ensureUserSettings(home);
    const k = segredoDaConexao(this.conexao, 'GEMINI_API_KEY');
    return minimalEnv({ ...(k ? { GEMINI_API_KEY: k } : {}), HOME: home, ...extra });
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: false,
      installed: false,
      authenticated: false,
      limits: { observacao: 'limites e cobrança da chave de API (Google AI Studio); erros de limite causam reagendamento' },
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
    base.authenticated = !!segredoDaConexao(this.conexao, 'GEMINI_API_KEY');
    if (!base.authenticated) base.errors.push('não conectado (informe a chave em Conexões)');
    base.available = base.authenticated === true;
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const readOnly=cliReadOnly(req);
    const args = ['-p', '', '--output-format', 'stream-json', '--approval-mode', readOnly?'default':'auto_edit', '--skip-trust'];
    const model = req.options?.model ?? process.env.NIVOO_GEMINI_MODEL;
    if (model) args.push('--model', model);
    req.onLog(`gemini ${args.join(' ')} (cwd=${req.cwd})`);
    // Fresh per-session settings, even without MCP. Do not inherit tools,
    // extensions or approvals from another project/account session.
    const homeMcp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-gemini-'));
    const mcp=req.options?.readOnlyReview===true?[]:req.mcp??[];
    req={...req,onLog:redactMcpLog(mcp,req.onLog)};
    const observeMcp=observeMcpCalls('gemini',mcp,req.onLog);
    try{
    fs.mkdirSync(path.join(homeMcp,'.gemini'),{mode:0o700});
    fs.writeFileSync(path.join(homeMcp,'.gemini','settings.json'),JSON.stringify(geminiSessionSettings(readOnly,serversGemini(mcp)),null,2),{mode:0o600,flag:'wx'});
    if(mcp.length)req.onLog('Ferramentas MCP nesta sessão: '+mcp.map(m=>m.nome).join(', '));
    const skillRead=nativeSkillReadObserver('gemini',req.cwd,req.onLog,req.onSkillRead);
    const observe=(line:string)=>{skillRead(line);if(!observeMcp(line))GeminiApiProvider.logEvento(line,req.onLog);};
    let pendente = '';
    // Sem instrução de sistema separada no modo headless: o perfil do projeto vai no topo do prompt (contexto).
    const r = await runProcess(this.bin, args, {
      cwd: req.cwd,
      env: this.env({ NIVOO_OUTPUT_DIR: req.outputDir, NIVOO_JOB_ID: req.jobId, HOME:homeMcp,GEMINI_CLI_HOME:homeMcp }),
      input: buildPrompt(req)+(readOnly?'\n\nSessão local somente leitura: não altere arquivos; proponha a execução no plano.':''),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
      // Ferramentas usadas vão para o log na hora (a tela mostra o que a IA está fazendo).
      onStdout: (c) => {
        pendente += c;
        const linhas = pendente.split('\n');
        pendente = linhas.pop() ?? '';
        for (const l of linhas) observe(l);
      },
    });
    if (pendente.trim()) observe(pendente);
    if (r.aborted) return { exitCode: -1, output: r.stdout, interrupted: true, error: 'interrompido' };
    if (r.timedOut) {
      // O Gemini CLI repete sozinho, em silêncio, quando o Google responde 503 (sobrecarga): o tempo acaba
      // sem resposta. Dito com clareza, e tratado como IA indisponível (a reserva assume, se houver).
      if (/\b503\b|UNAVAILABLE|overloaded|high demand|service unavailable/i.test(`${r.stderr}\n${r.stdout}`)) {
        return { exitCode: -1, output: '', error: 'o Google está sobrecarregado (503 ServiceUnavailable) e não respondeu a tempo; tente de novo em alguns minutos ou use outra IA', resourceUnavailable: true };
      }
      return { exitCode: -1, output: r.stdout, error: `timeout após ${req.timeoutMs} ms` };
    }
    if (r.spawnError) return { exitCode: -1, output: '', error: r.spawnError, resourceUnavailable: true };
    const res = GeminiApiProvider.parse(r.stdout, r.stderr, r.exitCode ?? 1, () => undefined); // eventos já registrados
    if (res.output && res.exitCode === 0) req.onLog(`[agente] ${res.output.slice(0, 1500)}`);
    return res;
    }finally{fs.rmSync(homeMcp,{recursive:true,force:true});}
  }

  /** Um evento do stream-json em linha de log (ferramentas e erros; o texto vai no fim, inteiro). */
  static logEvento(line: string, onLog: ExecutionRequest['onLog']): void {
    if (!line.trim()) return;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      onLog(line.slice(0, 500));
      return;
    }
    if (ev.type === 'tool_use') onLog(`[ferramenta] ${ev.tool_name ?? ev.name ?? ''} ${JSON.stringify(ev.parameters ?? ev.args ?? {}).slice(0, 300)}`);
    else if (ev.type === 'tool_result' && ev.status === 'error') onLog(`[ferramenta negada/erro] ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`, 'WARN');
    else if (ev.type === 'error') onLog(`[erro] ${String(ev.message ?? JSON.stringify(ev)).slice(0, 300)}`, 'WARN');
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
    // Erro "crítico" do CLI (ex.: o Google encerrou o acesso com conta pessoal) vem no stderr, antes do resto.
    const critico = /An unexpected critical error occurred:\s*(.+)/.exec(stderr)?.[1];
    const errText = failed ? (error ?? critico ?? stderr.slice(-800)).trim() : undefined;
    return {
      exitCode: failed ? exitCode || 1 : 0,
      output: text || stdout.slice(-4000),
      error: errText,
      resourceUnavailable: failed && looksLikeResourceProblem(`${errText ?? ''} ${stderr.slice(-4000)}`),
      sessionId,
      stopReason: failed ? 'erro' : 'completed',
      inputTokens,
      outputTokens,
    };
  }
}
