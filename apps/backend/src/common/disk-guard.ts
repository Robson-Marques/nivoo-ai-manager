import * as fs from 'node:fs';

/**
 * Reservas operacionais. Não apaga dados: o operador escolhe o que limpar.
 * A criação de vídeo precisa de espaço para PNGs, worktree, FFmpeg e artefatos.
 */
export const MIN_FREE_DISK_BYTES = 512 * 1024 * 1024;
export const MIN_FREE_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

export function armazenamentoDisponivel(pastas: string[], minimo = MIN_FREE_DISK_BYTES): { ok: boolean; pasta?: string; livre?: number } {
  for (const pasta of [...new Set(pastas)]) {
    const stat = fs.statfsSync(pasta);
    const livre = stat.bavail * stat.bsize;
    if (livre < minimo) return { ok: false, pasta, livre };
  }
  return { ok: true };
}
