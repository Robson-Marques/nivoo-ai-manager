import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { segredoDaConexao } from '../accounts/secrets';
import { caminhoDoProjeto, resolveInside } from '../common/path-guard';
import { AiProvider, buildPrompt, ExecutionRequest, ExecutionResult, looksLikeResourceProblem, ProviderStatus } from './provider.interface';
import { modeloNvidiaServeComoAgente } from './nvidia-model-catalog';

/** NVIDIA Build: APIs hospedadas de avaliação (não requer GPU no servidor Nivoo). */
export const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';
const DEFAULT_TURNS = 24;
const MAX_TURNS = 40;
const MAX_FILE_BYTES = 320_000;
const MAX_READ_BYTES = 1_000_000;
const MAX_TOOL_OUTPUT = 24_000;

type ChatMessage = { role: string; content: unknown; tool_calls?: any[]; tool_call_id?: string };
type NvidiaResponse = { choices?: Array<{ message?: { content?: unknown; tool_calls?: any[] }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export const NVIDIA_TOOLS: Array<Record<string, unknown>> = [
  { type: 'function', function: {
    name: 'listar_arquivos', description: 'Liste arquivos do diretório do trabalho. Não acessa caminhos externos.',
    parameters: { type: 'object', properties: { pasta: { type: 'string', description: 'Pasta relativa, ou "."' } }, required: ['pasta'] },
  } },
  { type: 'function', function: {
    name: 'ler_arquivo', description: 'Leia um arquivo de texto relativo ao trabalho, para entender o código antes de modificá-lo.',
    parameters: { type: 'object', properties: { caminho: { type: 'string' }, inicio: { type: 'integer', description: 'Posição inicial em caracteres (padrão 0)' }, limite: { type: 'integer', description: 'Máximo de caracteres (padrão 18000)' } }, required: ['caminho'] },
  } },
  { type: 'function', function: {
    name: 'escrever_arquivo', description: 'Crie ou substitua um arquivo de texto do trabalho, sem acessar diretórios protegidos.',
    parameters: { type: 'object', properties: { caminho: { type: 'string' }, conteudo: { type: 'string' } }, required: ['caminho', 'conteudo'] },
  } },
  { type: 'function', function: {
    name: 'substituir_texto', description: 'Troque UMA ocorrência exata de texto em um arquivo já lido. Não permite substituição ambígua.',
    parameters: { type: 'object', properties: { caminho: { type: 'string' }, antes: { type: 'string' }, depois: { type: 'string' } }, required: ['caminho', 'antes', 'depois'] },
  } },
];

/** Não enviar arquivos secretos do servidor nem entregar à IA acesso a comandos do host. */
function caminhoSeguro(cwd: string, relativo: unknown): string {
  const nome = String(relativo ?? '').trim().replace(/\\/g, '/');
  if (nome === '.' || !nome) return resolveInside(cwd, '.');
  const nomeValido = caminhoDoProjeto(nome);
  if (!nomeValido || nomeValido.split('/').some((p) =>
    /^(node_modules|\.env(?:\..*)?|\.git|\.nivoo|contexto|segredos\.json|conexoes\.json)$/i.test(p))) {
    throw new Error('Caminho proibido, externo ou inválido');
  }
  return resolveInside(cwd, nomeValido);
}

function textoDaResposta(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
  return '';
}

function erroSemChave(texto: string, chave: string): string {
  const limpo = chave ? texto.split(chave).join('[chave ocultada]') : texto;
  return limpo.replace(/nvapi-[A-Za-z0-9_-]+/g, '[chave ocultada]').slice(0, 900);
}

/** Apenas leitura/escrita de arquivos do worktree; o verificador do Nivoo executa os testes depois. */
export function executarFerramentaNvidia(cwd: string, name: string, args: Record<string, unknown>): string {
  const caminho = caminhoSeguro(cwd, args.caminho ?? args.pasta ?? '.');
  if (name === 'listar_arquivos') {
    const arquivos: string[] = [];
    const listar = (pasta: string, nivel: number) => {
      if (nivel > 3 || arquivos.length >= 150) return;
      for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
        if (arquivos.length >= 150) break;
        if (e.isSymbolicLink() || /^(node_modules|\.git|\.nivoo|contexto|\.env(?:\..*)?)$/i.test(e.name)) continue;
        const arquivo = path.join(pasta, e.name);
        const relativo = path.relative(cwd, arquivo);
        if (e.isDirectory()) {
          arquivos.push(relativo + '/');
          listar(arquivo, nivel + 1);
        } else if (e.isFile()) arquivos.push(relativo);
      }
    };
    if (!fs.statSync(caminho).isDirectory()) throw new Error('Não é uma pasta');
    listar(caminho, 0);
    return JSON.stringify({ arquivos });
  }
  if (name === 'ler_arquivo') {
    const stat = fs.statSync(caminho);
    if (!stat.isFile() || stat.size > MAX_READ_BYTES) throw new Error('Arquivo não é texto ou é muito grande (limite 1 MB)');
    const buffer = fs.readFileSync(caminho);
    if (buffer.includes(0)) throw new Error('Arquivo binário; somente texto é permitido');
    const conteudo = buffer.toString('utf8');
    const inicio = Math.max(0, Math.min(conteudo.length, Number(args.inicio) || 0));
    const limite = Math.max(1, Math.min(18000, Number(args.limite) || 18000));
    return JSON.stringify({ caminho: args.caminho, inicio, total: conteudo.length,
      conteudo: conteudo.slice(inicio, inicio + limite), temMais: inicio + limite < conteudo.length });
  }
  if (name === 'escrever_arquivo' || name === 'substituir_texto') {
    if (typeof args.caminho !== 'string' || args.caminho.trim() === '') throw new Error('Informe o arquivo relativo');
    if (caminho === fs.realpathSync(cwd)) throw new Error('Não é um arquivo');
    let conteudo: string;
    if (name === 'substituir_texto') {
      if (typeof args.antes !== 'string' || !args.antes || typeof args.depois !== 'string') throw new Error('Texto de substituição inválido');
      const stat = fs.statSync(caminho);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Arquivo inválido ou grande demais');
      const atual = fs.readFileSync(caminho, 'utf8');
      const primeira = atual.indexOf(args.antes);
      if (primeira < 0) throw new Error('Texto original não encontrado; leia o arquivo novamente');
      if (atual.indexOf(args.antes, primeira + args.antes.length) >= 0) throw new Error('Texto ocorre mais de uma vez; use trecho mais específico');
      conteudo = atual.slice(0, primeira) + args.depois + atual.slice(primeira + args.antes.length);
    } else {
      if (typeof args.conteudo !== 'string') throw new Error('Conteúdo inválido');
      conteudo = args.conteudo;
    }
    if (Buffer.byteLength(conteudo) > MAX_FILE_BYTES) throw new Error('Arquivo muito grande (limite 320 KB)');
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    // Nunca seguir symlink criado entre validação e a gravação.
    const real = resolveInside(cwd, path.relative(cwd, caminho));
    if (real !== caminho) throw new Error('Arquivo mudou durante a operação');
    fs.writeFileSync(real, conteudo, { encoding: 'utf8', flag: 'w' });
    return JSON.stringify({ ok: true, caminho: args.caminho, caracteres: conteudo.length });
  }
  throw new Error('Ferramenta não autorizada: ' + name);
}

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
    try {
      await this.pedir('/models', null, 7_000);
      base.available = true;
      base.version = 'NVIDIA Build API';
    } catch (e: any) {
      base.errors.push(erroSemChave(String(e?.message ?? e), this.chave() ?? ''));
      if (/HTTP 401|HTTP 403/.test(base.errors[0])) base.authenticated = false;
    }
    return base;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
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
        'Use as ferramentas de arquivo para ler e modificar o projeto. Sem terminal, sem rede ou acesso a segredos.',
        'Leia antes de alterar. Preserve as mudanças existentes e registre de forma clara o que fez.',
        'As verificações e builds são responsabilidade do executor Nivoo, após sua sessão.',
        'Não invente resultado, arquivo criado, teste executado ou imagem que não tenha sido gravado.',
        'Quando faltar evidência, indique o impedimento sem marcar como aprovado.',
      ].join('\n') },
      { role: 'user', content: buildPrompt(req) },
    ];
    let entrada = 0, saida = 0, alteracoes = 0;
    const inicio = Date.now();
    req.onLog('NVIDIA NIM: modelo ' + model + ' (ferramentas seguras de arquivo, sem terminal)');
    try {
      for (let volta = 0; volta < turnos; volta++) {
        if (req.signal.aborted) return { exitCode: -1, output: '', interrupted: true, error: 'interrompido' };
        const restante = req.timeoutMs - (Date.now() - inicio);
        if (restante <= 0) return { exitCode: 1, output: '', error: 'tempo da sessão NVIDIA esgotado', sessionEnded: true, numTurns: volta };
        const json: NvidiaResponse = await this.pedir('/chat/completions', {
          model, messages, tools: NVIDIA_TOOLS, tool_choice: 'auto', stream: false,
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
          return { exitCode: 0, output: texto || 'Alterações concluídas: ' + alteracoes + ' arquivo(s).',
            inputTokens: entrada, outputTokens: saida, numTurns: volta + 1, stopReason: json.choices?.[0]?.finish_reason ?? 'completed' };
        }
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
        for (const call of calls.slice(0, 12)) {
          const nome = String(call?.function?.name ?? '');
          let resultado = '';
          try {
            const args = JSON.parse(String(call?.function?.arguments ?? '{}'));
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos');
            resultado = executarFerramentaNvidia(req.cwd, nome, args);
            if (nome === 'escrever_arquivo' || nome === 'substituir_texto') alteracoes++;
            req.onLog('[NVIDIA ferramenta] ' + nome + ': ' + String(args.caminho ?? args.pasta ?? '').slice(0, 150));
          } catch (e: any) {
            resultado = JSON.stringify({ erro: String(e?.message ?? e).slice(0, 700) });
            req.onLog('[NVIDIA ferramenta] ' + nome + ': ' + resultado.slice(0, 300), 'WARN');
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
        inputTokens: entrada, outputTokens: saida };
    }
  }
}
