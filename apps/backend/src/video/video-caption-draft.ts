import { VideoComposition, validateComposition } from './video-composition';
import { SubtitleCue } from './video-subtitles';

/**
 * Normalize a transcription for review without altering the source composition.
 * This is used before proposing edits, so a transcript can be shown even when
 * the timeline has more cues than the composition layer limit.
 */
export type CaptionDraft = {
  compositionId: string;
  revision: string;
  cues: SubtitleCue[];
  warnings: string[];
};

export function buildCaptionDraft(composition: VideoComposition, cues: readonly SubtitleCue[]): CaptionDraft {
  validateComposition(composition);
  if (!Array.isArray(cues) || cues.length > 5000) throw new Error('Invalid subtitle cues');
  const warnings: string[] = [];
  const sanitized: SubtitleCue[] = [];
  let previousStart = -1;
  for (const cue of cues) {
    if (!cue || typeof cue.id !== 'string' || !/^subtitle-[1-9]\d{0,8}$/.test(cue.id) ||
        typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 5000 ||
        !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) ||
        cue.startMs < 0 || cue.endMs <= cue.startMs || cue.startMs < previousStart) {
      throw new Error('Invalid caption draft cue');
    }
    previousStart = cue.startMs;
    if (cue.startMs >= composition.durationMs) {
      warnings.push('Caption outside timeline: ' + cue.id);
      continue;
    }
    const endMs = Math.min(cue.endMs, composition.durationMs);
    if (endMs !== cue.endMs) warnings.push('Caption trimmed at timeline end: ' + cue.id);
    sanitized.push({ ...cue, endMs });
  }
  if (new Set(sanitized.map(c => c.id)).size !== sanitized.length) throw new Error('Duplicate caption IDs');
  const otherLayers = composition.layers.filter(layer => !layer.id.startsWith('subtitle-')).length;
  if (sanitized.length + otherLayers > 500) {
    warnings.push('Too many captions to apply: split or combine cues before approval');
  }
  return {
    compositionId: composition.id,
    revision: composition.revision,
    cues: sanitized,
    warnings,
  };
}
