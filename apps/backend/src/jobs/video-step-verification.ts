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
  let tecnico = exigeAudio
    ? video + ` && test -n "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 ${quoted})"`
    : video;
  if (provider === 'local-shell') {
    // O render deve entregar as dimensões e a duração que o comando prometeu.
    // São verificações locais rápidas; não renderizam nem revisam artisticamente.
    const tamanho = /--tamanho\s+(\d{2,5})x(\d{2,5})/.exec(instructions);
    if (tamanho) {
      const esperado = `${tamanho[1]}x${tamanho[2]}`;
      tecnico += ` && test "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 ${quoted})" = '${esperado}'`;
    }
    const segundos = /--segundos\s+(\d+(?:\.\d+)?)/.exec(instructions);
    if (segundos) {
      tecnico += ` && awk -v duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${quoted})" -v target=${segundos[1]} 'BEGIN { exit (duration + 0 >= target - 0.6 && duration + 0 <= target + 0.6 ? 0 : 1) }'`;
    }
  }

  const custom = verifyCommand?.trim();
  if (!custom || /^(?:true|:)\s*;?$/.test(custom)) return tecnico;
  // A verificação declarada pelo plano continua obrigatória, mesmo se já chamar ffprobe.
  // O contrato mínimo de MP4, áudio, resolução e duração não pode ser contornado.
  return `(${custom}) && ${tecnico}`;
}
