import * as path from 'node:path';
import { caminhoDoProjeto } from '../../common/path-guard';

/**
 * Plano com duas ou mais cenas de vídeo ganha, sozinho, a etapa final que junta tudo num vídeo só (o Omni
 * gera de 4 a 8 s por vez; quem pediu o vídeo quer o vídeo inteiro). Se o plano já tem a etapa, nada muda.
 * Nome do final: `<pasta das cenas>/<pasta>-completo.mp4` (ex.: videos/pizzaria/pizzaria-completo.mp4).
 */
export function comVideoCompleto(entrada: unknown, defaultProvider: string): unknown {
  if (!Array.isArray(entrada)) return entrada;
  let raw: any[] = entrada;
  if (raw.some((s: any) => (s?.provider ?? defaultProvider) === 'juntar-videos')) return raw;
  let cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  if (cenas.length < 2) return raw;
  // Com trilha de fundo, as cenas vêm SEM música própria (só falas e sons do ambiente): a música corre única,
  // de ponta a ponta, na montagem.
  const trilha = cenas.map((s: any) => s.providerOptions?.trilha).find((t: unknown) => t);
  const narracao = cenas.map((s: any) => s.providerOptions?.narracao).find((n: unknown) => n);
  if (trilha) {
    raw = raw.map((s: any) => (cenas.includes(s) ? { ...s, providerOptions: { ...(s.providerOptions ?? {}), semMusica: true } } : s));
    cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  }
  if (narracao) {
    raw = raw.map((s: any) => (cenas.includes(s) ? { ...s, providerOptions: { ...(s.providerOptions ?? {}), semAudio: true } } : s));
    cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  }
  const arquivos = cenas.map((s: any) => caminhoDoProjeto(s.providerOptions?.arquivo ?? `videos/${s.key}.mp4`));
  if (arquivos.some((a) => !a)) return raw; // a validação da cena aponta o erro
  const pastas = [...new Set(arquivos.map((a) => path.posix.dirname(a as string)))];
  const pasta = pastas.length === 1 && pastas[0] !== '.' ? pastas[0] : 'videos';
  const nome = pasta === 'videos' ? 'video' : path.posix.basename(pasta);
  let arquivo = `${pasta}/${nome}-completo.mp4`;
  for (let n = 2; arquivos.includes(arquivo); n++) arquivo = `${pasta}/${nome}-completo-${n}.mp4`;
  const chaves = new Set(raw.map((s: any) => String(s?.key)));
  let key = 'video-completo';
  for (let n = 2; chaves.has(key); n++) key = `video-completo-${n}`;
  return [
    ...raw,
    {
      key,
      title: 'Juntar as cenas no vídeo completo',
      provider: 'juntar-videos',
      instructions: `Junta as ${cenas.length} cenas, na ordem, em ${arquivo}.`,
      dependsOn: cenas.map((s: any) => s.key),
      providerOptions: {
        cenas: arquivos,
        arquivo,
        // Legenda de cada cena (se o plano trouxe) e a transição escolhida em cada cena para a seguinte.
        ...(cenas.some((s: any) => String(s.providerOptions?.legenda ?? '').trim()) ? { legendas: cenas.map((s: any) => String(s.providerOptions?.legenda ?? '').trim()) } : {}),
        ...(cenas.some((s: any) => s.providerOptions?.transicao) ? { transicoes: cenas.slice(0, -1).map((s: any) => String(s.providerOptions?.transicao ?? 'fade')) } : {}),
        ...(trilha ? { trilha } : {}),
        ...(narracao ? { narracao, volumeCenas: 0 } : {}),
      },
    },
  ];
}
