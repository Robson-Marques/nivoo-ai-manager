/** Catálogo único das vozes de locução. A música/trilha não usa este catálogo. */
export type GeneroVoz = 'feminina' | 'masculina';
export type MotorNarracao = 'kokoro' | 'gemini';

export interface Voz {
  /** Nome exato aceito pelo motor. */
  id: string;
  motor: MotorNarracao;
  idioma: string;
  genero: GeneroVoz;
  estilo: string;
}

/** Kokoro local é o padrão: português brasileiro e sem consumo de token. */
export const MOTOR_NARRACAO_PADRAO: MotorNarracao = 'kokoro';
export const VOZ_PADRAO_KOKORO = 'pf_dora';
export const VOZ_PADRAO_GEMINI = 'Kore';
export const VOZ_PADRAO = VOZ_PADRAO_KOKORO;

export const VOZES_KOKORO: Voz[] = [
  { id: 'pf_dora', motor: 'kokoro', idioma: 'pt-BR', genero: 'feminina', estilo: 'brasileira natural' },
  { id: 'pm_alex', motor: 'kokoro', idioma: 'pt-BR', genero: 'masculina', estilo: 'brasileira natural' },
  { id: 'pm_santa', motor: 'kokoro', idioma: 'pt-BR', genero: 'masculina', estilo: 'brasileira natural' },
];

export const VOZES_GEMINI: Voz[] = [
  { id: 'Kore', motor: 'gemini', idioma: 'pt-BR', genero: 'feminina', estilo: 'firme' },
  { id: 'Zephyr', motor: 'gemini', idioma: 'pt-BR', genero: 'feminina', estilo: 'clara e brilhante' },
  { id: 'Aoede', motor: 'gemini', idioma: 'pt-BR', genero: 'feminina', estilo: 'leve' },
  { id: 'Leda', motor: 'gemini', idioma: 'pt-BR', genero: 'feminina', estilo: 'jovem' },
  { id: 'Charon', motor: 'gemini', idioma: 'pt-BR', genero: 'masculina', estilo: 'informativa' },
  { id: 'Puck', motor: 'gemini', idioma: 'pt-BR', genero: 'masculina', estilo: 'animada' },
  { id: 'Orus', motor: 'gemini', idioma: 'pt-BR', genero: 'masculina', estilo: 'firme' },
  { id: 'Fenrir', motor: 'gemini', idioma: 'pt-BR', genero: 'masculina', estilo: 'entusiasmada' },
];

export const VOZES_NARRACAO: Voz[] = [...VOZES_KOKORO, ...VOZES_GEMINI];
const POR_ID = new Map(VOZES_NARRACAO.map((v) => [v.id.toLowerCase(), v]));

export function vozConhecida(id: string, motor?: MotorNarracao): Voz | undefined {
  const voz = POR_ID.get(String(id ?? '').trim().toLowerCase());
  return voz && (!motor || voz.motor === motor) ? voz : undefined;
}

export function vozPadraoDoMotor(motor: MotorNarracao): string {
  return motor === 'kokoro' ? VOZ_PADRAO_KOKORO : VOZ_PADRAO_GEMINI;
}

export function descreverVoz(id: string): string {
  const v = vozConhecida(id);
  return v ? `${v.id} (${v.genero}, ${v.estilo}; ${v.motor === 'kokoro' ? 'Kokoro local, grátis' : 'Gemini, usa token'})` : id;
}
