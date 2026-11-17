/**
 * Catálogo de vozes da narração (locução) — nomes oficiais das vozes da Gemini TTS, com o gênero
 * (feminina/masculina) e um estilo curto em português. É a ÚNICA fonte da verdade: o seletor da tela,
 * a validação do pedido e a orientação da IA usam esta lista. Gêneros conferidos na documentação do Google
 * (Google Cloud Text-to-Speech / Firebase AI Logic): Kore e Zephyr femininas; Puck e Charon masculinos; etc.
 */
export type GeneroVoz = 'feminina' | 'masculina';

export interface Voz {
  /** Nome exato aceito pela API da Gemini (prebuiltVoiceConfig.voiceName). */
  id: string;
  genero: GeneroVoz;
  /** Estilo curto, em português, para o usuário escolher. */
  estilo: string;
}

/** Voz padrão quando o usuário/IA não escolhe (feminina, firme). */
export const VOZ_PADRAO = 'Kore';

export const VOZES_NARRACAO: Voz[] = [
  { id: 'Kore', genero: 'feminina', estilo: 'firme' },
  { id: 'Zephyr', genero: 'feminina', estilo: 'clara e brilhante' },
  { id: 'Aoede', genero: 'feminina', estilo: 'leve' },
  { id: 'Leda', genero: 'feminina', estilo: 'jovem' },
  { id: 'Charon', genero: 'masculina', estilo: 'informativa' },
  { id: 'Puck', genero: 'masculina', estilo: 'animada' },
  { id: 'Orus', genero: 'masculina', estilo: 'firme' },
  { id: 'Fenrir', genero: 'masculina', estilo: 'entusiasmada' },
];

const PORID = new Map(VOZES_NARRACAO.map((v) => [v.id.toLowerCase(), v]));

/** A voz existe no catálogo? (sem diferenciar maiúsculas) */
export function vozConhecida(id: string): Voz | undefined {
  return PORID.get(String(id ?? '').trim().toLowerCase());
}

/** "Kore" → "Kore (feminina, firme)"; desconhecida → o próprio id. */
export function descreverVoz(id: string): string {
  const v = vozConhecida(id);
  return v ? `${v.id} (${v.genero}, ${v.estilo})` : id;
}
