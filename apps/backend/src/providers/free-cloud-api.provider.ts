import { Injectable } from '@nestjs/common';
import { segredoDaConexao } from '../accounts/secrets';
import type { SecretKey } from '../accounts/secrets';
import { AiProvider, buildPrompt, ExecutionRequest, ExecutionResult, looksLikeResourceProblem, ProviderStatus } from './provider.interface';
import { executeFileTool,AGENT_FILE_TOOLS } from './agent-file-tools';

/**
 * Integrações INDEPENDENTES do free-claude-code (AGPL): nenhuma linha do projeto
 * de terceiros é copiada. Somente endpoints públicos documentados são usados.
 * Não instala modelo, GPU ou proxy adicional no POCOU.
 */
type Hospedado = 'openrouter-free-api' | 'groq-free-api';
const CONFIG: Record<Hospedado, { nome: string; base: string; key: SecretKey; padrao: string; mensagem: string }> = {
  'openrouter-free-api': {
    nome: 'OpenRouter — somente grátis',
    base: 'https://openrouter.ai/api/v1',
    key: 'OPENROUTER_API_KEY',
    padrao: 'openrouter/free',
    mensagem: 'Apenas openrouter/free e IDs terminados em :free. Nenhuma rota paga é permitida.',
  },
  'groq-free-api': {
    nome: 'GroqCloud — modalidade Free',
    base: 'https://api.groq.com/openai/v1',
    key: 'GROQ_API_KEY',
    padrao: 'openai/gpt-oss-120b',
    mensagem: 'Gratuidade e cotas dependem de a organização Groq estar no plano Free.',
  },
};

export function modeloOpenRouterGratuito(id: string): boolean {
  return id === 'openrouter/free' || /^[A-Za-z0-9._/-]+:free$/.test(id);
}

function pareceModeloNaoTextual(id: string): boolean {
  return /(?:whisper|transcri|guard|tts|speech|audio|image|embed|rerank|vision|video|music)/i.test(id);
}

export function modeloGroqDeTexto(id: string): boolean {
  return /^[A-Za-z0-9._/-]{1,150}$/.test(id) && !pareceModeloNaoTextual(id);
}

type ModeloApi = { id?: unknown; name?: unknown; description?: unknown; supported_parameters?: unknown; active?: boolean; pricing?: { prompt?: unknown; completion?: unknown } };
type Resposta = {
  choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function textoResposta(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x?.type === 'text' && typeof x?.text === 'string').map(x => x.text).join('\n');
  return '';
}

export class FreeCloudApiProvider implements AiProvider {
  readonly id: string;
  readonly label: string;
  readonly kind = 'api' as const;
  readonly conexao: string | null = null;

  constructor(readonly tipo: Hospedado) {
    this.id = tipo;
    this.label = CONFIG[tipo].nome;
  }

  paraConexao(id: string, nome: string): this {
    const copia = new (this.constructor as new () => this)();
    Object.assign(copia, { id, label: nome, conexao: id });
    return copia;
  }

  private get conf() { return CONFIG[this.tipo]; }
  private chave(): string | undefined { return segredoDaConexao(this.conexao, this.conf.key); }

