import { VideoComposition, validateComposition } from './video-composition';
import { ResolvedMedia } from './video-remotion-props';

export type ProjectMediaRecord = {
  id: string;
  projectId: string;
  assetUrl: string;
  deleted?: boolean;
};

/**
 * Resolve only media owned by the current project. Do not accept client-supplied
 * URLs as the media map for render jobs. The caller must fetch records through
 * its authorized project repository.
 */
export function resolveCompositionMedia(
  composition: VideoComposition,
  projectId: string,
  projectMedia: readonly ProjectMediaRecord[],
): ResolvedMedia[] {
  validateComposition(composition);
  if (!projectId || typeof projectId !== 'string') throw new Error('Invalid project ID');
  const needed = new Set(composition.layers
    .filter(layer => layer.type !== 'text')
    .map(layer => 'mediaId' in layer ? layer.mediaId : ''));
  const found = new Map<string, ResolvedMedia>();
  for (const item of projectMedia) {
    if (!item || item.projectId !== projectId || item.deleted || !needed.has(item.id)) continue;
    if (found.has(item.id)) throw new Error('Duplicate project media ID');
    if (typeof item.assetUrl !== 'string' || !item.assetUrl.startsWith('/') ||
        item.assetUrl.startsWith('//') || item.assetUrl.includes('..') ||
        item.assetUrl.includes('\\') || /[?#]/.test(item.assetUrl) ||
        [...item.assetUrl].some(char => char.charCodeAt(0) < 32)) {
      throw new Error('Invalid project media URL');
    }
    found.set(item.id, { mediaId: item.id, assetUrl: item.assetUrl });
  }
  const missing = [...needed].filter(id => !found.has(id));
  if (missing.length) throw new Error('Missing or unauthorized project media: ' + missing.join(', '));
  return [...found.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId));
}
