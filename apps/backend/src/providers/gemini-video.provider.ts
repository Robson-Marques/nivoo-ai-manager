import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ehAdicional, listarConexoes } from '../accounts/connections';
import { segredoDaConexao } from '../accounts/secrets';
import { resolveInside } from '../common/path-guard';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

/**
 * Vídeo do Google pela API do Gemini (chave de API — cobrança por uso, separada da assinatura): Gemini Omni
 * Flash (o atual; o Google desligou o Veo da API do Gemini; o 3.1 "preview" em 22/10/2026). O caminho do Veo
 * (predictLongRunning) fica para um modelo Veo que a própria chave ainda liste. É uma etapa executada pelo SISTEMA, não por uma IA de texto: a descrição do vídeo vem
 * do plano aprovado; o sistema pede o vídeo, acompanha a geração, baixa o .mp4 para a pasta do projeto
 * e registra o custo estimado.
 *
 * Gemini Omni (Interactions):
 *   POST {base}/v1beta/interactions  { model, input:[{type:'image',data,mime_type}?, {type:'text',text}],
 *        response_format:{type:'video', delivery:'uri', aspect_ratio?, resolution?, duration?:'8s'}, background:true }
 *   GET  {base}/v1beta/interactions/{id} → status in_progress | completed | failed | cancelled;
 *        vídeo em steps[].content[] {type:'video', uri | data(base64)}
 * Veo (o mesmo que a biblioteca oficial @google/genai usa):
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
  /** Vídeo com trilha única na montagem: a cena vem sem música própria (só falas e sons do ambiente). */
  semMusica?: boolean;
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
  if (/omni/i.test(modelo)) return Number(process.env.NIVOO_OMNI_USD_POR_SEGUNDO ?? 0.1);
  const rapido = /fast|lite/i.test(modelo);
  const env = rapido ? process.env.NIVOO_VEO_USD_POR_SEGUNDO_RAPIDO : process.env.NIVOO_VEO_USD_POR_SEGUNDO;
  return Number(env ?? (rapido ? 0.15 : 0.4));
}

/**
 * Modelos de vídeo da API do Gemini, com nome claro. O Google desligou o Veo da API do Gemini (o 3.1 "preview"
 * em 22/10/2026; nas chaves testadas o 3 e o 2 também respondem 404): o atual é o Gemini Omni Flash.
 */
export const MODELOS_VEO_CONHECIDOS: ModeloVeo[] = [
  { id: 'gemini-omni-1.2-flash', nome: 'Gemini Omni 1.2 Flash — o atual do Google, com som (3 a 15 s)' },
  { id: 'gemini-omni-1.1-flash', nome: 'Gemini Omni 1.1 Flash — versão anterior, com som' },
];

/** Ordem do "automático": o mais novo primeiro. */
const ORDEM_AUTOMATICA = MODELOS_VEO_CONHECIDOS.map((m) => m.id);

/** Modelos desligados pelo Google (todo o Veo na API do Gemini): escolhidos antes, viram "automático". */
export const MODELO_DESLIGADO = /^veo-/;

const ehOmni = (m: string) => /omni/i.test(m);

/** Nome para a tela: o conhecido (ou o do Google) + o custo estimado por segundo. */
export function nomeDoModeloVeo(id: string, nomeDoGoogle?: string): string {
  const base = MODELOS_VEO_CONHECIDOS.find((m) => m.id === id)?.nome ?? nomeDoGoogle ?? id;
  return `${base} (~US$ ${precoPorSegundo(id).toFixed(2).replace('.', ',')}/s)`;
}

/** Versão do modelo para ordenar: veo-3.1-… > veo-3.0-… > veo-2.0-… */
function versao(id: string): number {
  const m = /(?:veo|omni)-(\d+)(?:\.(\d+))?/.exec(id);
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
}

/** Gerações pedidas e ainda não baixadas (pedido → operação do Google), para retomar sem pagar de novo. */
const OPERACOES = new Map<string, { nome: string; em: number; modelo: string }>();

