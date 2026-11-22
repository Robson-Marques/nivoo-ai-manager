import { VideoComposition, VideoLayer, validateComposition } from './video-composition';
import { SubtitleCue } from './video-subtitles';

/**
 * Replaces only the caption layer IDs managed by Whisper. All other layers,
 * including manually authored titles and voice/music tracks, remain untouched.
 * Callers should present the result for review before saving it.
 */
export function applySubtitleCues(
  composition: VideoComposition,
  cues: readonly SubtitleCue[],
): VideoComposition {
  validateComposition(composition);
  const available = 500 - composition.layers.filter(layer => !layer.id.startsWith('subtitle-')).length;
  if (!Array.isArray(cues) || cues.length > available) throw new Error('Too many captions for composition');
  const retained = composition.layers.filter(layer => !layer.id.startsWith('subtitle-'));
  const added: VideoLayer[] = cues.map(cue => {
    if (!cue || !/^subtitle-\d+$/.test(cue.id) || typeof cue.text !== 'string' ||
        !Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) ||
        cue.startMs < 0 || cue.endMs <= cue.startMs || cue.endMs > composition.durationMs) {
      throw new Error('Invalid subtitle cue');
    }
    return {
      id: cue.id, type: 'text', text: cue.text,
      startMs: cue.startMs, durationMs: cue.endMs - cue.startMs,
      zIndex: 900, animation: 'fade',
    };
  });
  const result: VideoComposition = { ...composition, layers: [...retained, ...added] };
  validateComposition(result);
  return result;
}