  private async chamar(endpoint: '/models' | '/chat/completions' | '/key', data: unknown, tempo: number, signal?: AbortSignal): Promise<any> {
    const chave = this.chave();
    if (!chave) throw new Error('Chave ' + this.conf.nome + ' não configurada');
    const timeout = AbortSignal.timeout(Math.max(1000, tempo));
    const resposta = await fetch(this.conf.base + endpoint, {
      method: data == null ? 'GET' : 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + chave, ...(data == null ? {} : { 'Content-Type': 'application/json' }) },
      ...(data == null ? {} : { body: JSON.stringify(data) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const raw = (await resposta.text()).slice(0, 2_000_000);
    let json: any = {};
    try { json = JSON.parse(raw); } catch { /* resposta textual da API */ }
    if (!resposta.ok) {
      const detalhe = String(json?.error?.message ?? json?.message ?? raw).split(chave).join('[chave ocultada]').slice(0, 400);
      throw new Error(this.conf.nome + ' HTTP ' + resposta.status + ': ' + detalhe);
    }
    return json;
  }

  /** Retorna SOMENTE modelos de texto/ ferramenta, nunca uma vitrine com modelos indisponíveis. */
  async modelos(): Promise<Array<{ id: string; nome: string; descricao: string }>> {
    const resposta = await this.chamar('/models', null, 15_000);
    const raw = Array.isArray(resposta?.data) ? resposta.data as ModeloApi[] : [];
    const opcoes = raw
      .filter(m => typeof m.id === 'string' && m.active !== false)
      .filter(m => this.tipo === 'openrouter-free-api'
        ? modeloOpenRouterGratuito(m.id as string) && !pareceModeloNaoTextual(m.id as string) &&
          (m.pricing == null || (Number(m.pricing.prompt ?? 0) === 0 && Number(m.pricing.completion ?? 0) === 0)) &&
          (!Array.isArray(m.supported_parameters) || m.supported_parameters.includes('tools'))
        : modeloGroqDeTexto(m.id as string))
      .map(m => ({
        id: String(m.id),
        nome: String(m.name ?? m.id).slice(0, 150),
        descricao: this.tipo === 'openrouter-free-api' ? 'Rota gratuita; limitada pela cota OpenRouter' : 'Modelo sujeito à cota do plano GroqCloud',
      }));
    if (this.tipo === 'openrouter-free-api' && !opcoes.some(m => m.id === 'openrouter/free'))
      opcoes.unshift({ id: 'openrouter/free', nome: 'OpenRouter — roteador de modelos grátis', descricao: 'Seleciona modelos gratuitos compatíveis com ferramentas' });
    return opcoes.sort((a, b) => Number(b.id === this.conf.padrao) - Number(a.id === this.conf.padrao) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const status: ProviderStatus = {
      id: this.id, label: this.label, kind: this.kind, available: false, installed: true,
      authenticated: false, limits: { observacao: this.conf.mensagem }, capabilities: ['editar-codigo', 'ferramentas-arquivo'],
      errors: [], checkedAt: new Date().toISOString(), isAi: true,
    };
    if (!this.chave()) {
      status.errors.push('Não conectado: informe sua chave em Conexões');
      return status;
    }
    try {
      // OpenRouter /models é público e NÃO valida a chave; /key valida autenticação sem gerar tokens.
      await this.chamar(this.tipo === 'openrouter-free-api' ? '/key' : '/models', null, 12_000);
      status.authenticated = true;
      // "Conectado" exige ao menos um modelo de texto elegível, não só uma chave aceita.
      const opcoes = await this.modelos();
      if (!opcoes.length) {
        status.errors.push('Nenhum modelo de texto elegível retornado para esta conexão');
      } else {
        status.available = true;
      }
    } catch (e: any) {
      status.errors.push(String(e?.message ?? e).slice(0, 450));
    }
    return status;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.chave()) return { exitCode: 1, output: '', error: 'Chave não configurada', resourceUnavailable: true };
    const model = String(req.options?.model || this.conf.padrao);
    if (this.tipo === 'openrouter-free-api' && !modeloOpenRouterGratuito(model)) {
      return { exitCode: 1, output: '', error: 'Modelo pago bloqueado: escolha openrouter/free ou um ID terminado em :free' };
    }
    if (this.tipo === 'groq-free-api' && !modeloGroqDeTexto(model)) {
      return { exitCode: 1, output: '', error: 'Modelo não compatível com agente de texto' };
    }
    let entrada = 0, saida = 0, escritas = 0;
    const inicio = Date.now();
    const turnos = Math.max(1, Math.min(30, Number(req.options?.maxTurns) || 20));
    const mensagens: Array<Record<string, unknown>> = [
      { role: 'system', content: [req.systemPrompt ?? '', 'Você é agente de engenharia do Nivoo AI Manager. Trabalhe somente no diretório do projeto. Ferramentas disponíveis permitem ler/editar arquivos, não executar comandos. Leia contexto autorizado e Skills com ler_arquivo. Use registrar_progresso para notas internas. Não leia segredos nem invente verificações. O Nivoo valida builds/testes em etapa separada.'].join('\n') },
      { role: 'user', content: buildPrompt(req) },
    ];
    req.onLog(this.conf.nome + ': modelo ' + model + ' — ' + this.conf.mensagem);
    try {
      const permitidos = await this.modelos();
      if (!permitidos.some(m => m.id === model)) throw new Error('Modelo não listado como acessível nesta conexão: ' + model);
      for (let turno = 0; turno < turnos; turno++) {
        if (req.signal.aborted) return { exitCode: -1, output: '', interrupted: true, error: 'interrompido' };
        const restante = req.timeoutMs - (Date.now() - inicio);
        if (restante <= 0) return { exitCode: 1, output: '', error: 'tempo de sessão esgotado', sessionEnded: true, numTurns: turno };
        const resposta = await this.chamar('/chat/completions', {
          model, messages: mensagens, tools: AGENT_FILE_TOOLS, tool_choice: 'auto', stream: false, max_tokens: 4096,
        }, Math.min(restante, 120_000), req.signal) as Resposta;
        entrada += resposta.usage?.prompt_tokens ?? 0;
        saida += resposta.usage?.completion_tokens ?? 0;
        const msg = resposta.choices?.[0]?.message;
        if (!msg) throw new Error('Modelo não retornou mensagem de chat');
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        const texto = textoResposta(msg.content);
        if (!calls.length) {
          if (!texto && !escritas) throw new Error('Modelo não respondeu e não editou arquivos');
          return { exitCode: 0, output: texto || ('Arquivos alterados: ' + escritas),
            inputTokens: entrada, outputTokens: saida, numTurns: turno + 1, stopReason: resposta.choices?.[0]?.finish_reason ?? 'completed' };
        }
        if (calls.length > 10) throw new Error('Modelo requisitou mais de 10 ferramentas por turno');
        mensagens.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
        for (const call of calls) {
          const nome = String(call.function?.name ?? '');
          let resultado: string;
          try {
            const args = JSON.parse(String(call.function?.arguments ?? '{}'));
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos');
            resultado = executeFileTool(req.cwd, nome, args);
            if ((nome === 'escrever_arquivo' || nome === 'substituir_texto')&&JSON.parse(resultado).alterado===true) escritas++;
            req.onLog('[ferramenta segura] ' + nome + ': ' + String(args.caminho ?? args.pasta ?? '').slice(0, 100));
          } catch (e: any) {
            resultado = JSON.stringify({ erro: String(e?.message ?? e).slice(0, 500) });
            req.onLog('[ferramenta] ' + nome + ': ' + resultado.slice(0, 160), 'WARN');
          }
          mensagens.push({ role: 'tool', tool_call_id: String(call.id ?? ''), content: resultado.slice(0, 24_000) });
        }
      }
      return { exitCode: 0, output: 'Limite de turnos atingido. Continuar a partir do checkpoint.', sessionEnded: true,
        numTurns: turnos, inputTokens: entrada, outputTokens: saida, stopReason: 'max_turns' };
    } catch (e: any) {
      if (req.signal.aborted) return { exitCode: -1, output: '', interrupted: true, error: 'interrompido' };
      const erro = String(e?.message ?? e).split(this.chave() ?? '').join('[chave ocultada]').slice(0, 800);
      req.onLog('[' + this.conf.nome + '] ' + erro, 'WARN');
      return { exitCode: 1, output: '', error: erro,
        resourceUnavailable: looksLikeResourceProblem(erro) || /HTTP (401|402|403|404|429|500|502|503|504)|fetch failed|timeout/i.test(erro),
        inputTokens: entrada, outputTokens: saida };
    }
  }
}

@Injectable()
export class OpenRouterFreeProvider extends FreeCloudApiProvider {
  constructor() { super('openrouter-free-api'); }
}

@Injectable()
export class GroqFreeProvider extends FreeCloudApiProvider {
  constructor() { super('groq-free-api'); }
}
