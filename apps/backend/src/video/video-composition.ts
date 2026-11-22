/**
 * Portable video composition manifest.
 * Keeps editing state independent of the preview/render engine.
 */
export type VideoLayer =
  | { id: string; type: 'video' | 'image'; mediaId: string; startMs: number; durationMs: number; zIndex: number }
  | { id: string; type: 'text'; text: string; startMs: number; durationMs: number; zIndex: number; animation?: 'none' | 'fade' | 'slide' | 'typewriter' }
  | { id: string; type: 'audio'; mediaId: string; startMs: number; durationMs: number; zIndex: number; volume: number };

export interface VideoComposition {
  schemaVersion: 1;
  id: string;
  revision: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  layers: VideoLayer[];
}

export function validateComposition(value: VideoComposition): void {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) throw new Error('Unsupported composition schema');
  const name = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f]/.test(v);
  if (!name(value.id) || !name(value.revision)) throw new Error('Invalid composition identity');
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) ||
      value.width < 16 || value.height < 16 || value.width > 8192 || value.height > 8192) {
    throw new Error('Invalid canvas dimensions');
  }
  if (!Number.isInteger(value.fps) || value.fps < 1 || value.fps > 120 ||
      !Number.isInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > 3_600_000) {
    throw new Error('Invalid composition timing');
  }
  if (!Array.isArray(value.layers) || value.layers.length > 500) throw new Error('Too many layers');
  const ids = new Set<string>();
  for (const layer of value.layers) {
    if (!layer || !name(layer.id) || ids.has(layer.id)) throw new Error('Invalid or duplicate layer ID');
    ids.add(layer.id);
    if (!Number.isInteger(layer.startMs) || !Number.isInteger(layer.durationMs) ||
        layer.startMs < 0 || layer.durationMs <= 0 ||
        layer.startMs + layer.durationMs > value.durationMs ||
        !Number.isInteger(layer.zIndex) || layer.zIndex < -1000 || layer.zIndex > 1000) {
      throw new Error('Invalid layer timing or stacking');
    }
    switch (layer.type) {
      case 'video':
      case 'image':
        if (!name(layer.mediaId)) throw new Error('Invalid media reference');
        break;
      case 'audio':
        if (!name(layer.mediaId) || !Number.isFinite(layer.volume) || layer.volume < 0 || layer.volume > 2) {
          throw new Error('Invalid audio layer');
        }
        break;
      case 'text':
        if (typeof layer.text !== 'string' || layer.text.length > 5000 ||
            !['none', 'fade', 'slide', 'typewriter'].includes(layer.animation ?? 'none')) {
          throw new Error('Invalid text layer');
        }
        break;
      default:
        throw new Error('Unknown layer type');
    }
  }
}

/** Pure timeline projection shared by preview, inspector and render planning. */
export function activeLayersAt(composition: VideoComposition, timeMs: number): VideoLayer[] {
  validateComposition(composition);
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs >= composition.durationMs) return [];
  return composition.layers.filter(layer =>
    layer.startMs <= timeMs && timeMs < layer.startMs + layer.durationMs,
  ).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}
