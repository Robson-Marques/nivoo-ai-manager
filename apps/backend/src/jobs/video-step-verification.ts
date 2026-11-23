import { caminhoDoProjeto } from '../common/path-guard';

/**
 * Verifica o MP4 produzido por uma etapa, sem IA e sem renderizar de novo.
 * Mantém conferências explícitas do plano e complementa verificações fracas
 * como "true" e "test -s" com inspeção do stream real de vídeo/áudio.
 */
export function conferenciaTecnicaDeVideo(
  provider: string,
  instructions: string,
  opts: Record<string, unknown>,
  verifyCommand?: string,
): string | undefined {
  let arquivo: string | null = null;
  if (provider === 'local-shell' && /\bnivoo-renderizar-motion\b/.test(instructions)) {
    const saida = /--saida\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(instructions);
    const candidato = saida?.[1] ?? saida?.[2] ?? saida?.[3] ?? '';
    if (/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/i.test(candidato)) arquivo = candidato;
  } else if (provider === 'juntar-videos') {
    const candidato = typeof opts.arquivo === 'string' ? caminhoDoProjeto(opts.arquivo) : null;
    if (candidato && /\.mp4$/i.test(candidato)) arquivo = candidato;
  }
  if (!arquivo) return verifyCommand;

  const quoted = "'" + arquivo.replace(/'/g, "'\\''") + "'";
  const video = `test -s ${quoted} && test -n "$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 ${quoted})"`;
  const exigeAudio = provider === 'juntar-videos' && !!(opts.trilha || opts.narracao);
  const tecnico = exigeAudio
    ? video + ` && test -n "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 ${quoted})"`
    : video;

  const custom = verifyCommand?.trim();
  if (!custom || /^(?:true|:)\s*;?$/.test(custom)) return tecnico;
  // A verificação do usuário continua obrigatória, e a do vídeo complementa-a.
  // Não acrescenta outro ffprobe se a própria conferência já inspeciona o arquivo.
  if (/\bffprobe\b/.test(custom) && custom.includes(arquivo)) return verifyCommand;
  return `(${custom}) && ${tecnico}`;
}
