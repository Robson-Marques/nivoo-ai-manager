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

/** Versão do modelo para ordenar: veo-3.1-… > veo-3.0-… > veo-2.0-… */
function versao(id: string): number {
  const m = /veo-(\d+)(?:\.(\d+))?/.exec(id);
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
}

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
    let modelo = o.model;
    try {
      if (!modelo) modelo = (await this.modelos(k.conexao))[0]?.id;
    } catch (e: any) {
      return { exitCode: 1, output: '', error: String(e?.message ?? e), resourceUnavailable: true };
    }
    if (!modelo) return { exitCode: 1, output: '', error: 'esta chave não tem nenhum modelo Veo disponível (confira se a cobrança está ativada no Google AI Studio)' };

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

    req.onLog(`Veo: pedindo o vídeo ao Google (modelo ${modelo}, ${parameters.durationSeconds ?? 'duração padrão'} s, ${parameters.aspectRatio ?? 'proporção padrão'}), conexão ${k.conexao}`);
    let r: { status: number; json: any };
    try {
      r = await this.chamar(k.chave, 'POST', `${base()}/v1beta/models/${encodeURIComponent(modelo)}:predictLongRunning`, { instances: [instancia], parameters }, req.signal);
    } catch (e: any) {
      return { exitCode: 1, output: '', error: `não foi possível falar com o Google: ${e?.cause?.code ?? e?.message}`, resourceUnavailable: true, interrupted: req.signal.aborted };
    }
    const falha = this.falhaHttp(r);
    if (falha) return falha;
    const operacao = String(r.json.name ?? '');
    if (!operacao) return { exitCode: 1, output: '', error: `resposta inesperada do Google: ${JSON.stringify(r.json).slice(0, 300)}` };
    req.onLog(`Veo: gerando (operação ${operacao}); costuma levar de 1 a 6 minutos`);

    // Acompanha a geração até terminar (ou até o tempo da etapa / interrupção).
    const fim = Date.now() + req.timeoutMs;
    const intervalo = Number(process.env.NIVOO_VEO_INTERVALO_MS ?? 10_000);
    let op = r.json;
    while (!op.done) {
      if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
      if (Date.now() > fim) return { exitCode: 1, output: '', error: `o Google não terminou o vídeo dentro do tempo da etapa (operação ${operacao})` };
      await new Promise((ok) => setTimeout(ok, intervalo));
      try {
        const p = await this.chamar(k.chave, 'GET', `${base()}/v1beta/${operacao}`, undefined, req.signal);
        const f = this.falhaHttp(p);
        if (f) return f;
        op = p.json;
      } catch (e: any) {
        if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
        req.onLog(`Veo: falha ao consultar o andamento (${e?.message}); tentando de novo`, 'WARN');
      }
    }
    if (op.error) return { exitCode: 1, output: '', error: `o Google não gerou o vídeo: ${op.error.message ?? JSON.stringify(op.error)}` };
    const resp = op.response?.generateVideoResponse ?? {};
    const amostra = (resp.generatedSamples ?? [])[0]?.video;
    if (!amostra) {
      const motivos = (resp.raiMediaFilteredReasons ?? []).join('; ');
      return { exitCode: 1, output: '', error: `o Google recusou gerar este vídeo pelas regras de segurança dele${motivos ? `: ${motivos}` : ''}. Ajuste a descrição e tente de novo.` };
    }
    let bytes: Buffer;
    try {
      if (amostra.encodedVideo) bytes = Buffer.from(amostra.encodedVideo, 'base64');
      else {
        const res = await fetch(String(amostra.uri), { headers: { 'x-goog-api-key': k.chave }, signal: AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]) });
        if (!res.ok) return { exitCode: 1, output: '', error: `não foi possível baixar o vídeo (${res.status})` };
        bytes = Buffer.from(await res.arrayBuffer());
      }
    } catch (e: any) {
      return { exitCode: 1, output: '', error: `não foi possível baixar o vídeo: ${e?.message}`, interrupted: req.signal.aborted };
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, bytes);
    const segundos = Number(parameters.durationSeconds ?? 8);
    const custo = precoPorSegundo(modelo) * segundos;
    req.onLog(`Veo: vídeo salvo em ${arquivo} (${(bytes.length / 1024 / 1024).toFixed(1)} MB); custo estimado US$ ${custo.toFixed(2)}`);
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
