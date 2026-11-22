import { VideoComposition, validateComposition } from './video-composition';
import { FramePlan, toFramePlan } from './video-frame-plan';

/**
 * Serialized contract for the future Remotion component.
 * The caller must resolve project-owned media IDs into authorized assets;
 * never accept arbitrary file paths or URLs from client payloads.
 */
export type ResolvedMedia = { mediaId: string; assetUrl: string };
export type RemotionLayer =
  | { id: string; type: 'video' | 'image' | 'audio'; src: string; fromFrame: number; durationInFrames: number; zIndex: number; volume?: number; sourceOffsetMs?: number; loop?: boolean; animation?: 'none' | 'fade' | 'slide'; transform?: { x: number; y: number; width: number; height: number } }
  | { id: string; type: 'text'; text: string; animation: 'none' | 'fade' | 'slide' | 'typewriter' | 'pop' | 'rise' | 'enter-left' | 'enter-right' | 'karaoke'; words?: Array<{ text: string; startMs: number; endMs: number }>; fromFrame: number; durationInFrames: number; zIndex: number; transform?: { x: number; y: number; width: number; height: number }; fontSize?: number; color?: string };

export type RemotionProps = Pick<FramePlan, 'width' | 'height' | 'fps' | 'durationInFrames'> & {
  compositionId: string;
  revision: string;
  layers: RemotionLayer[];
  protectedZones?: VideoComposition['protectedZones'];
};

export function buildRemotionProps(
  composition: VideoComposition,
  media: readonly ResolvedMedia[],
): RemotionProps {
  validateComposition(composition);
  const plan = toFramePlan(composition);
  const assets = new Map<string, string>();
  for (const entry of media) {
    if (!entry || typeof entry.mediaId !== 'string' || !entry.mediaId ||
        typeof entry.assetUrl !== 'string' || !entry.assetUrl.startsWith('/') || entry.assetUrl.startsWith('//') ||
        entry.assetUrl.includes(String.fromCharCode(92)) || entry.assetUrl.includes('..') ||
        /[?#]/.test(entry.assetUrl) || [...entry.assetUrl].some(ch => ch.charCodeAt(0) < 32)) {
      throw new Error('Invalid resolved media');
    }
    if (assets.has(entry.mediaId)) throw new Error('Duplicate resolved media ID');
    assets.set(entry.mediaId, entry.assetUrl);
  }
  const layers: RemotionLayer[] = plan.layers.map(layer => {
    const base = { id: layer.id, fromFrame: layer.fromFrame, durationInFrames: layer.durationInFrames, zIndex: layer.zIndex };
    if (layer.type === 'text') {
      return { ...base, type: 'text', text: layer.text, animation: layer.animation ?? 'none',
        ...(layer.words ? { words: layer.words } : {}),
        ...(layer.transform ? { transform: layer.transform } : {}),
        ...(layer.fontSize !== undefined ? { fontSize: layer.fontSize } : {}),
        ...(layer.color ? { color: layer.color } : {}),
      };
    }
    const src = assets.get(layer.mediaId);
    if (!src) throw new Error('Unresolved project media: ' + layer.mediaId);
    if (layer.type === 'audio') return { ...base, type: 'audio', src, volume: layer.volume,
      ...(layer.loop ? { loop: true } : {}),
      ...(layer.sourceOffsetMs !== undefined ? { sourceOffsetMs: layer.sourceOffsetMs } : {}) };
    return { ...base, type: layer.type, src,
      ...(layer.sourceOffsetMs !== undefined ? { sourceOffsetMs: layer.sourceOffsetMs } : {}),
      ...(layer.volume !== undefined ? { volume: layer.volume } : {}),
      ...(layer.animation ? { animation: layer.animation } : {}),
      ...(layer.transform ? { transform: layer.transform } : {}),
    };
  });
  return {
    compositionId: plan.compositionId, revision: plan.revision,
    width: plan.width, height: plan.height, fps: plan.fps,
    durationInFrames: plan.durationInFrames, layers,
    ...(composition.protectedZones ? { protectedZones: composition.protectedZones } : {}),
  };
}
