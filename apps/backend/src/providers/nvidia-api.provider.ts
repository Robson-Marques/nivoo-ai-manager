import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { segredoDaConexao } from '../accounts/secrets';
import { executeFileTool,AGENT_FILE_TOOLS,AGENT_READ_TOOLS,announceSkillRead } from './agent-file-tools';
import { AiProvider, buildPrompt, ExecutionRequest, ExecutionResult, looksLikeResourceProblem, ProviderStatus } from './provider.interface';
import { modeloNvidiaServeComoAgente } from './nvidia-model-catalog';
import { compactRepeatedReads } from './tool-history';
import { retryAfterHeaderMs } from './resource-rate-limit';

/** NVIDIA Build: APIs hospedadas de avaliação (não requer GPU no servidor Nivoo). */
export const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';
const DEFAULT_TURNS = 24;
const MAX_TURNS = 40;
const MAX_TOOL_OUTPUT = 24_000;
const MIN_COOLDOWN_MS = 2 * 60_000;
// Evita mandar requisições adicionais para a mesma chave durante o Retry-After.
// Guarda somente SHA-256 da chave; o agendamento persistente fica na fila do Nivoo.
const cooldownNvidia = new Map<string, number>();
function idDaChave(chave: string): string { return createHash('sha256').update(chave).digest('hex'); }
function erro429(delayMs: number): Error & { retryAfterMs: number } {
  return Object.assign(new Error(`NVIDIA HTTP 429: Too Many Requests. Limite do provedor; reavaliar após ${Math.ceil(delayMs / 1000)}s.`), { retryAfterMs: delayMs });
}

