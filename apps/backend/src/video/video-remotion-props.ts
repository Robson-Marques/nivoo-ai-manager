import { VideoComposition, validateComposition } from './video-composition';
import { FramePlan, toFramePlan } from './video-frame-plan';

/**
 * Serialized contract for the future Remotion component.
 * The caller must resolve project-owned media IDs into authorized assets;
 * never accept arbitrary file paths or URLs from client payloads.
 */
export type ResolvedMedia = { mediaId: string; assetUrl: string };
export type RemotionLayer =
  | { id: string; type: 'video' | 'image' | 'audio'; src: string; fromFrame: number; durationInFrames: number; zIndex: number; volume?: number }
  | { id: string; type: 'text'; text: string; animation: 'none' | 'fade' | 'slide' | 'typewriter'; fromFrame: number; durationInFrames: number; zIndex: number };

export type RemotionProps = Pick<FramePlan, 'width' | 'height' | 'fps' | 'durationInFrames'> & {
  compositionId: string;
  revision: string;
  layers: RemotionLayer[];
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
        typeof entry.assetUrl !== 'string' || !entry.assetUrl.startsWith('/')) {
      throw new Error('Invalid resolved media');
    }
    if (assets.has(entry.mediaId)) throw new Error('Duplicate resolved media ID');
    assets.set(entry.mediaId, entry.assetUrl);
  }
  const layers: RemotionLayer[] = plan.layers.map(layer => {
    const base = { id: layer.id, fromFrame: layer.fromFrame, durationInFrames: layer.durationInFrames, zIndex: layer.zIndex };
    if (layer.type === 'text') {
      return { ...base, type: 'text', text: layer.text, animation: layer.animation ?? 'none' };
    }
    const src = assets.get(layer.mediaId);
    if (!src) throw new Error('Unresolved project media: ' + layer.mediaId);
    if (layer.type === 'audio') return { ...base, type: 'audio', src, volume: layer.volume };
    return { ...base, type: layer.type, src };
  });
  return {
    compositionId: plan.compositionId, revision: plan.revision,
    width: plan.width, height: plan.height, fps: plan.fps,
    durationInFrames: plan.durationInFrames, layers,
  };
}
