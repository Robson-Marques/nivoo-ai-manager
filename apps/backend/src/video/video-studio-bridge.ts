import { VideoComposition, VideoLayer, validateComposition } from './video-composition';

/**
 * Read-only projection of the existing VideoStudio v1 edit format.
 * This does not change the persisted Studio format or its export pipeline.
 * Clip start/end are source trim points; duration is timeline length.
 * WARNING: the portable composition model still lacks karaoke word timings,
 * protected zones, and several animation modes. This is NOT a lossless export.
 */
export type StudioEditV1 = {
  version: 1;
  id: string;
  updatedAt: string;
  clips: Array<{ id: string; source: string; start: number; end: number; duration: number; volume?: number }>;
  captions: Array<{ id: string; text: string; start: number; end: number; animation?: string; x?: number; y?: number; fontSize?: number; color?: string }>;
  assets: Array<{ id: string; source: string; start: number; end: number; x?: number; y?: number; w?: number; h?: number }>;
  audioTracks?: Array<{ id: string; source: string; start: number; end: number; offset?: number; volume: number }>;
  soundtrack?: { source: string; volume: number } | null;
};

export function studioEditToComposition(
  edit: StudioEditV1,
  width = 1080,
  height = 1920,
  fps = 30,
): VideoComposition {
  if (!edit || edit.version !== 1 || !Array.isArray(edit.clips) ||
      !Array.isArray(edit.captions) || !Array.isArray(edit.assets)) {
    throw new Error('Invalid Studio edit');
  }
  const ms = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid Studio timing');
    return Math.round(seconds * 1000);
  };
  const durationMs = edit.clips.reduce((total, clip) => total + ms(clip.duration), 0);
  if (durationMs < 1 || durationMs > 3_600_000) throw new Error('Invalid Studio duration');
  const layers: VideoLayer[] = [];
  let cursor = 0;
  for (const clip of edit.clips) {
    const duration = ms(clip.duration);
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
        clip.start < 0 || clip.end <= clip.start || duration < 1 ||
        Math.abs((clip.end - clip.start) * 1000 - duration) > 100) {
      throw new Error('Invalid Studio clip trim');
    }
    layers.push({ id: clip.id, type: 'video', mediaId: clip.source,
      startMs: cursor, durationMs: duration, zIndex: 0,
      sourceOffsetMs: ms(clip.start), volume: clip.volume ?? 1 });
    cursor += duration;
  }
  for (const caption of edit.captions) {
    layers.push({ id: caption.id, type: 'text', text: caption.text,
      startMs: ms(caption.start), durationMs: ms(caption.end) - ms(caption.start),
      zIndex: 900, animation: caption.animation === 'fade' ? 'fade' :
        caption.animation === 'slide' ? 'slide' : 'none',
      ...(caption.x !== undefined && caption.y !== undefined ? {
        transform: { x: caption.x, y: caption.y, width: 100, height: 20 },
      } : {}),
      ...(caption.fontSize !== undefined ? { fontSize: caption.fontSize } : {}),
      ...(caption.color !== undefined ? { color: caption.color } : {}),
    });
  }
  for (const asset of edit.assets) {
    layers.push({ id: asset.id, type: 'image', mediaId: asset.source,
      startMs: ms(asset.start), durationMs: ms(asset.end) - ms(asset.start), zIndex: 200,
      ...(asset.x !== undefined && asset.y !== undefined && asset.w !== undefined && asset.h !== undefined ? {
        transform: { x: asset.x, y: asset.y, width: asset.w, height: asset.h },
      } : {}),
    });
  }
  for (const audio of edit.audioTracks ?? []) {
    layers.push({ id: audio.id, type: 'audio', mediaId: audio.source,
      startMs: ms(audio.start), durationMs: ms(audio.end) - ms(audio.start),
      zIndex: 0, volume: audio.volume,
      sourceOffsetMs: ms(audio.offset ?? 0) });
  }
  if (edit.soundtrack) {
    layers.push({ id: 'studio-soundtrack', type: 'audio', mediaId: edit.soundtrack.source,
      startMs: 0, durationMs, zIndex: -1, volume: edit.soundtrack.volume });
  }
  const composition: VideoComposition = {
    schemaVersion: 1, id: edit.id, revision: edit.updatedAt,
    width, height, fps, durationMs, layers,
  };
  validateComposition(composition);
  return composition;
}
