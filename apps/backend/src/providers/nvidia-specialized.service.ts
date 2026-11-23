import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ehAdicional, tipoDe } from '../accounts/connections';
import { segredoDaConexao } from '../accounts/secrets';
import { catalogarNvidiaModelos } from './nvidia-model-catalog';

/**
 * NVIDIA Build: endpoints oficiais, fixos e distintos por capacidade.
 * NÃO converter um modelo de vídeo/embedding em Chat Completions.
 * A chave é reutilizada com segurança; não permitir base URL controlada pelo usuário.
 */
export const NVIDIA_SPECIAL_ENDPOINTS = {
  chat: 'https://integrate.api.nvidia.com/v1/chat/completions',
  embeddings: 'https://integrate.api.nvidia.com/v1/embeddings',
  rerank: 'https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking',
  imageFluxSchnell: 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell',
  videoCosmosNano: 'https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano',
} as const;

const EMBEDDINGS = new Set([
  'nvidia/nemotron-3.5-embed-1b',
  'nvidia/nemotron-3.5-embed-8b',
  'nvidia/nemotron-3-embed-1b',
]);
const RERANK = 'nvidia/nemotron-3.5-rerank-8b';
const FLUX = 'black-forest-labs/flux.1-schnell';

export interface NvidiaResultado {
  tipo: 'conversa' | 'embedding' | 'rerank' | 'imagem' | 'video';
  modelo: string;
  [key: string]: unknown;
}

function erroSemSegredo(texto: string, chave: string): string {
  return texto.split(chave).join('[chave oculta]').replace(/nvapi-[A-Za-z0-9_-]+/g, '[chave oculta]').slice(0, 600);
}
function texto(valor: unknown, nome: string, limite = 12000): string {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > limite) {
    throw new BadRequestException(nome + ' precisa ser texto não vazio de até ' + limite + ' caracteres');
  }
  return valor.trim();
}
function modeloSeguro(valor: unknown): string {
  const id = texto(valor, 'modelo', 160);
  if (!/^[A-Za-z0-9._/-]+$/.test(id)) throw new BadRequestException('ID de modelo inválido');
  return id;
}
function numeroLimitado(valor: unknown, nome: string, padrao: number, minimo: number, maximo: number): number {
  const n = valor == null ? padrao : Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) throw new BadRequestException(nome + ' fora dos limites permitidos');
  return n;
}
function modeloDeChatConhecido(id: string): boolean {
  // Não aceitar uma família apenas porque contém "llama"/"nemotron": o
  // catálogo distingue endpoint real de nome publicitário.
  return catalogarNvidiaModelos([id]).some(m => m.id === id && m.endpoint === 'chat-completions' && m.fonte === 'nvidia-build');
}

@Injectable()
export class NvidiaSpecializedService {
  private readonly videos = new Map<string, {
    conexao: string; assinatura: string; estado: 'executando' | 'concluido' | 'falhou'; criadoEm: number;
    resultado?: NvidiaResultado; erro?: string;
  }>();
  private limparVideos() {
    const agora = Date.now();
    for (const [id, job] of this.videos) {
      if (agora - job.criadoEm > 30 * 60_000) this.videos.delete(id);
    }
    // Clipes MP4 em base64 ocupam muita memória: manter no máximo quatro
    // resultados finalizados, além dos dois pedidos em andamento.
    const finalizados = [...this.videos.entries()].filter(([, v]) => v.estado !== 'executando')
      .sort((a, b) => a[1].criadoEm - b[1].criadoEm);
    for (const [id] of finalizados.slice(0, Math.max(0, finalizados.length - 4))) this.videos.delete(id);
  }
  private chave(conexao: string): string {
    if (tipoDe(conexao) !== 'nvidia-api') throw new BadRequestException('Selecione uma conexão NVIDIA válida');
    const k = segredoDaConexao(ehAdicional(conexao) ? conexao : null, 'NVIDIA_API_KEY');
    if (!k) throw new UnauthorizedException('Cadastre a chave NVIDIA em Conexões');
    return k;
  }

