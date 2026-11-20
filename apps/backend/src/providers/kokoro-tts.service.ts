import { Injectable } from '@nestjs/common';
import { VOZES_KOKORO, vozConhecida } from './vozes';

export type Pronuncias = Record<string, string>;
export type RitmoLocucao = 'calmo' | 'natural' | 'dinamico';

/**
 * Pausa ADICIONAL (não pausa total).
 * Comparação de prévias locais em 2026-11-20 (-40 dB):
 * com +430ms: silêncios de 650ms, 705ms e 761ms.
 * O sintetizador naturalmente pausa ~220-330ms após frases.
 * Assim, o ritmo calmo adiciona só ~80ms; nunca 430ms além da pontuação.
 * Não modifica timbre, tempo da fala, nem corta a gravação.
 */
export function pausaPadraoLocucao(ritmo: RitmoLocucao = 'natural'): number {
  return ritmo === 'calmo' ? 80 : ritmo === 'dinamico' ? 0 : 60;
}
export function velocidadePadraoLocucao(ritmo: RitmoLocucao = 'natural'): number {
  return ritmo === 'calmo' ? 0.85 : ritmo === 'dinamico' ? 1 : 0.9;
}
/** Separa APENAS frases completas; vírgulas e perguntas permanecem inteiras. */
export function frasesDeLocucao(texto: string): TrechoDeLocucao[] {
  const blocos = texto.trim().match(/[^.!?\n]+(?:[.!?]+|(?=\n|$))/g) ?? [];
  return blocos.map(frase => ({ texto: frase.trim() })).filter(t => t.texto);
}

export type TrechoDeLocucao = {
  texto: string;
  intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural';
  velocidade?: number;
  pausaAposMs?: number;
};

/**
 * Não interrompa uma frase no meio de uma oração: cada chamada Kokoro
 * reinicia o contexto de prosódia e pode mudar sotaque, pitch e ritmo.
 * Ex.: ["E você,", "vai ficar de fora dessa?"] vira UMA geração.
 * Pausas explícitas entre frases completas continuam independentes.
 */
export function unirTrechosContinuos(trechos: TrechoDeLocucao[]): TrechoDeLocucao[] {
  const saida: TrechoDeLocucao[] = [];
  for (const original of trechos) {
    const atual = { ...original, texto: original.texto.trim() };
    const anterior = saida[saida.length - 1];
    // Forma da pergunta final varia conforme o planejador:
    // "E você,", "E você", "E você…" ou até "E você." + "Vai ficar..."
    // Todas precisam de UMA geração; nunca um silêncio de 350 ms entre elas.
    const inicioPergunta = !!anterior &&
      /^e\s+voc[eê][,;:.!?…]*$/iu.test(anterior.texto) &&
      /^vai\s+ficar\b/iu.test(atual.texto);
    // Também preserve o contexto de orações divididas por vírgula,
    // mesmo quando a segunda parte começa com maiúscula.
    const continuaOracao = !!anterior && /[,;:]$/.test(anterior.texto) &&
      /^[a-zà-ú]/iu.test(atual.texto);
    if (!inicioPergunta && !continuaOracao) { saida.push(atual); continue; }
    // Não usar pausaAposMs do meio da oração: vírgula no texto é a pausa natural.
    const inicio = inicioPergunta ? 'E você,' : anterior!.texto;
    const complemento = inicioPergunta
      ? atual.texto[0].toLocaleLowerCase('pt-BR') + atual.texto.slice(1)
      : atual.texto;
    anterior!.texto = inicio + ' ' + complemento;
    anterior!.intencao = atual.intencao ?? anterior!.intencao;
    anterior!.pausaAposMs = atual.pausaAposMs;
    anterior!.velocidade = atual.velocidade ?? anterior!.velocidade;
  }
  return saida;
}


/**
 * Uma chamada TTS, com pausas explícitas do Kokoro-FastAPI (não do FFmpeg).
 * A sintaxe documentada é [pause:0.5s]; não usar tags SSML sem ssml:true.
 * Uma marcação de pausa não garante emoção nem entonação interrogativa.
 */
