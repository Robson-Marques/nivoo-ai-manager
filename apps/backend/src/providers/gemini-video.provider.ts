import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ehAdicional, listarConexoes } from '../accounts/connections';
import { segredoDaConexao } from '../accounts/secrets';
import { resolveInside } from '../common/path-guard';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

/**
 * Vídeo com o Veo, do Google, pela API do Gemini (chave de API — cobrança por uso, separada da
 * assinatura). É uma etapa executada pelo SISTEMA, não por uma IA de texto: a descrição do vídeo vem
 * do plano aprovado; o sistema pede o vídeo, acompanha a geração, baixa o .mp4 para a pasta do projeto
 * e registra o custo estimado.
 *
 * REST (o mesmo que a biblioteca oficial @google/genai usa):
 *   POST {base}/v1beta/models/{modelo}:predictLongRunning  { instances:[{prompt, image?}], parameters:{...} }
 *   GET  {base}/v1beta/{operação}  → done, error, response.generateVideoResponse.generatedSamples[].video
 *   vídeo: video.uri (…/files/{id}:download?alt=media, com a chave) ou video.encodedVideo (base64)
 */
export interface OpcoesVideo {
  model?: string;
  arquivo?: string;
  duracaoSeg?: number;
  proporcao?: string;
  resolucao?: string;
  negativo?: string;
  imagem?: string;
  conexao?: string;
}

export interface ModeloVeo {
  id: string;
  nome: string;
}

const MIME_IMAGEM: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const CACHE_MS = 60 * 60 * 1000;