type ChatMessage = { role: string; content: unknown; tool_calls?: any[]; tool_call_id?: string };
type NvidiaResponse = { choices?: Array<{ message?: { content?: unknown; tool_calls?: any[] }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export const NVIDIA_TOOLS=AGENT_FILE_TOOLS;

function textoDaResposta(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
  return '';
}

function erroSemChave(texto: string, chave: string): string {
  const limpo = chave ? texto.split(chave).join('[chave ocultada]') : texto;
  return limpo.replace(/nvapi-[A-Za-z0-9_-]+/g, '[chave ocultada]').slice(0, 900);
}

/** Compatibility export; all hosted text agents use the same implementation. */
export const executarFerramentaNvidia=executeFileTool;

@Injectable()
export class NvidiaApiProvider implements AiProvider {
  readonly id: string = 'nvidia-api';
  readonly label: string = 'NVIDIA NIM (API)';
  readonly kind = 'api' as const;
  readonly conexao: string | null = null;

  /** Chaves separadas: NVIDIA API 2 nunca herda a chave da NVIDIA API 1. */
  paraConexao(id: string, nome: string): this {
    const provedor = new (this.constructor as new () => this)();
    Object.assign(provedor, { id, label: nome, conexao: id });
    return provedor;
  }

  private chave(): string | undefined {
    return segredoDaConexao(this.conexao, 'NVIDIA_API_KEY');
  }

  /** Endpoint fixo impede redirecionamento do token para servidores de terceiros. */
  private async pedir(endpoint: '/models' | '/chat/completions', data: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    const chave = this.chave();
    if (!chave) throw new Error('Conecte sua chave da NVIDIA em Conexões');
    const fingerprint = idDaChave(chave);
    const restanteCooldown = (cooldownNvidia.get(fingerprint) ?? 0) - Date.now();
    if (endpoint === '/chat/completions' && restanteCooldown > 0) throw erro429(restanteCooldown);
    const temporizador = AbortSignal.timeout(Math.max(1000, timeoutMs));
    const resposta = await fetch(NVIDIA_API_BASE + endpoint, {
      method: data == null ? 'GET' : 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + chave, ...(data == null ? {} : { 'Content-Type': 'application/json' }) },
      ...(data == null ? {} : { body: JSON.stringify(data) }),
      signal: signal ? AbortSignal.any([signal, temporizador]) : temporizador,
    });
    const bruto = (await resposta.text()).slice(0, 2_000_000);
    let json: any;
    try { json = JSON.parse(bruto); } catch { json = {}; }
    if (!resposta.ok) {
      if (resposta.status === 429) {
        const delayMs = Math.max(MIN_COOLDOWN_MS, retryAfterHeaderMs(resposta.headers.get('retry-after')) ?? 0);
        cooldownNvidia.set(fingerprint, Date.now() + delayMs);
        throw erro429(delayMs);
      }
      const detalhe = erroSemChave(String(json?.error?.message ?? json?.message ?? bruto).slice(0, 450), chave);
      throw new Error('NVIDIA HTTP ' + resposta.status + ': ' + detalhe);
    }
    return json;
  }

  async modelos(): Promise<Array<{ id: string; nome: string }>> {
    const resposta = await this.pedir('/models', null, 10_000);
    return (Array.isArray(resposta.data) ? resposta.data : [])
      .filter((m: any) => typeof m?.id === 'string' && /^[A-Za-z0-9._:/-]{1,150}$/.test(m.id))
      // A lista bruta pode conter chat, embedding, rerank e outros. A seleção
      // de agentes é feita em nvidia-model-catalog, jamais por regex no gateway.
      .map((m: any) => ({ id: m.id, nome: m.id }))
      .slice(0, 500);
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: this.id, label: this.label, kind: this.kind,
      available: false, installed: true, authenticated: !!this.chave(),
      limits: { observacao: 'API hospedada de avaliação; a NVIDIA controla créditos, cotas e disponibilidade. Não é uso ilimitado.' },
      capabilities: ['editar-codigo', 'saida-json'],
      errors: [], checkedAt: new Date().toISOString(), isAi: true,
    };
    if (!base.authenticated) {
      base.errors.push('não conectado (informe a chave NVIDIA em Conexões)');
      return base;
    }
    const cooldownRestante = (cooldownNvidia.get(idDaChave(this.chave()!)) ?? 0) - Date.now();
    if (cooldownRestante > 0) {
      base.limits.retryAfterMs = cooldownRestante;
      base.errors.push('NVIDIA HTTP 429: aguardar o limite do provedor (' + Math.ceil(cooldownRestante / 1000) + 's).');
      return base;
    }
    try {
      await this.pedir('/models', null, 7_000);
      base.available = true;
      base.version = 'NVIDIA Build API';
    } catch (e: any) {
      base.errors.push(erroSemChave(String(e?.message ?? e), this.chave() ?? ''));
      if (Number.isFinite(e?.retryAfterMs)) base.limits.retryAfterMs = Number(e.retryAfterMs);
      if (/HTTP 401|HTTP 403/.test(base.errors[0])) base.authenticated = false;
    }
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const readOnlyReview=req.options?.readOnlyReview===true;
    const readOnly=readOnlyReview||req.jobId==='conversa';
    if (!this.chave()) return { exitCode: 1, output: '', error: 'Chave NVIDIA não configurada', resourceUnavailable: true };
    const model = req.options?.model ?? process.env.NIVOO_NVIDIA_MODEL ?? NVIDIA_DEFAULT_MODEL;
    if (!modeloNvidiaServeComoAgente(model)) {
      return { exitCode: 1, output: '',
        error: `O modelo NVIDIA "${model}" não está habilitado para edição de código por ferramentas. Escolha um modelo de Programação e agentes no catálogo; imagem/vídeo, embedding e rerank exigem executores próprios.` };
    }
    const turnos = Math.max(1, Math.min(MAX_TURNS, Number(req.options?.maxTurns) || DEFAULT_TURNS));
    const messages: ChatMessage[] = [
      { role: 'system', content: [
        req.systemPrompt ?? '',
        'Você é um agente de engenharia trabalhando APENAS na pasta do projeto Nivoo.',
        readOnly?'Sessão somente leitura: liste e leia arquivos, sem alterações, terminal, rede ou segredos.':'Use as ferramentas de arquivo para ler e modificar o projeto. Sem terminal, sem rede ou acesso a segredos.',
        readOnly?'Fundamente a resposta em fontes; não modifique arquivos.':'Leia antes de alterar. Preserve as mudanças existentes e registre de forma clara o que fez.',
        'As ferramentas aceitam SOMENTE caminhos relativos à pasta do trabalho (ex.: apps/api/src/routes/official-whatsapp.ts).',
        readOnly?'Leia referências autorizadas em contexto/; não registre notas nem altere arquivos.':'Leia Skills e estado em contexto/ e memória autorizada em .nivoo/memoria.md; não edite contexto ou arquivos internos. Para notas de progresso use registrar_progresso. Não acesse segredos, node_modules ou .git.',
        'Não repita a mesma leitura sem novo início: ler_arquivo entrega até 18000 caracteres; use proximo retornado como inicio para ler a parte seguinte.',
        readOnly?'Depois de entender o alvo, responda sem editar.':'Depois de entender o código, edite os arquivos solicitados em vez de repetir leituras sem avanço.',
        'As verificações e builds são responsabilidade do executor Nivoo, após sua sessão.',
        'Não invente resultado, arquivo criado, teste executado ou imagem que não tenha sido gravado.',
        'Quando faltar evidência, indique o impedimento sem marcar como aprovado.',
      ].join('\n') },
      { role: 'user', content: buildPrompt(req,true) },
    ];
    let entrada = 0, saida = 0, alteracoes = 0;
    const leiturasIguais = new Map<string, number>();
    let ultimaFalhaFerramenta = '';
    let falhasSeguidasFerramenta = 0;
    const inicio = Date.now();
    req.onLog('NVIDIA NIM: modelo ' + model + ' (ferramentas seguras de arquivo, sem terminal)');
    try {
      for (let volta = 0; volta < turnos; volta++) {
        if (req.signal.aborted) return { exitCode: -1, output: '', interrupted: true, error: 'interrompido',inputTokens:entrada,outputTokens:saida,numTurns:volta };
        const restante = req.timeoutMs - (Date.now() - inicio);
        if (restante <= 0) return { exitCode: 1, output: '', error: 'tempo da sessão NVIDIA esgotado', sessionEnded: true, numTurns: volta,inputTokens:entrada,outputTokens:saida };
        const compact=compactRepeatedReads(messages);
        if(compact.savedChars)req.onLog('Contexto NVIDIA: '+compact.savedChars+' caracteres de leituras idênticas não reenviados nesta chamada.');
        const json: NvidiaResponse = await this.pedir('/chat/completions', {
          model, messages:compact.messages, tools: readOnly?AGENT_READ_TOOLS:NVIDIA_TOOLS, tool_choice: 'auto', stream: false,
          max_tokens: 4096,
        }, Math.min(restante, 120_000), req.signal);
        entrada += json.usage?.prompt_tokens ?? 0;
        saida += json.usage?.completion_tokens ?? 0;
        const msg = json.choices?.[0]?.message;
        if (!msg) throw new Error('NVIDIA não retornou uma mensagem; confira o modelo de chat selecionado');
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        const texto = textoDaResposta(msg.content);
        if (!calls.length) {
          if (texto) req.onLog('[agente NVIDIA] ' + texto.slice(0, 1000));
          if (!texto && !alteracoes) throw new Error('NVIDIA retornou resposta vazia; escolha um modelo compatível com chat e ferramentas');
          // Alguns modelos param após um JSON de PROGRESSO dizendo "vou
          // executar", sem chamar ferramenta e sem criar nenhum arquivo.
          // Isso NÃO é execução bem-sucedida e não pode concluir uma etapa
          // só porque a conferência encontrou um MP4 de trabalho anterior.
          let progressoSemAcao = false;
          if (!alteracoes && texto) {
            try {
              const resposta = JSON.parse(texto);
              progressoSemAcao = resposta?.tipo === 'PROGRESSO' || resposta?.tipo === 'INICIO';
            } catch { /* resposta textual normal */ }
          }
          if (progressoSemAcao) {
            return { exitCode: 1, output: texto, error: 'A NVIDIA retornou somente mensagem de progresso, sem chamar ferramenta ou gravar arquivo. Nenhuma execução foi realizada.',
              inputTokens: entrada, outputTokens: saida, numTurns: volta + 1, stopReason: 'no_action' };
          }
          return { exitCode: 0, output: texto || 'Alterações concluídas: ' + alteracoes + ' arquivo(s).',
            inputTokens: entrada, outputTokens: saida, numTurns: volta + 1, stopReason: json.choices?.[0]?.finish_reason ?? 'completed' };
        }
        if(calls.length>12)throw new Error('Modelo enviou comandos demais em uma única resposta (máximo 12)');
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
        for (const call of calls.slice(0, 12)) {
          const nome = String(call?.function?.name ?? '');
          let resultado = '';
          try {
            const args = JSON.parse(String(call?.function?.arguments ?? '{}'));
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos');
            if (nome === 'ler_arquivo') {
              const chaveLeitura = JSON.stringify([args.caminho, Number(args.inicio) || 0, Number(args.limite) || 18000]);
              const vezes = leiturasIguais.get(chaveLeitura) ?? 0;
              if (vezes >= 2) {
                resultado = JSON.stringify({ aviso: 'Esta mesma parte do arquivo já foi lida duas vezes e não houve edição desde então. Não repita. Para a próxima parte, use inicio maior; para modificar, use substituir_texto ou escrever_arquivo.' });
              } else {
                resultado = executarFerramentaNvidia(req.cwd, nome, args,readOnly);
                // Falha de leitura não conta como conteúdo já entregue.
                leiturasIguais.set(chaveLeitura, vezes + 1);
              }
            } else {
              resultado = executarFerramentaNvidia(req.cwd, nome, args,readOnly);
            }
            if ((nome === 'escrever_arquivo' || nome === 'substituir_texto')&&JSON.parse(resultado).alterado===true) {
              alteracoes++;
              leiturasIguais.clear();
            }
            announceSkillRead(nome,resultado,req.onLog);
            ultimaFalhaFerramenta = '';
            falhasSeguidasFerramenta = 0;
            const pedido = String(args.caminho ?? args.pasta ?? '');
            const nomeSeguro = /^[A-Za-z0-9._/ -]{1,150}$/.test(pedido) && !pedido.includes('..') ? pedido : '[caminho não permitido]';
            req.onLog('[NVIDIA ferramenta] ' + nome + ': ' + nomeSeguro);
          } catch (e: any) {
            const mensagem = String(e?.message ?? e).slice(0, 500);
            resultado = JSON.stringify({ erro: mensagem, orientacao: 'Use caminhos relativos aos arquivos do projeto. Se arquivo .js não existir, confira a versão .ts; use listar_arquivos. Não repita chamada idêntica sem corrigir o parâmetro.' });
            req.onLog('[NVIDIA ferramenta] ' + nome + ': ' + resultado.slice(0, 300), 'WARN');
            const assinatura = createHash('sha256')
              .update(nome + ':' + String(call?.function?.arguments ?? '') + ':' + mensagem).digest('hex');
            falhasSeguidasFerramenta = ultimaFalhaFerramenta === assinatura ? falhasSeguidasFerramenta + 1 : 1;
            ultimaFalhaFerramenta = assinatura;
            if (falhasSeguidasFerramenta >= 4) {
              const aviso = 'Agente NVIDIA repetiu 4 vezes a mesma chamada de ferramenta inválida sem corrigir a causa. Sessão encerrada para evitar desperdício de limite; os arquivos do trabalho foram preservados.';
              req.onLog('[NVIDIA] ' + aviso, 'WARN');
              return { exitCode: 1, output: '', error: aviso, numTurns: volta + 1,
                inputTokens: entrada, outputTokens: saida };
            }
          }
          messages.push({ role: 'tool', tool_call_id: String(call.id), content: resultado.slice(0, MAX_TOOL_OUTPUT) });
        }
        if (calls.length > 12) throw new Error('Modelo enviou comandos demais em uma única resposta (máximo 12)');
      }
      req.onLog('NVIDIA: limite de turnos desta sessão; o Nivoo pode continuar com o checkpoint', 'WARN');
      return { exitCode: 0, output: 'Sessão NVIDIA chegou ao limite de ' + turnos + ' interações.',
        sessionEnded: true, numTurns: turnos, inputTokens: entrada, outputTokens: saida, stopReason: 'max_turns' };
    } catch (e: any) {
      if (req.signal.aborted) return { exitCode: -1, output: '', interrupted: true, error: 'interrompido' };
      const erro = erroSemChave(String(e?.message ?? e), this.chave() ?? '');
      req.onLog('[NVIDIA erro] ' + erro, 'WARN');
      return { exitCode: 1, output: '', error: erro, resourceUnavailable: looksLikeResourceProblem(erro) || /HTTP (401|402|403|429|500|502|503|504)|fetch failed|network error|timeout/i.test(erro),
        retryAfterMs: Number.isFinite(e?.retryAfterMs) ? Math.max(0, Number(e.retryAfterMs)) : undefined,
        inputTokens: entrada, outputTokens: saida };
    }
  }
}
