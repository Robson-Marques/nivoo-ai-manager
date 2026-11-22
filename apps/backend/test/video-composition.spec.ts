import { activeLayersAt, validateComposition, VideoComposition } from '../../src/video/video-composition';

describe('video composition manifest', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'demo', revision: '1', width: 1080, height: 1920,
    fps: 30, durationMs: 10_000,
    layers: [
      { id: 'background', type: 'video', mediaId: 'clip-1', startMs: 0, durationMs: 10_000, zIndex: 0 },
      { id: 'headline', type: 'text', text: 'Olá!', startMs: 1000, durationMs: 3000, zIndex: 2, animation: 'fade' },
      { id: 'voice', type: 'audio', mediaId: 'voice-1', startMs: 0, durationMs: 8000, zIndex: 1, volume: 1 },
    ],
  };

  it('validates a layered composition', () => {
    expect(() => validateComposition(composition)).not.toThrow();
  });

  it('shows active layers ordered by z-index', () => {
    expect(activeLayersAt(composition, 1500).map(layer => layer.id))
      .toEqual(['background', 'voice', 'headline']);
    expect(activeLayersAt(composition, 9000).map(layer => layer.id))
      .toEqual(['background']);
  });

  it('rejects overlapping identities and out-of-range timing', () => {
    expect(() => validateComposition({ ...composition, layers: [
      composition.layers[0], { ...composition.layers[0] },
    ] })).toThrow();
    expect(() => validateComposition({ ...composition, layers: [
      { ...composition.layers[0], durationMs: 11_000 },
    ] })).toThrow();
  });

  it('rejects invalid audio levels and unsupported text animations', () => {
    expect(() => validateComposition({ ...composition, layers: [
      { id: 'audio', type: 'audio', mediaId: 'x', startMs: 0, durationMs: 100, zIndex: 0, volume: 9 },
    ] })).toThrow();
    expect(() => validateComposition({ ...composition, layers: [
      { id: 'text', type: 'text', text: 'x', startMs: 0, durationMs: 100, zIndex: 0, animation: 'unknown' },
    ] } as unknown as VideoComposition)).toThrow();
  });
});
