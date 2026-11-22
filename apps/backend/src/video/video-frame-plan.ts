import { VideoComposition, VideoLayer, validateComposition } from './video-composition';

/**
 * Deterministic frame schedule for a Remotion renderer or editor preview.
 * No filesystem paths or external URLs are accepted in this representation.
 * The media resolver must map mediaId to authorized project assets.
 */
export type FrameLayer = VideoLayer & {
  fromFrame: number;
  durationInFrames: number;
};

export type FramePlan = {
  compositionId: string;
  revision: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  layers: FrameLayer[];
};

export function toFramePlan(composition: VideoComposition): FramePlan {
  validateComposition(composition);
  const toFrame = (ms: number) => Math.round(ms * composition.fps / 1000);
  const total = Math.max(1, toFrame(composition.durationMs));
  return {
    compositionId: composition.id,
    revision: composition.revision,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: total,
    layers: composition.layers.map(layer => {
      const fromFrame = Math.min(total - 1, toFrame(layer.startMs));
      const endFrame = Math.min(total, Math.max(fromFrame + 1, toFrame(layer.startMs + layer.durationMs)));
      return { ...layer, fromFrame, durationInFrames: endFrame - fromFrame };
    }).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)),
  };
}

export type PreviewLayer = {
  id: string;
  type: VideoLayer['type'];
  zIndex: number;
  progress: number;
  opacity: number;
  offsetY: number;
  visibleCharacters?: number;
};

/** Lightweight, pure visual state for a still-frame preview; not a renderer. */
export function previewFrame(plan: FramePlan, frame: number): PreviewLayer[] {
  if (!Number.isInteger(frame) || frame < 0 || frame >= plan.durationInFrames) return [];
  return plan.layers.filter(layer =>
    frame >= layer.fromFrame && frame < layer.fromFrame + layer.durationInFrames,
  ).map(layer => {
    const local = frame - layer.fromFrame;
    const progress = layer.durationInFrames <= 1 ? 1 : local / (layer.durationInFrames - 1);
    const easeIn = Math.min(1, local / Math.max(1, Math.round(plan.fps * 0.3)));
    const animation = layer.type === 'text' ? (layer.animation ?? 'none') : 'none';
    return {
      id: layer.id, type: layer.type, zIndex: layer.zIndex, progress,
      opacity: animation === 'fade' ? easeIn : 1,
      offsetY: animation === 'slide' ? (1 - easeIn) * 40 : 0,
      ...(animation === 'typewriter' && layer.type === 'text'
        ? { visibleCharacters: Math.min(layer.text.length, Math.ceil(layer.text.length * progress)) }
        : {}),
    };
  });
}
