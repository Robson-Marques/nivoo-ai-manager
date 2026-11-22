import { VideoComposition, validateComposition } from './video-composition';

/**
 * Compare the editing manifest with the renderer's supported feature set.
 * A missing feature is a hard blocker, never silently dropped on export.
 */
export type RenderFeature =
  | 'source-offset' | 'clip-volume' | 'audio-offset' | 'layer-transform'
  | 'text-style' | 'karaoke' | 'caption-animation' | 'protected-zones';

export type RenderFeatureSupport = Readonly<Record<RenderFeature, boolean>>;

export const UNVERIFIED_REMOTION_FEATURES: RenderFeatureSupport = {
  'source-offset': false,
  'clip-volume': false,
  'audio-offset': false,
  'layer-transform': false,
  'text-style': false,
  karaoke: false,
  'caption-animation': false,
  'protected-zones': false,
};

export function requiredRenderFeatures(composition: VideoComposition): RenderFeature[] {
  validateComposition(composition);
  const features = new Set<RenderFeature>();
  if (composition.protectedZones?.length) features.add('protected-zones');
  for (const layer of composition.layers) {
    if (layer.type === 'video' || layer.type === 'image') {
      if ((layer.sourceOffsetMs ?? 0) > 0) features.add('source-offset');
      if (layer.type === 'video' && layer.volume !== undefined && layer.volume !== 1) features.add('clip-volume');
      if (layer.transform) features.add('layer-transform');
    } else if (layer.type === 'audio') {
      if ((layer.sourceOffsetMs ?? 0) > 0) features.add('audio-offset');
    } else {
      if (layer.transform) features.add('layer-transform');
      if (layer.fontSize !== undefined || layer.color !== undefined) features.add('text-style');
      if (layer.animation === 'karaoke' || layer.words?.length) features.add('karaoke');
      if (layer.animation && layer.animation !== 'none') features.add('caption-animation');
    }
  }
  return [...features].sort();
}

export function assertRendererParity(
  composition: VideoComposition,
  supported: RenderFeatureSupport = UNVERIFIED_REMOTION_FEATURES,
): void {
  const unsupported = requiredRenderFeatures(composition).filter(feature => !supported[feature]);
  if (unsupported.length) throw new Error('Unsupported render features: ' + unsupported.join(', '));
}
