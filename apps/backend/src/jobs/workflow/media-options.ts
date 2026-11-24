import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../../common/path-guard';
import { MotorNarracao, VOZES_NARRACAO, vozConhecida, vozPadraoDoMotor } from '../../providers/vozes';
import { normalizarCenasDeMontagem } from './media-dependencies';

const CAMINHO_SEGURO = /^(?!\/)(?!.*\.\.)[\w\-./ ]{1,200}$/;

/** Opções de uma etapa de vídeo vindas do plano, validadas (nada de caminho fora do projeto). */
export function opcoesDeVideo(key: string, o: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const arquivo = caminhoDoProjeto(o.arquivo ?? `videos/${key}.mp4`) ?? '';
  if (!/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
  out.arquivo = arquivo;
  if (o.duracaoSeg !== undefined) {
    const n = Number(o.duracaoSeg);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw new BadRequestException(`Etapa ${key}: duracaoSeg deve ser inteiro entre 1 e 60`);
    out.duracaoSeg = n;
  }
  if (o.proporcao !== undefined) {
    if (!/^\d{1,2}:\d{1,2}$/.test(String(o.proporcao))) throw new BadRequestException(`Etapa ${key}: proporcao deve ser como 16:9 ou 9:16`);
    out.proporcao = String(o.proporcao);
  }
  if (o.resolucao !== undefined) {
    if (!/^\d{3,4}p$|^4k$/i.test(String(o.resolucao))) throw new BadRequestException(`Etapa ${key}: resolucao deve ser como 720p ou 1080p`);
    out.resolucao = String(o.resolucao);
  }
  if (o.negativo !== undefined) out.negativo = String(o.negativo).slice(0, 1000);
  if (o.imagem !== undefined) {
    const img = String(o.imagem).trim();
    if (!CAMINHO_SEGURO.test(img) || !/\.(png|jpe?g|webp)$/i.test(img)) throw new BadRequestException(`Etapa ${key}: "imagem" deve ser um caminho de imagem do projeto (png, jpg, webp)`);
    out.imagem = img;
  }
  if (o.conexao !== undefined) out.conexao = String(o.conexao).slice(0, 60);
  // Legenda da cena (texto curto que aparece no vídeo completo) e estilo da transição para a cena seguinte.
  if (o.legenda !== undefined && String(o.legenda).trim()) out.legenda = String(o.legenda).trim().slice(0, 300);
  if (o.transicao !== undefined) out.transicao = transicaoValida(key, o.transicao);
  // Trilha de fundo do vídeo completo (na cena: vai para a junção) e cena sem música própria.
  if (o.trilha !== undefined) out.trilha = trilhaValida(key, o.trilha);
  if (o.narracao !== undefined) out.narracao = narracaoValida(key, o.narracao);
  if (o.semMusica !== undefined) out.semMusica = o.semMusica === true;
  if (o.semAudio !== undefined) out.semAudio = o.semAudio === true;
  return out;
}

/** Opções da etapa que junta as cenas: lista de cenas (na ordem) e o arquivo final, só caminhos do projeto. */
/** Estilos de transição entre as cenas (nomes do ffmpeg xfade); "corte" = sem transição. */
export const TRANSICOES = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'slideup', 'circleopen', 'circleclose', 'smoothleft', 'zoomin', 'corte'];

