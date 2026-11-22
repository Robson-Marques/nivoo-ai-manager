import { StudioEditV1, studioEditToComposition } from './video-studio-bridge';
import { buildRemotionProps, RemotionProps, ResolvedMedia } from './video-remotion-props';

export type ExportReadiness = {
  ready: boolean;
  blockers: string[];
  props?: RemotionProps;
};

/**
 * Fail-closed export gate: keep the established Studio exporter active until
 * Remotion can faithfully reproduce every edit feature in a given project.
 * This never starts a renderer or modifies persisted data.
 */
export function assessRemotionExport(
  edit: StudioEditV1,
  media: readonly ResolvedMedia[],
): ExportReadiness {
  const blockers: string[] = [];
  if (edit.protectedZones?.length) blockers.push('Protected zones require renderer parity verification');
  if (edit.captions.some(c => c.animation === 'karaoke' || (c.words?.length ?? 0) > 0)) {
    blockers.push('Karaoke captions require renderer parity verification');
  }
  if (edit.captions.some(c => c.animation && !['none', 'fade', 'slide'].includes(c.animation))) {
    blockers.push('Caption animation requires renderer parity verification');
  }
  if (edit.captions.some(c => c.x !== undefined || c.y !== undefined)) {
    blockers.push('Caption positioning requires renderer parity verification');
  }
  if (edit.assets.some(a => a.x !== undefined || a.y !== undefined || a.w !== undefined || a.h !== undefined)) {
    blockers.push('Image placement requires renderer parity verification');
  }
  if (edit.clips.some(c => c.start > 0 || c.volume !== undefined)) {
    blockers.push('Source trimming and clip volume require renderer parity verification');
  }
  if (edit.audioTracks?.some(a => (a.offset ?? 0) > 0)) {
    blockers.push('Audio offsets require renderer parity verification');
  }
  // Until a real Remotion composition is bundled, no edit may be exported
  // via this experimental path, even when all edit features are supported.
  blockers.push('Remotion composition bundle and end-to-end export are not yet verified');
  try {
    const composition = studioEditToComposition(edit);
    const props = buildRemotionProps(composition, media);
    return { ready: false, blockers, props };
  } catch (error) {
    blockers.push('Invalid or unresolved media/composition: ' +
      (error instanceof Error ? error.message : 'unknown error'));
    return { ready: false, blockers };
  }
}