@Injectable()
export class GeminiVideoProvider implements AiProvider {
  readonly id = 'gemini-video';
  readonly label = 'Vídeo (Google: Gemini Omni / Veo)';
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
      .filter((m) => /^models\/(veo|gemini-omni)/.test(String(m.name ?? '')) && !MODELO_DESLIGADO.test(String(m.name).replace(/^models\//, '')))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), nome: String(m.displayName ?? m.name).trim() }))
      .sort((a, b) => Number(ehOmni(b.id)) - Number(ehOmni(a.id)) || versao(b.id) - versao(a.id) || Number(/fast|lite/.test(a.id)) - Number(/fast|lite/.test(b.id)) || a.id.localeCompare(b.id));
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
        aviso: 'A lista do Google para a sua chave não traz modelos de vídeo; mostrando os conhecidos (o Gemini Omni Flash é o atual). Vídeo exige cobrança ativa no Google AI Studio.',
      };
    } catch (e: any) {
      return { opcoes: MODELOS_VEO_CONHECIDOS.map((m) => ({ id: m.id, nome: nomeDoModeloVeo(m.id) })), aviso: `Não consegui ler a lista do Google (${String(e?.message ?? e).slice(0, 200)}). Mostrando os modelos conhecidos.` };
    }
  }

  /** Custo estimado da etapa (para o limite de gasto, ANTES de gerar). */
  estimarCusto(o: OpcoesVideo): number {
    return precoPorSegundo(o.model && !MODELO_DESLIGADO.test(o.model) ? o.model : ORDEM_AUTOMATICA[0]) * (Number(o.duracaoSeg) || 8);
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
    // Modelo escolhido que a chave não tem (ou que o Google desligou) cai para os outros, avisando.
    const daChave = (await this.modelos(k.conexao).catch(() => [] as ModeloVeo[])).map((m) => m.id);
    const automatico = [...new Set([...daChave, ...ORDEM_AUTOMATICA])];
    const escolhido = o.model && !MODELO_DESLIGADO.test(o.model) ? o.model : undefined;
    if (o.model && !escolhido) req.onLog(`Vídeo: o modelo escolhido (${o.model}) foi desligado pelo Google; usando o automático`, 'WARN');
    const candidatos = escolhido ? [escolhido, ...automatico.filter((m) => m !== escolhido)] : automatico;
    let modelo = candidatos[0];

    const descricao = o.semMusica
      ? `${req.instructions}\n\nÁudio desta cena: SEM música de fundo e sem trilha sonora — só as falas/narração e os sons do ambiente (a música é colocada depois, única para o vídeo inteiro).`
      : req.instructions;
    const instancia: Record<string, unknown> = { prompt: descricao };
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
    const pedido = createHash('sha256').update(JSON.stringify([k.conexao, escolhido ?? 'automatico', destino, descricao, o.imagem ?? null, parameters])).digest('hex');
    const anterior = OPERACOES.get(pedido);
    let operacao: string;
    let op: any;
    // Custo da geração: cobrado na tentativa que fez o pedido, mesmo se ela falhar depois.
    let custo = 0;
    if (anterior && Date.now() - anterior.em < 24 * 3_600_000) {
      operacao = anterior.nome;
      modelo = anterior.modelo;
      op = { done: false };
      req.onLog(`Veo: retomando a geração já pedida (operação ${operacao}); nada é cobrado de novo`);
    } else {
      let r: { status: number; json: any } | null = null;
      const recusados: string[] = [];
      for (const m of candidatos) {
        modelo = m;
        req.onLog(`Veo: pedindo o vídeo ao Google (modelo ${modelo}, ${parameters.durationSeconds ?? 'duração padrão'} s, ${parameters.aspectRatio ?? 'proporção padrão'}), conexão ${k.conexao}`);
        try {
          r = ehOmni(modelo)
            ? await this.chamar(k.chave, 'POST', `${base()}/v1beta/interactions`, this.pedidoOmni(modelo, descricao, instancia, o), req.signal)
            : await this.chamar(k.chave, 'POST', `${base()}/v1beta/models/${encodeURIComponent(modelo)}:predictLongRunning`, { instances: [instancia], parameters }, req.signal);
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
        return { exitCode: 1, output: '', error: `nenhum modelo de vídeo aceitou o pedido com esta chave (${recusados.join(', ')}). Confira no Google AI Studio se a cobrança está ativa no projeto DESTA chave.` };
      }
      const falha = this.falhaHttp(r);
      if (falha) return falha;
      operacao = String((ehOmni(modelo) ? r.json.id : r.json.name) ?? '');
      if (!operacao) return { exitCode: 1, output: '', error: `resposta inesperada do Google: ${JSON.stringify(r.json).slice(0, 300)}` };
      OPERACOES.set(pedido, { nome: operacao, em: Date.now(), modelo });
      custo = precoPorSegundo(modelo) * segundos;
      op = ehOmni(modelo) ? { ...r.json, done: terminouOmni(r.json) } : r.json;
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
        const p = await this.chamar(k.chave, 'GET', ehOmni(modelo) ? `${base()}/v1beta/interactions/${encodeURIComponent(operacao)}` : `${base()}/v1beta/${operacao}`, undefined, req.signal);
        if (p.status === 429 || p.status >= 500) {
          req.onLog(`Veo: o Google respondeu ${p.status} ao consultar o andamento; tentando de novo`, 'WARN');
          continue; // passageiro: a geração continua lá
        }
        const f = this.falhaHttp(p);
        if (f) {
          OPERACOES.delete(pedido);
          return { ...f, ...cobrado };
        }
        op = ehOmni(modelo) ? { ...p.json, done: terminouOmni(p.json) } : p.json;
      } catch (e: any) {
        if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true, ...cobrado };
        req.onLog(`Veo: falha ao consultar o andamento (${e?.message}); tentando de novo`, 'WARN');
      }
    }
    let amostra: { data?: string; uri?: string } | null;
    if (ehOmni(modelo)) {
      if (op.status === 'failed' || op.status === 'cancelled') {
        OPERACOES.delete(pedido);
        return { exitCode: 1, output: '', error: `o Google não gerou o vídeo (${op.status}): ${op.error?.message ?? JSON.stringify(op.error ?? {}).slice(0, 300)}`, ...cobrado };
      }
      amostra = acharVideo(op);
      if (!amostra) {
        OPERACOES.delete(pedido);
        return { exitCode: 1, output: '', error: `o Google terminou sem devolver vídeo (pode ter recusado pelas regras de segurança dele). Ajuste a descrição e tente de novo. Resposta: ${JSON.stringify(op).slice(0, 300)}`, ...cobrado };
      }
    } else {
      if (op.error || !(op.response?.generateVideoResponse?.generatedSamples ?? [])[0]?.video) OPERACOES.delete(pedido); // terminou sem vídeo: um novo pedido é outra geração
      if (op.error) return { exitCode: 1, output: '', error: `o Google não gerou o vídeo: ${op.error.message ?? JSON.stringify(op.error)}`, ...cobrado };
      const resp = op.response?.generateVideoResponse ?? {};
      const v = (resp.generatedSamples ?? [])[0]?.video;
      if (!v) {
        const motivos = (resp.raiMediaFilteredReasons ?? []).join('; ');
        return { exitCode: 1, output: '', error: `o Google recusou gerar este vídeo pelas regras de segurança dele${motivos ? `: ${motivos}` : ''}. Ajuste a descrição e tente de novo.`, ...cobrado };
      }
      amostra = { data: v.encodedVideo, uri: v.uri };
    }
    let bytes: Buffer;
    try {
      if (amostra.data) bytes = Buffer.from(amostra.data, 'base64');
      else bytes = await this.baixar(String(amostra.uri), k.chave, req.signal);
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

  /** Pedido do Gemini Omni Flash (Interactions): a imagem (primeiro quadro) vai antes do texto. */
  private pedidoOmni(modelo: string, descricao: string, instancia: Record<string, unknown>, o: OpcoesVideo) {
    const img = instancia.image as { bytesBase64Encoded: string; mimeType: string } | undefined;
    const texto = o.negativo ? `${descricao}\n\nNão mostrar: ${o.negativo}` : descricao;
    const formato: Record<string, unknown> = { type: 'video', delivery: 'uri' };
    if (o.proporcao === '16:9' || o.proporcao === '9:16') formato.aspect_ratio = o.proporcao;
    if (o.resolucao) formato.resolution = String(o.resolucao).toLowerCase();
    const seg = Number(o.duracaoSeg);
    if (seg >= 3 && seg <= 15) formato.duration = `${seg}s`;
    return {
      model: modelo,
      input: [...(img ? [{ type: 'image', data: img.bytesBase64Encoded, mime_type: img.mimeType }] : []), { type: 'text', text: texto }],
      response_format: formato,
      background: true,
    };
  }

  /** Baixa o vídeo pelo endereço do Google (com a chave; se vier a ficha do arquivo, pede o conteúdo). */
  private async baixar(uri: string, chave: string, signal: AbortSignal): Promise<Buffer> {
    const pedir = (u: string) => fetch(u, { headers: { 'x-goog-api-key': chave }, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) });
    let res = await pedir(uri);
    if (res.ok && /json/i.test(res.headers.get('content-type') ?? '') && !/alt=media/.test(uri)) res = await pedir(`${uri}${uri.includes('?') ? '&' : '?'}alt=media`);
    if (!res.ok) throw new Error(`o Google respondeu ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Erro HTTP do Google em resultado da etapa: chave recusada / limite = recurso indisponível. */
  private falhaHttp(r: { status: number; json: any }): ExecutionResult | null {
    if (r.status >= 200 && r.status < 300) return null;
    const msg = String(r.json?.error?.message ?? JSON.stringify(r.json)).slice(0, 400);
    if (r.status === 401 || r.status === 403 || /api key not valid|API_KEY_INVALID/i.test(msg)) return { exitCode: 1, output: '', error: `o Google recusou a chave (${r.status}): ${msg}`, resourceUnavailable: true };
    if (r.status === 402) return { exitCode: 1, output: '', error: `sem crédito na conta do Google (402): ${msg}. Adicione crédito no Google AI Studio`, resourceUnavailable: true };
    if (r.status === 429) return { exitCode: 1, output: '', error: `limite de uso do Google atingido (429): ${msg}`, resourceUnavailable: true };
    if (r.status >= 500) return { exitCode: 1, output: '', error: `o Google está com problema (${r.status}): ${msg}`, resourceUnavailable: true };
    return { exitCode: 1, output: '', error: `o Google recusou o pedido (${r.status}): ${msg}` };
  }
}

/** Interação do Omni terminada (com ou sem vídeo). Sem status: só se já trouxer o resultado. */
function terminouOmni(j: any): boolean {
  if (typeof j?.status === 'string') return ['completed', 'failed', 'cancelled'].includes(j.status);
  return !!acharVideo(j);
}

/** O vídeo no resultado do Omni: o primeiro item {type:'video'} com uri ou data (em steps[].content[] ou onde vier). */
function acharVideo(j: any, fundo = 0): { data?: string; uri?: string } | null {
  if (!j || typeof j !== 'object' || fundo > 8) return null;
  if (j.type === 'video' && (typeof j.uri === 'string' || typeof j.data === 'string')) return { uri: j.uri, data: j.data };
  for (const v of Array.isArray(j) ? j : Object.values(j)) {
    const achou = acharVideo(v, fundo + 1);
    if (achou) return achou;
  }
  return null;
}