/** Trilha de fundo: um áudio do projeto ou a descrição da música que o Google (Lyria) compõe; volume 0–1. */
/** Narração (voz): Kokoro local por padrão, Gemini paga opcional, ou um áudio pronto do projeto. */
export function narracaoValida(key: string, n: any): { texto?: string; arquivo?: string; voz?: string; motor?: MotorNarracao; velocidade?: number; pronuncias?: Record<string, string>; volumeFundoSobVoz?: number; ritmo?: 'calmo' | 'natural' | 'dinamico'; trechos?: Array<{ texto: string; intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural'; velocidade?: number; pausaAposMs?: number }> } {
  if (!n || typeof n !== 'object') throw new BadRequestException(`Etapa ${key}: narracao deve ser {"texto":"..."} ou {"arquivo":"audio/voz.mp3"}`);
  const out: ReturnType<typeof narracaoValida> = {};
  if (n.arquivo !== undefined) {
    const a = caminhoDoProjeto(n.arquivo);
    if (!a || !/\.(mp3|wav|m4a|aac|ogg)$/i.test(a)) throw new BadRequestException(`Etapa ${key}: narracao.arquivo deve ser um áudio do projeto (mp3, wav, m4a, aac, ogg)`);
    out.arquivo = a;
  }
  if (n.texto !== undefined && String(n.texto).trim()) out.texto = String(n.texto).trim().slice(0, 5000);
  if (n.trechos !== undefined) {
    if (!Array.isArray(n.trechos) || n.trechos.length < 1 || n.trechos.length > 12 || out.arquivo)
      throw new BadRequestException(`Etapa ${key}: trechos devem ter entre 1 e 12 frases e não podem acompanhar áudio pronto`);
    const partes: NonNullable<typeof out.trechos> = [];
    for (const [i, trecho] of n.trechos.entries()) {
      if (!trecho || typeof trecho.texto !== 'string' || !trecho.texto.trim() || trecho.texto.length > 700)
        throw new BadRequestException(`Etapa ${key}: texto inválido no trecho ${i + 1}`);
      const t: typeof partes[number] = { texto: trecho.texto.trim() };
      if (trecho.intencao !== undefined) {
        if (!['chamada', 'destaque', 'pergunta', 'natural'].includes(trecho.intencao))
          throw new BadRequestException(`Etapa ${key}: intenção inválida no trecho ${i + 1}`);
        t.intencao = trecho.intencao;
      }
      if (trecho.velocidade !== undefined) {
        if (typeof trecho.velocidade !== 'number' || !Number.isFinite(trecho.velocidade) || trecho.velocidade < 0.75 || trecho.velocidade > 1.25)
          throw new BadRequestException(`Etapa ${key}: velocidade inválida no trecho ${i + 1}`);
        t.velocidade = trecho.velocidade;
      }
      if (trecho.pausaAposMs !== undefined) {
        if (!Number.isInteger(trecho.pausaAposMs) || trecho.pausaAposMs < 0 || trecho.pausaAposMs > 1500)
          throw new BadRequestException(`Etapa ${key}: pausaAposMs inválida no trecho ${i + 1}`);
        t.pausaAposMs = trecho.pausaAposMs;
      }
      partes.push(t);
    }
    if (partes.reduce((sum, t) => sum + t.texto.length, 0) > 5000)
      throw new BadRequestException(`Etapa ${key}: trechos excedem o limite de texto`);
    out.trechos = partes;
  }
  if (!out.arquivo && !out.texto && !out.trechos?.length)
    throw new BadRequestException(`Etapa ${key}: narração exige texto, trechos ou arquivo`);
  const motor = n.motor === undefined ? undefined : String(n.motor).trim().toLowerCase();
  if (motor !== undefined && motor !== 'kokoro' && motor !== 'gemini') throw new BadRequestException(`Etapa ${key}: narracao.motor deve ser "kokoro" ou "gemini"`);
  if (motor) out.motor = motor as MotorNarracao;
  if (n.voz !== undefined && String(n.voz).trim()) {
    const v = vozConhecida(String(n.voz).trim());
    if (!v) throw new BadRequestException(`Etapa ${key}: narracao.voz "${String(n.voz).trim()}" não existe. Vozes: ${VOZES_NARRACAO.map((x) => `${x.id} (${x.genero})`).join(', ')}`);
    if (out.motor && v.motor !== out.motor) throw new BadRequestException(`Etapa ${key}: a voz ${v.id} pertence ao motor ${v.motor}, não ao ${out.motor}`);
    out.motor ??= v.motor;
    out.voz = v.id;
  } else if (out.motor) {
    out.voz = vozPadraoDoMotor(out.motor);
  }
  if (n.ritmo !== undefined) {
    if (!['calmo', 'natural', 'dinamico'].includes(n.ritmo))
      throw new BadRequestException(`Etapa ${key}: narracao.ritmo deve ser calmo, natural ou dinamico`);
    out.ritmo = n.ritmo;
  }
  if (n.velocidade !== undefined) {
    const v = Number(n.velocidade);
    if (!(v >= 0.75 && v <= 1.25)) throw new BadRequestException(`Etapa ${key}: narracao.velocidade deve ficar entre 0.75 e 1.25`);
    out.velocidade = v;
  }
  if (n.pronuncias !== undefined) {
    if (!n.pronuncias || typeof n.pronuncias !== 'object' || Array.isArray(n.pronuncias)) throw new BadRequestException(`Etapa ${key}: narracao.pronuncias deve ser um objeto {"texto original":"pronúncia"}`);
    const entradas = Object.entries(n.pronuncias);
    if (entradas.length > 50) throw new BadRequestException(`Etapa ${key}: narracao.pronuncias aceita no máximo 50 substituições`);
    const pronuncias: Record<string, string> = {};
    for (const [de, para] of entradas) {
      const d = de.trim().slice(0, 100);
      const p = String(para).trim().slice(0, 100);
      if (d && p) pronuncias[d] = p;
    }
    if (Object.keys(pronuncias).length) out.pronuncias = pronuncias;
  }
  if (n.volumeFundoSobVoz !== undefined) {
    const v = Number(n.volumeFundoSobVoz);
    if (!(v >= 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: narracao.volumeFundoSobVoz deve ser entre 0 e 1`);
    out.volumeFundoSobVoz = v;
  }
  return out;
}

function trilhaValida(key: string, t: any): { arquivo?: string; descricao?: string; volume?: number } {
  if (!t || typeof t !== 'object') throw new BadRequestException(`Etapa ${key}: trilha deve ser {"descricao":"..."} ou {"arquivo":"audio/musica.mp3"}`);
  const out: { arquivo?: string; descricao?: string; volume?: number } = {};
  if (t.arquivo !== undefined) {
    const a = caminhoDoProjeto(t.arquivo);
    if (!a || !/\.(mp3|wav|m4a|aac|ogg)$/i.test(a)) throw new BadRequestException(`Etapa ${key}: trilha.arquivo deve ser um áudio do projeto (mp3, wav, m4a, aac, ogg)`);
    out.arquivo = a;
  }
  if (t.descricao !== undefined && String(t.descricao).trim()) out.descricao = String(t.descricao).trim().slice(0, 1000);
  if (!out.arquivo && !out.descricao) throw new BadRequestException(`Etapa ${key}: trilha precisa de "descricao" (música gerada) ou "arquivo" (áudio do projeto)`);
  if (t.volume !== undefined) {
    const v = Number(t.volume);
    if (!(v > 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: trilha.volume deve ser entre 0 e 1`);
    out.volume = v;
  }
  return out;
}

function transicaoValida(key: string, t: unknown): string {
  const v = String(t).trim().toLowerCase();
  if (!TRANSICOES.includes(v)) throw new BadRequestException(`Etapa ${key}: transicao deve ser uma de: ${TRANSICOES.join(', ')}`);
  return v;
}

export function opcoesDeJuncao(key: string, o: any): { cenas: string[]; arquivo: string; legendas?: string[]; transicoes?: string[]; trilha?: ReturnType<typeof trilhaValida>; volumeCenas?: number; cortes?: Array<{ inicio?: number; fim?: number; velocidade?: number } | null>; narracao?: ReturnType<typeof narracaoValida>; sincronizarVideoComNarracao?: boolean } {
  const cenas: string[] = normalizarCenasDeMontagem(o).map((c: unknown): string => {
    const caminho = caminhoDoProjeto(c);
    if (!caminho || !/\.(mp4|mov|webm)$/i.test(caminho))
      throw new BadRequestException(`Etapa ${key}: "cenas" deve ser a lista de vídeos do projeto, na ordem`);
    return caminho;
  });
  if (!cenas.length) throw new BadRequestException(`Etapa ${key}: "cenas" deve ser a lista de vídeos do projeto, na ordem`);
  if (cenas.length > 200) throw new BadRequestException(`Etapa ${key}: no máximo 200 cenas`);
  const arquivo = caminhoDoProjeto(o.arquivo) ?? '';
  if (!/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
  if (cenas.includes(arquivo)) throw new BadRequestException(`Etapa ${key}: o vídeo final não pode ter o nome de uma cena`);
  const out: ReturnType<typeof opcoesDeJuncao> = { cenas, arquivo };
  if (o.trilha !== undefined) out.trilha = trilhaValida(key, o.trilha);
  if (o.volumeCenas !== undefined) {
    const v = Number(o.volumeCenas);
    if (!(v >= 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: volumeCenas deve ser entre 0 (sem o som das cenas) e 1`);
    out.volumeCenas = v;
  }
  if (Array.isArray(o.legendas) && o.legendas.some((l: unknown) => String(l ?? '').trim())) out.legendas = cenas.map((_: string, i: number) => String(o.legendas[i] ?? '').trim().slice(0, 300));
  if (o.transicao !== undefined || Array.isArray(o.transicoes)) {
    const lista = Array.isArray(o.transicoes) ? o.transicoes : [];
    out.transicoes = cenas.slice(1).map((_: string, i: number) => transicaoValida(key, lista[i] ?? o.transicao ?? 'fade'));
  }
  // Recorte/velocidade por clipe (edição): cortes[i] = { inicio, fim, velocidade } alinhado com cenas.
  if (Array.isArray(o.cortes) && o.cortes.some((c: unknown) => c && typeof c === 'object')) {
    const cortes = cenas.map((_: string, i: number) => {
      const c = o.cortes[i];
      if (!c || typeof c !== 'object') return null;
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
      const inicio = n(c.inicio);
      const fim = n(c.fim);
      const velocidade = n(c.velocidade);
      if (inicio !== undefined && inicio < 0) throw new BadRequestException(`Etapa ${key}: corte ${i + 1} tem início negativo`);
      if (fim !== undefined && inicio !== undefined && fim <= inicio) throw new BadRequestException(`Etapa ${key}: corte ${i + 1} tem fim menor ou igual ao início`);
      if (velocidade !== undefined && !(velocidade >= 0.25 && velocidade <= 8)) throw new BadRequestException(`Etapa ${key}: velocidade do corte ${i + 1} deve ser entre 0.25 e 8`);
      const r: { inicio?: number; fim?: number; velocidade?: number } = {};
      if (inicio) r.inicio = inicio;
      if (fim !== undefined) r.fim = fim;
      if (velocidade !== undefined && velocidade !== 1) r.velocidade = velocidade;
      return Object.keys(r).length ? r : null;
    });
    if (!cortes.every((c: unknown) => c === null)) out.cortes = cortes;
  }
  if (o.narracao !== undefined) out.narracao = narracaoValida(key, o.narracao);
  if (o.sincronizarVideoComNarracao !== undefined) {
    if (typeof o.sincronizarVideoComNarracao !== 'boolean') throw new BadRequestException(`Etapa ${key}: sincronizarVideoComNarracao deve ser booleano`);
    if (o.sincronizarVideoComNarracao && !out.narracao) throw new BadRequestException(`Etapa ${key}: sincronização exige narração`);
    out.sincronizarVideoComNarracao = o.sincronizarVideoComNarracao;
  }
  return out;
}