export function roteiroEmUmaFala(trechos: TrechoDeLocucao[], ritmo: RitmoLocucao = 'natural'): string {
  const partes = unirTrechosContinuos(trechos);
  return partes.map((t, i) => {
    const frase = t.texto.trim();
    const texto = t.intencao === 'pergunta' ? frase.replace(/[.!?]+$/, '') + '?' :
      (t.intencao === 'chamada' || t.intencao === 'destaque') ? frase.replace(/[.!?]+$/, '') + '!' : frase;
    const pausa = i === partes.length - 1 ? 0 : t.pausaAposMs ?? pausaPadraoLocucao(ritmo);
    // O marcador é enviado DENTRO do mesmo input ao servidor Kokoro.
    // Pausa ADICIONAL discreta; o Kokoro já pausa pela pontuação.
    return pausa > 0 ? `${texto} [pause:${(pausa / 1000).toFixed(2)}s]` : texto;
  }).join(' ').replace(/\s+/g, ' ').trim();
}

export class KokoroTtsError extends Error {
  constructor(message: string, readonly indisponivel = false) {
    super(message);
  }
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Aplica somente na cópia enviada ao sintetizador; o texto original continua preservado no plano e no cache. */
export function aplicarPronuncias(texto: string, pronuncias: Pronuncias = {}): string {
  let saida = texto;
  const entradas = Object.entries(pronuncias)
    .map(([de, para]) => [de.trim(), String(para).trim()] as const)
    .filter(([de, para]) => de && para)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [de, para] of entradas) saida = saida.replace(new RegExp(escaparRegex(de), 'giu'), para);
  return saida;
}

/** Cliente do Kokoro-FastAPI local. O serviço fica preso a 127.0.0.1 e não usa token de IA. */
@Injectable()
export class KokoroTtsService {
  private base(): string {
    return (process.env.NIVOO_KOKORO_URL ?? 'http://127.0.0.1:8880').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const chave = process.env.NIVOO_KOKORO_API_KEY?.trim();
    return { 'content-type': 'application/json', ...(chave ? { authorization: `Bearer ${chave}` } : {}) };
  }

  async status(): Promise<{ disponivel: boolean; url: string; vozes: string[]; erro?: string }> {
    const url = this.base();
    try {
      const res = await fetch(`${url}/v1/audio/voices`, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { disponivel: false, url, vozes: [], erro: `Kokoro respondeu ${res.status}` };
      const json: any = await res.json();
      const vozes = (Array.isArray(json) ? json : json?.voices ?? []).map((v: any) => String(v?.id ?? v)).filter(Boolean);
      return { disponivel: true, url, vozes: vozes.filter((id: string) => /^p[fm]_/.test(id)) };
    } catch (e: any) {
      return { disponivel: false, url, vozes: [], erro: e?.cause?.code ?? e?.message ?? 'sem resposta' };
    }
  }

  async gerar(textoOriginal: string, voz: string, velocidade = 1, pronuncias: Pronuncias = {}, signal?: AbortSignal): Promise<{ bytes: Buffer; mime: string; modelo: string; textoSintetizado: string }> {
    if (!vozConhecida(voz, 'kokoro')) throw new KokoroTtsError(`voz do Kokoro desconhecida: ${voz}`);
    const speed = Number(velocidade);
    if (!Number.isFinite(speed) || speed < 0.75 || speed > 1.25) throw new KokoroTtsError('a velocidade natural deve ficar entre 0,75 e 1,25');
    const textoSintetizado = aplicarPronuncias(textoOriginal.trim(), pronuncias);
    if (!textoSintetizado) throw new KokoroTtsError('texto da narração vazio');
    let res: Response;
    try {
      const sinais = [AbortSignal.timeout(600_000), ...(signal ? [signal] : [])];
      res = await fetch(`${this.base()}/v1/audio/speech`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: 'kokoro', input: textoSintetizado, voice: voz, response_format: 'mp3', speed }),
        signal: AbortSignal.any(sinais),
      });
    } catch (e: any) {
      throw new KokoroTtsError(`Kokoro local não respondeu: ${e?.cause?.code ?? e?.message}`, true);
    }
    if (!res.ok) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 400);
      throw new KokoroTtsError(`Kokoro respondeu ${res.status}${detalhe ? `: ${detalhe}` : ''}`, res.status >= 500);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new KokoroTtsError('Kokoro devolveu um áudio vazio');
    return { bytes, mime: res.headers.get('content-type') ?? 'audio/mpeg', modelo: 'Kokoro-82M local', textoSintetizado };
  }

  catalogo() {
    return VOZES_KOKORO;
  }
}
