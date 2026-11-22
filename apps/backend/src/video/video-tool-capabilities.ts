import { StudioEditV1 } from './video-studio-bridge';

/**
 * Deterministic, side-effect-free inventory for editor capability checks.
 * UI can show tool availability without retrying failed operations or
 * repeatedly prompting the AI to do the same work.
 */
export type VideoToolCapability = {
  id: 'remotion' | 'hyperframes' | 'whisper' | 'yt-dlp';
  label: string;
  status: 'experimental' | 'blocked' | 'available';
  reason: string;
};

export function describeVideoToolCapabilities(edit: StudioEditV1): VideoToolCapability[] {
  const hasClips = Array.isArray(edit.clips) && edit.clips.length > 0;
  return [
    {
      id: 'remotion', label: 'Remotion', status: 'experimental',
      reason: 'Composição e exportação ainda exigem validação de paridade com o Studio',
    },
    {
      id: 'hyperframes', label: 'HyperFrames', status: 'experimental',
      reason: 'Prévia de motion com modelos autorizados integrada ao Studio; catálogo externo e skills dos agentes ainda não conectados',
    },
    {
      id: 'whisper', label: 'Whisper', status: hasClips ? 'experimental' : 'blocked',
      reason: hasClips
        ? 'Transcrição e revisão implementadas; falta conexão com a fila e a interface'
        : 'Adicione um vídeo à timeline antes de transcrever',
    },
    {
      id: 'yt-dlp', label: 'yt-dlp', status: 'blocked',
      reason: 'Importação remota desativada até isolamento de rede e verificação de autorização',
    },
  ];
}
