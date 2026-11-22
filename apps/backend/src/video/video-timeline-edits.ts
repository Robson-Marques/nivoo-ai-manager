import { VideoComposition, VideoLayer, validateComposition } from './video-composition';

export type TimelineEdit =
  | { kind: 'move'; layerId: string; startMs: number }
  | { kind: 'trim'; layerId: string; durationMs: number }
  | { kind: 'remove'; layerId: string }
  | { kind: 'add'; layer: VideoLayer }
  | { kind: 'set-text'; layerId: string; text: string }
  | { kind: 'set-animation'; layerId: string; animation: 'none' | 'fade' | 'slide' | 'typewriter' }
  | { kind: 'set-volume'; layerId: string; volume: number };

/**
 * Atomic edit: returns a new composition or throws without mutating the original.
 * Revision is supplied by the persistence layer to avoid client-side race conditions.
 */
export function applyTimelineEdit(composition: VideoComposition, edit: TimelineEdit): VideoComposition {
  validateComposition(composition);
  let found = false;
  let layers: VideoLayer[];
  if (edit.kind === 'add') {
    layers = [...composition.layers, { ...edit.layer }];
  } else {
    layers = composition.layers.flatMap(layer => {
      if (layer.id !== edit.layerId) return [layer];
      found = true;
      switch (edit.kind) {
        case 'remove': return [];
        case 'move': return [{ ...layer, startMs: edit.startMs }];
        case 'trim': return [{ ...layer, durationMs: edit.durationMs }];
        case 'set-text':
          if (layer.type !== 'text') throw new Error('Layer is not text');
          return [{ ...layer, text: edit.text }];
        case 'set-animation':
          if (layer.type !== 'text') throw new Error('Layer is not text');
          return [{ ...layer, animation: edit.animation }];
        case 'set-volume':
          if (layer.type !== 'audio') throw new Error('Layer is not audio');
          return [{ ...layer, volume: edit.volume }];
      }
    });
    if (!found) throw new Error('Layer not found');
  }
  const updated: VideoComposition = { ...composition, layers };
  validateComposition(updated);
  return updated;
}
