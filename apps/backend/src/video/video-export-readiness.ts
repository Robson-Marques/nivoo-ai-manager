import { StudioEditV1, studioEditToComposition } from './video-studio-bridge';
import { buildRemotionProps, RemotionProps, ResolvedMedia } from './video-remotion-props';
import { requiredRenderFeatures, UNVERIFIED_REMOTION_FEATURES } from './video-render-parity';

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
  // Until a real Remotion composition is bundled, no edit may be exported
  // via this experimental path, even when all edit features are supported.
  blockers.push('Remotion composition bundle and end-to-end export are not yet verified');
  try {
    const composition = studioEditToComposition(edit);
    for (const feature of requiredRenderFeatures(composition)) {
      if (!UNVERIFIED_REMOTION_FEATURES[feature]) blockers.push('Renderer parity not verified: ' + feature);
    }
    const props = buildRemotionProps(composition, media);
    return { ready: false, blockers, props };
  } catch (error) {
    blockers.push('Invalid or unresolved media/composition: ' +
      (error instanceof Error ? error.message : 'unknown error'));
    return { ready: false, blockers };
  }
}