  private async post(conexao: string, url: string, payload: unknown, timeoutMs = 40_000, maxBytes = 9_000_000): Promise<any> {
    // O chamador NUNCA pode fornecer URL: as rotas são constantes oficiais.
    if (!(Object.values(NVIDIA_SPECIAL_ENDPOINTS) as string[]).includes(url)) throw new BadRequestException('Endpoint proibido');
    const chave = this.chave(conexao);
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + chave,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      if (url === NVIDIA_SPECIAL_ENDPOINTS.videoCosmosNano && /abort|timeout/i.test(String(e?.message ?? e))) {
        throw new BadRequestException('A solicitação de vídeo Cosmos3 pode ter continuado na NVIDIA após o timeout. Não reenvie automaticamente; confira o histórico da sua conta NVIDIA.');
      }
      throw new BadRequestException('NVIDIA indisponível: ' + erroSemSegredo(String(e?.message ?? e), chave));
    }
    const bruto = await resposta.text();
    if (bruto.length > maxBytes) throw new BadRequestException('Resposta NVIDIA excedeu o tamanho permitido');
    let json: any;
    try { json = JSON.parse(bruto); } catch {
      if (resposta.ok) throw new BadRequestException('Resposta não JSON da NVIDIA');
      json = { error: { message: bruto.slice(0, 250) } };
    }
    if (!resposta.ok) {
      const erro = erroSemSegredo(String(json?.error?.message ?? json?.detail ?? json?.message ?? 'Erro sem descrição'), chave);
      if (url === NVIDIA_SPECIAL_ENDPOINTS.videoCosmosNano && resposta.status === 404) {
        throw new BadRequestException('NVIDIA Cosmos3 Nano HTTP 404: o endpoint pode exigir habilitar Public API Endpoints na sua organização NVIDIA. Confira o acesso no Build; não refaça a mesma geração automaticamente.');
      }
      throw new BadRequestException('NVIDIA HTTP ' + resposta.status + ': ' + erro);
    }
    return json;
  }

  /** Conversa pura para modelos de chat, inclusive os sem function calling. */
  async conversa(conexao: string, input: any): Promise<NvidiaResultado> {
    const model = modeloSeguro(input?.modelo);
    if (!modeloDeChatConhecido(model)) throw new BadRequestException('Modelo não confirmado como Chat Completions; escolha um modelo de conversa');
    const prompt = texto(input?.prompt, 'prompt', 15000);
    // Riva Translate v2 requires source-target locale code in the system
    // message; plain natural-language "traduza..." is not sufficient.
    const idiomas = new Set(['en','pt-br','pt-pt','es-es','es-us','fr','de','it','ja','zh-cn','zh-tw','ko','ru']);
    const riva = model === 'nvidia/riva-translate-4b-instruct-v2';
    const origem = String(input?.idiomaOrigem ?? 'pt-br').toLowerCase();
    const destino = String(input?.idiomaDestino ?? 'en').toLowerCase();
    if (riva && (!idiomas.has(origem) || !idiomas.has(destino) || origem === destino)) {
      throw new BadRequestException('Informe idiomas de origem e destino diferentes e suportados pelo Riva');
    }
    const messages = riva
      ? [{ role: 'system', content: origem + '-' + destino }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    const r = await this.post(conexao, NVIDIA_SPECIAL_ENDPOINTS.chat, {
      model, messages, stream: false,
      max_tokens: numeroLimitado(input?.maxTokens, 'maxTokens', 1200, 1, 4096),
    });
    const output = r?.choices?.[0]?.message?.content;
    if (typeof output !== 'string') throw new BadRequestException('Modelo não retornou texto; confira compatibilidade de chat');
    return { tipo: 'conversa', modelo: model, texto: output.slice(0, 25000),
      tokensEntrada: r.usage?.prompt_tokens ?? null, tokensSaida: r.usage?.completion_tokens ?? null };
  }

  async embedding(conexao: string, input: any): Promise<NvidiaResultado> {
    const model = modeloSeguro(input?.modelo ?? 'nvidia/nemotron-3.5-embed-1b');
    if (!EMBEDDINGS.has(model)) throw new BadRequestException('Modelo não habilitado para embeddings');
    const valor = texto(input?.texto, 'texto', 16000);
    const inputType = input?.inputType === 'passage' ? 'passage' : 'query';
    const r = await this.post(conexao, NVIDIA_SPECIAL_ENDPOINTS.embeddings, {
      model, input: [valor], input_type: inputType, encoding_format: 'float', truncate: 'END',
    });
    const vector = r?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length < 1 || vector.length > 10000 ||
        !vector.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) {
      throw new BadRequestException('NVIDIA não retornou vetor de embedding válido');
    }
    // Resultado integral para integração RAG; na UI só os primeiros valores são exibidos.
    return { tipo: 'embedding', modelo: model, dimensoes: vector.length, vetor: vector,
      inputType, tokens: r.usage?.total_tokens ?? null };
  }

  async rerank(conexao: string, input: any): Promise<NvidiaResultado> {
    const model = modeloSeguro(input?.modelo ?? RERANK);
    if (model !== RERANK) throw new BadRequestException('Modelo de reranking não reconhecido');
    const query = texto(input?.consulta, 'consulta', 5000);
    const passages: unknown = input?.trechos;
    if (!Array.isArray(passages) || passages.length < 1 || passages.length > 30) {
      throw new BadRequestException('Informe de 1 a 30 trechos para reordenar');
    }
    const textos = passages.map(p => texto(p, 'trecho', 5000));
    const r = await this.post(conexao, NVIDIA_SPECIAL_ENDPOINTS.rerank, {
      model, query: { text: query }, passages: textos.map(p => ({ text: p })), truncate: 'END',
    });
    const valores = Array.isArray(r?.rankings) ? r.rankings : Array.isArray(r?.data) ? r.data : null;
    if (!valores) throw new BadRequestException('Resposta de reranking sem ranking');
    const ordenados = valores.map((v: any) => ({
      indice: Number(v?.index),
      pontuacao: Number(v?.logit ?? v?.relevance_score ?? v?.score),
    }));
    if (ordenados.some((v: any) =>
      !Number.isInteger(v.indice) || v.indice < 0 || v.indice >= textos.length || !Number.isFinite(v.pontuacao))) {
      throw new BadRequestException('Ranking com índices ou pontuações inválidas');
    }
    ordenados.sort((a: any, b: any) => b.pontuacao - a.pontuacao);
    return { tipo: 'rerank', modelo: model, resultados: ordenados.map((v: any) => ({ ...v, texto: textos[v.indice] })) };
  }

  /**
   * Preview de geração de imagem por endpoint NVIDIA separado.
   * O site atualmente marca FLUX.1 Schnell como DOWNLOAD, portanto NÃO
   * prometer cota gratuita ou produção: a API pode recusar a chave (402/403).
   */
  async imagem(conexao: string, input: any): Promise<NvidiaResultado> {
    const model = modeloSeguro(input?.modelo ?? FLUX);
    if (model !== FLUX) throw new BadRequestException('Somente FLUX.1 Schnell tem adaptador de imagem nesta etapa');
    const prompt = texto(input?.prompt, 'prompt', 2000);
    // Preview hospedado de FLUX.1 Schnell aceita somente resolução 1024×1024.
    const largura = numeroLimitado(input?.largura, 'largura', 1024, 1024, 1024);
    const altura = numeroLimitado(input?.altura, 'altura', 1024, 1024, 1024);
    const r = await this.post(conexao, NVIDIA_SPECIAL_ENDPOINTS.imageFluxSchnell, {
      prompt, mode: 'base', width: largura, height: altura,
      steps: 4, samples: 1, cfg_scale: 0, seed: numeroLimitado(input?.seed, 'seed', 0, 0, 4294967295),
    }, 90_000);
    const img = r?.artifacts?.[0]?.base64 ?? r?.data?.[0]?.b64_json;
    if (typeof img !== 'string' || !/^[a-zA-Z0-9+/=\r\n]+$/.test(img) || img.length > 8_000_000) {
      throw new BadRequestException('NVIDIA não retornou imagem base64 suportada');
    }
    return { tipo: 'imagem', modelo: model, mime: 'image/jpeg', base64: img, largura, altura };
  }

  /**
   * Prévia text-to-video Cosmos3 Nano hospedada, com parâmetros documentados.
   * A geração pode ser lenta. Não repetir após timeout: resultado remoto pode
   * ter sido concluído mesmo sem resposta no Nivoo.
   */
  async video(conexao: string, input: any): Promise<NvidiaResultado> {
    const model = modeloSeguro(input?.modelo ?? 'nvidia/cosmos3-nano');
    if (model !== 'nvidia/cosmos3-nano') throw new BadRequestException('Somente Cosmos3 Nano tem API hospedada de vídeo nesta versão');
    const prompt = texto(input?.prompt, 'prompt', 2000);
    const proporcao = input?.proporcao === '9:16' ? '9:16' : '16:9';
    const resolucao = proporcao === '9:16' ? '480_9_16' : '480_16_9';
    const numFrames = numeroLimitado(input?.numFrames, 'numFrames', 25, 25, 49);
    const fps = 24;
    const r = await this.post(conexao, NVIDIA_SPECIAL_ENDPOINTS.videoCosmosNano, {
      model_mode: 'text2video',
      prompt,
      resolution: resolucao,
      num_frames: numFrames,
      num_inference_steps: 35,
      fps,
      seed: numeroLimitado(input?.seed, 'seed', 42, 0, 4294967295),
    }, 180_000, 64_000_000);
    const media = r?.b64_video;
    if (typeof media !== 'string' || media.length === 0 || media.length > 60_000_000 ||
        !/^[A-Za-z0-9+/=\r\n]+$/.test(media)) {
      const id = String(r?.request_id ?? r?.id ?? '').slice(0, 120);
      if (id) throw new BadRequestException('NVIDIA aceitou uma geração assíncrona com ID ' + id +
        ', mas não retornou vídeo imediato. Não reenviar automaticamente: consultar o status da solicitação no Build.');
      throw new BadRequestException('A NVIDIA não retornou MP4 nessa chamada. Verifique disponibilidade e permissões do Cosmos3 Nano.');
    }
    return { tipo: 'video', modelo: model, mime: 'video/mp4', base64: media,
      fps, numFrames, proporcao, duracaoSeg: Number((numFrames / fps).toFixed(2)) };
  }

  /**
   * A geração pode levar mais tempo do que o proxy HTTP permite manter aberto.
   * Começamos UM pedido e consultamos o mesmo ID, sem pagar por tentativas
   * duplicadas. Se o processo reiniciar, nenhum pedido é refeito sozinho.
   */
  iniciarVideo(conexao: string, input: any) {
    this.chave(conexao);
    const prompt = texto(input?.prompt, 'prompt', 2000);
    this.limparVideos();
    const assinatura = createHash('sha256').update(JSON.stringify({ conexao, prompt,
      modelo: input?.modelo ?? 'nvidia/cosmos3-nano', proporcao: input?.proporcao ?? '16:9',
      numFrames: input?.numFrames ?? 25, seed: input?.seed ?? 42 })).digest('hex');
    for (const [id, job] of this.videos) {
      if (job.conexao === conexao && job.assinatura === assinatura &&
          Date.now() - job.criadoEm < 10 * 60_000) {
        return { id, estado: job.estado, aviso: 'Pedido idêntico já iniciado: reutilizando o ID, sem gerar novamente.' };
      }
    }
    const pendentes = [...this.videos.values()].filter(v => v.conexao === conexao && v.estado === 'executando');
    if (pendentes.length >= 2) throw new BadRequestException('Há duas gerações NVIDIA em andamento; consulte os resultados antes de iniciar outra.');
    const id = randomUUID();
    this.videos.set(id, { conexao, assinatura, estado: 'executando', criadoEm: Date.now() });
    void this.video(conexao, input)
      .then(resultado => {
        const atual = this.videos.get(id);
        if (atual) { atual.estado = 'concluido'; atual.resultado = resultado; }
      })
      .catch((e: any) => {
        const atual = this.videos.get(id);
        if (atual) {
          atual.estado = 'falhou';
          atual.erro = String(e?.message ?? e).slice(0, 900);
        }
      });
    return { id, estado: 'executando', aviso: 'Geração enviada uma única vez; consulte este ID. Não inicie outra em caso de timeout.' };
  }

  statusVideo(conexao: string, id: string) {
    if (tipoDe(conexao) !== 'nvidia-api') throw new BadRequestException('Conexão inválida');
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new BadRequestException('ID inválido');
    this.limparVideos();
    const job = this.videos.get(id);
    if (!job || job.conexao !== conexao) throw new BadRequestException(
      'Geração não encontrada (expirou ou o servidor reiniciou). Antes de reenviar, confira o histórico NVIDIA.');
    return { id, estado: job.estado, erro: job.erro ?? null,
      resultado: job.estado === 'concluido' ? job.resultado : undefined };
  }

  /** O catálogo de capacidades é exclusivo das conexões NVIDIA. */
  capacidadesParaConexao(conexao: string) {
    if (tipoDe(conexao) !== 'nvidia-api') throw new BadRequestException('Selecione uma conexão NVIDIA válida');
    return this.capacidades();
  }

  /** Estado dos conectores conhecidos, distinguindo API real de só download. */
  capacidades() {
    return [
      { tipo: 'conversa', modelos: 'Chat Completions documentados', estado: 'integrado', local: false },
      { tipo: 'embedding', modelos: [...EMBEDDINGS], estado: 'integrado', local: false },
      { tipo: 'rerank', modelos: [RERANK], estado: 'integrado', local: false },
      { tipo: 'imagem', modelos: [FLUX], estado: 'API implementada; acesso depende da chave', local: false },
      { tipo: 'video', modelos: ['Cosmos3 Nano'], estado: 'API de vídeo integrada; pode exigir habilitação Public API Endpoints na conta', local: false },
      { tipo: 'video-local', modelos: ['Wan 2.2 Animate', 'Video Super Resolution'], estado: 'necessita NIM local ou infraestrutura própria', local: true },
      { tipo: 'audio', modelos: ['Parakeet', 'Magpie', 'Whisper'], estado: 'requer endpoint/implantação específica', local: true },
      { tipo: 'outros', modelos: ['OCR', 'Kumo', 'ciência', 'segurança'], estado: 'requer endpoint/implantação específica', local: true },
    ];
  }
}