function base(): string {
  return (process.env.NIVOO_GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
}

/** Custo ESTIMADO por segundo de vídeo (US$). Ajustável; confira a tabela de preços do Google. */
export function precoPorSegundo(modelo: string): number {
  const rapido = /fast|lite/i.test(modelo);
  const env = rapido ? process.env.NIVOO_VEO_USD_POR_SEGUNDO_RAPIDO : process.env.NIVOO_VEO_USD_POR_SEGUNDO;
  return Number(env ?? (rapido ? 0.15 : 0.4));
}

/** Modelos Veo da API do Gemini, com nome claro. A lista da própria chave manda; esta vale se ela falhar. */
export const MODELOS_VEO_CONHECIDOS: ModeloVeo[] = [
  { id: 'veo-3.1-generate-preview', nome: 'Veo 3.1 — melhor qualidade, com som' },
  { id: 'veo-3.1-fast-generate-preview', nome: 'Veo 3.1 Fast — mais rápido e barato, com som' },
  { id: 'veo-3.0-generate-001', nome: 'Veo 3 — com som' },
  { id: 'veo-3.0-fast-generate-001', nome: 'Veo 3 Fast — mais barato, com som' },
  { id: 'veo-2.0-generate-001', nome: 'Veo 2 — sem som' },
];

/** Ordem do "automático" quando a lista da chave não traz o Veo: do mais barato ao mais caro. */
const ORDEM_AUTOMATICA = ['veo-3.1-fast-generate-preview', 'veo-3.0-fast-generate-001', 'veo-3.1-generate-preview', 'veo-3.0-generate-001', 'veo-2.0-generate-001'];

/** Nome para a tela: o conhecido (ou o do Google) + o custo estimado por segundo. */
export function nomeDoModeloVeo(id: string, nomeDoGoogle?: string): string {
  const base = MODELOS_VEO_CONHECIDOS.find((m) => m.id === id)?.nome ?? nomeDoGoogle ?? id;
  return `${base} (~US$ ${precoPorSegundo(id).toFixed(2).replace('.', ',')}/s)`;
}

/** Versão do modelo para ordenar: veo-3.1-… > veo-3.0-… > veo-2.0-… */
function versao(id: string): number {
  const m = /veo-(\d+)(?:\.(\d+))?/.exec(id);
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
}

/** Gerações pedidas e ainda não baixadas (pedido → operação do Google), para retomar sem pagar de novo. */
const OPERACOES = new Map<string, { nome: string; em: number }>();

@Injectable()
export class GeminiVideoProvider implements AiProvider {
  readonly id = 'gemini-video';
  readonly label = 'Vídeo (Gemini Veo)';
  readonly kind = 'executor' as const;
  private cache: { chave: string; at: number; modelos: ModeloVeo[] } | null = null;

  /** Chave da conexão indicada, ou da primeira conexão "Gemini — chave de API" com chave salva (padrão primeiro). */
  chave(conexao?: string): { conexao: string; chave: string } | null {
    const lista = listarConexoes()
      .filter((c) => c.tipo === 'gemini-api')
      .sort((a, b) => Number(b.padrao) - Number(a.padrao));
    const candidatas = conexao ? lista.filter((c) => c.id === conexao) : lista;
    if (!candidatas.length && !conexao) candidatas.push({ id: 'gemini-api' } as never); // chave do administrador
    for (const c of candidatas) {
      const k = segredoDaConexao(ehAdicional(c.id) ? c.id : null, 'GEMINI_API_KEY');
      if (k) return { conexao: c.id, chave: k };
    }
    return null;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const k = this.chave();
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: !!k,
      installed: true,
      authenticated: !!k,
      limits: { observacao: 'cobrança por segundo de vídeo pela API do Gemini (estimativa no custo do trabalho)' },
      capabilities: ['gerar-video'],
      errors: k ? [] : ['sem conexão "Gemini — chave de API" com chave salva (crie em Conexões)'],
      checkedAt: new Date().toISOString(),
      isAi: false,
    };
  }

  private async chamar(chave: string, metodo: 'GET' | 'POST', url: string, corpo?: unknown, signal?: AbortSignal): Promise<{ status: number; json: any }> {
    const res = await fetch(url, {
      method: metodo,
      headers: { 'x-goog-api-key': chave, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  /** Modelos Veo que ESTA chave pode usar (lista do próprio Google; os mais novos primeiro). */
  async modelos(conexao?: string): Promise<ModeloVeo[]> {
    const k = this.chave(conexao);
    if (!k) throw new Error('Crie em Conexões uma conexão "Gemini — chave de API" para listar os modelos de vídeo');
    if (this.cache && this.cache.chave === k.chave && Date.now() - this.cache.at < CACHE_MS) return this.cache.modelos;
    const todos: any[] = [];
    let pagina = '';
    for (let i = 0; i < 10; i++) {
      const r = await this.chamar(k.chave, 'GET', `${base()}/v1beta/models?pageSize=1000${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`);
      if (r.status !== 200) throw new Error(`O Google respondeu ${r.status}: ${JSON.stringify(r.json?.error?.message ?? r.json).slice(0, 200)}`);
      todos.push(...(r.json.models ?? []));
      pagina = r.json.nextPageToken ?? '';
      if (!pagina) break;
    }
    const modelos = todos
      .filter((m) => String(m.name ?? '').startsWith('models/veo') && (m.supportedGenerationMethods ?? ['predictLongRunning']).includes('predictLongRunning'))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), nome: String(m.displayName ?? m.name).trim() }))
      .sort((a, b) => versao(b.id) - versao(a.id) || Number(/fast|lite/.test(a.id)) - Number(/fast|lite/.test(b.id)) || a.id.localeCompare(b.id));
    this.cache = { chave: k.chave, at: Date.now(), modelos };
    return modelos;
  }

  /**
   * Lista para escolher na tela: os modelos que a chave pode usar, com nome claro e preço. Se o Google não
   * responder (ou a chave ainda não existir), os modelos conhecidos, com o motivo — a escolha nunca fica vazia.
   */
  async modelosParaEscolher(conexao?: string): Promise<{ opcoes: ModeloVeo[]; aviso?: string }> {
    try {
      const daChave = await this.modelos(conexao);
      if (daChave.length) return { opcoes: daChave.map((m) => ({ id: m.id, nome: nomeDoModeloVeo(m.id, m.nome) })) };
      return {
        opcoes: MODELOS_VEO_CONHECIDOS.map((m) => ({ id: m.id, nome: nomeDoModeloVeo(m.id) })),
        aviso: 'A sua chave do Gemini não lista nenhum modelo Veo (o vídeo pode exigir faturamento ativo no Google AI Studio). Mostrando os modelos conhecidos.',
      };
    } catch (e: any) {
      return { opcoes: MODELOS_VEO_CONHECIDOS.map((m) => ({ id: m.id, nome: nomeDoModeloVeo(m.id) })), aviso: `Não consegui ler a lista do Google (${String(e?.message ?? e).slice(0, 200)}). Mostrando os modelos conhecidos.` };
    }
  }

  /** Custo estimado da etapa (para o limite de gasto, ANTES de gerar). */
  estimarCusto(o: OpcoesVideo): number {
    return precoPorSegundo(o.model ?? '') * (Number(o.duracaoSeg) || 8);
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const o = (req.options ?? {}) as OpcoesVideo;
    const k = this.chave(o.conexao);
    if (!k) return { exitCode: 1, output: '', error: 'sem conexão "Gemini — chave de API" com chave salva: crie em Conexões', resourceUnavailable: true };
    const arquivo = String(o.arquivo ?? 'videos/video.mp4');
    let destino: string;
    try {
      destino = resolveInside(req.cwd, arquivo);
    } catch {
      return { exitCode: 1, output: '', error: `caminho inválido para o vídeo: ${arquivo}` };
    }
    // Modelo escolhido no projeto; em "automático", os da lista da chave e, se a lista do Google não trouxer
    // nenhum Veo (acontece mesmo com cobrança ativa), os conhecidos, do mais barato ao mais caro.
    let candidatos: string[];
    if (o.model) candidatos = [o.model];
    else {
      const daChave = await this.modelos(k.conexao).catch(() => [] as ModeloVeo[]);
      candidatos = daChave.length ? daChave.map((m) => m.id) : ORDEM_AUTOMATICA;
    }
    let modelo = candidatos[0];

    const instancia: Record<string, unknown> = { prompt: req.instructions };
    if (o.imagem) {
      try {
        const img = resolveInside(req.cwd, o.imagem);
        instancia.image = { bytesBase64Encoded: fs.readFileSync(img).toString('base64'), mimeType: MIME_IMAGEM[path.extname(img).toLowerCase()] ?? 'image/png' };
      } catch {
        return { exitCode: 1, output: '', error: `imagem inicial não encontrada no projeto: ${o.imagem}` };
      }
    }
    const parameters: Record<string, unknown> = { sampleCount: 1 };
    if (o.duracaoSeg) parameters.durationSeconds = Number(o.duracaoSeg);
    if (o.proporcao) parameters.aspectRatio = o.proporcao;
    if (o.resolucao) parameters.resolution = o.resolucao;
    if (o.negativo) parameters.negativePrompt = o.negativo;

    const segundos = Number(parameters.durationSeconds ?? 8);
    // Mesmo pedido já aceito pelo Google numa tentativa anterior (a etapa caiu no meio): acompanha a mesma
    // geração em vez de pagar outra.
    const pedido = createHash('sha256').update(JSON.stringify([k.conexao, o.model ?? 'automatico', destino, instancia, parameters])).digest('hex');
    const anterior = OPERACOES.get(pedido);
    let operacao: string;
    let op: any;
    // Custo da geração: cobrado na tentativa que fez o pedido, mesmo se ela falhar depois.
    let custo = 0;
    if (anterior && Date.now() - anterior.em < 24 * 3_600_000) {
      operacao = anterior.nome;
      op = { done: false };
      req.onLog(`Veo: retomando a geração já pedida (operação ${operacao}); nada é cobrado de novo`);
    } else {
      let r: { status: number; json: any } | null = null;
      const recusados: string[] = [];
      for (const m of candidatos) {
        modelo = m;
        req.onLog(`Veo: pedindo o vídeo ao Google (modelo ${modelo}, ${parameters.durationSeconds ?? 'duração padrão'} s, ${parameters.aspectRatio ?? 'proporção padrão'}), conexão ${k.conexao}`);
        try {
          r = await this.chamar(k.chave, 'POST', `${base()}/v1beta/models/${encodeURIComponent(modelo)}:predictLongRunning`, { instances: [instancia], parameters }, req.signal);
        } catch (e: any) {
          return { exitCode: 1, output: '', error: `não foi possível falar com o Google: ${e?.cause?.code ?? e?.message}`, resourceUnavailable: true, interrupted: req.signal.aborted };
        }
        // Modelo que esta chave não tem (404 / não encontrado / não suportado): tenta o próximo.
        const msg = String(r.json?.error?.message ?? '');
        if (r.status === 404 || (r.status === 400 && /not found|not supported|is not available|does not exist/i.test(msg))) {
          recusados.push(`${modelo} (${r.status})`);
          req.onLog(`Veo: o modelo ${modelo} não está disponível para esta chave; tentando o próximo`, 'WARN');
          continue;
        }
        break;
      }
      if (!r || recusados.length === candidatos.length) {
        return { exitCode: 1, output: '', error: `nenhum modelo Veo aceitou o pedido com esta chave (${recusados.join(', ')}). Confira no Google AI Studio se a cobrança está ativa no projeto DESTA chave e se o Veo está liberado na sua região.` };
      }
      const falha = this.falhaHttp(r);
      if (falha) return falha;
      operacao = String(r.json.name ?? '');
      if (!operacao) return { exitCode: 1, output: '', error: `resposta inesperada do Google: ${JSON.stringify(r.json).slice(0, 300)}` };
      OPERACOES.set(pedido, { nome: operacao, em: Date.now() });
      custo = precoPorSegundo(modelo) * segundos;
      op = r.json;
      req.onLog(`Veo: gerando (operação ${operacao}); costuma levar de 1 a 6 minutos`);
    }
    const cobrado = { costUsd: custo, costEstimated: true };

    // Acompanha a geração até terminar (ou até o tempo da etapa / interrupção).
    const fim = Date.now() + req.timeoutMs;
    const intervalo = Number(process.env.NIVOO_VEO_INTERVALO_MS ?? 10_000);
    while (!op.done) {
      if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true, ...cobrado };
      if (Date.now() > fim) return { exitCode: 1, output: '', error: `o Google não terminou o vídeo dentro do tempo da etapa (operação ${operacao}); a próxima tentativa continua a mesma geração`, ...cobrado };
      await new Promise((ok) => setTimeout(ok, intervalo));
      try {
        const p = await this.chamar(k.chave, 'GET', `${base()}/v1beta/${operacao}`, undefined, req.signal);
        if (p.status === 429 || p.status >= 500) {
          req.onLog(`Veo: o Google respondeu ${p.status} ao consultar o andamento; tentando de novo`, 'WARN');
          continue; // passageiro: a geração continua lá
        }
        const f = this.falhaHttp(p);
        if (f) {
          OPERACOES.delete(pedido);
          return { ...f, ...cobrado };
        }
        op = p.json;
      } catch (e: any) {
        if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true, ...cobrado };
        req.onLog(`Veo: falha ao consultar o andamento (${e?.message}); tentando de novo`, 'WARN');
      }
    }
    if (op.error || !(op.response?.generateVideoResponse?.generatedSamples ?? [])[0]?.video) OPERACOES.delete(pedido); // terminou sem vídeo: um novo pedido é outra geração
    if (op.error) return { exitCode: 1, output: '', error: `o Google não gerou o vídeo: ${op.error.message ?? JSON.stringify(op.error)}`, ...cobrado };
    const resp = op.response?.generateVideoResponse ?? {};
    const amostra = (resp.generatedSamples ?? [])[0]?.video;
    if (!amostra) {
      const motivos = (resp.raiMediaFilteredReasons ?? []).join('; ');
      return { exitCode: 1, output: '', error: `o Google recusou gerar este vídeo pelas regras de segurança dele${motivos ? `: ${motivos}` : ''}. Ajuste a descrição e tente de novo.`, ...cobrado };
    }
    let bytes: Buffer;
    try {
      if (amostra.encodedVideo) bytes = Buffer.from(amostra.encodedVideo, 'base64');
      else {
        const res = await fetch(String(amostra.uri), { headers: { 'x-goog-api-key': k.chave }, signal: AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]) });
        if (!res.ok) return { exitCode: 1, output: '', error: `não foi possível baixar o vídeo (${res.status}); a próxima tentativa baixa de novo, sem gerar outro`, ...cobrado };
        bytes = Buffer.from(await res.arrayBuffer());
      }
    } catch (e: any) {
      return { exitCode: 1, output: '', error: `não foi possível baixar o vídeo: ${e?.message}; a próxima tentativa baixa de novo, sem gerar outro`, interrupted: req.signal.aborted, ...cobrado };
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, bytes);
    OPERACOES.delete(pedido);
    req.onLog(`Veo: vídeo salvo em ${arquivo} (${(bytes.length / 1024 / 1024).toFixed(1)} MB); custo estimado US$ ${custo.toFixed(2)}${anterior ? ' (já contado na tentativa anterior)' : ''}`);
    return {
      exitCode: 0,
      output: `Vídeo gerado: ${arquivo} (${segundos} s, modelo ${modelo}, ${(bytes.length / 1024 / 1024).toFixed(1)} MB)`,
      costUsd: custo,
      costEstimated: true,
      sessionId: operacao,
      stopReason: 'completed',
    };
  }

  /** Erro HTTP do Google em resultado da etapa: chave recusada / limite = recurso indisponível. */
  private falhaHttp(r: { status: number; json: any }): ExecutionResult | null {
    if (r.status >= 200 && r.status < 300) return null;
    const msg = String(r.json?.error?.message ?? JSON.stringify(r.json)).slice(0, 400);
    if (r.status === 401 || r.status === 403 || /api key not valid|API_KEY_INVALID/i.test(msg)) return { exitCode: 1, output: '', error: `o Google recusou a chave (${r.status}): ${msg}`, resourceUnavailable: true };
    if (r.status === 429) return { exitCode: 1, output: '', error: `limite de uso do Google atingido (429): ${msg}`, resourceUnavailable: true };
    if (r.status >= 500) return { exitCode: 1, output: '', error: `o Google está com problema (${r.status}): ${msg}`, resourceUnavailable: true };
    return { exitCode: 1, output: '', error: `o Google recusou o pedido (${r.status}): ${msg}` };
  }
}
