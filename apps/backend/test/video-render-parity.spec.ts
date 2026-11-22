import { assertRendererParity, requiredRenderFeatures, UNVERIFIED_REMOTION_FEATURES } from '../src/video/video-render-parity';
import { VideoComposition } from '../src/video/video-composition';

describe('render feature parity', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'video', revision: 'r1', width: 1080, height: 1920,
    fps: 30, durationMs: 5000,
    layers: [
      { id: 'clip', type: 'video', mediaId: 'video.mp4', startMs: 0, durationMs: 5000,
        zIndex: 0, sourceOffsetMs: 1000, volume: 0.8 },
      { id: 'caption', type: 'text', text: 'Olá', startMs: 0, durationMs: 2000,
        zIndex: 100, animation: 'karaoke',
        words: [{ text: 'Olá', startMs: 0, endMs: 1000 }] },
    ],
    protectedZones: [{ id: 'face', label: 'Face', startMs: 0, durationMs: 5000,
      x: 10, y: 10, width: 20, height: 20 }],
  };
  it('detects edit features that a renderer must support', () => {
    expect(requiredRenderFeatures(composition)).toEqual([
      'caption-animation', 'clip-volume', 'karaoke', 'protected-zones', 'source-offset',
    ]);
  });
  it('fails closed for unverified effects', () => {
    expect(() => assertRendererParity(composition)).toThrow('Unsupported render features');
  });
  it('allows a fully declared feature set, without claiming end-to-end verification', () => {
    const supported = Object.fromEntries(
      Object.keys(UNVERIFIED_REMOTION_FEATURES).map(key => [key, true]),
    ) as unknown as typeof UNVERIFIED_REMOTION_FEATURES;
    expect(() => assertRendererParity(composition, supported)).not.toThrow();
  });
  it('requires no advanced effects for a basic composition', () => {
    const simple: VideoComposition = {
      ...composition, protectedZones: [], layers: [
        { id: 'clip', type: 'video', mediaId: 'video.mp4', startMs: 0, durationMs: 5000, zIndex: 0 },
      ],
    };
    expect(requiredRenderFeatures(simple)).toEqual([]);
  });
});
