import { buildRemotionProps } from '../src/video/video-remotion-props';
import { VideoComposition } from '../src/video/video-composition';

describe('Remotion composition props', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'scene', revision: 'v2', width: 1080, height: 1920,
    fps: 30, durationMs: 2000,
    layers: [
      { id: 'title', type: 'text', text: 'Olá', startMs: 0, durationMs: 1000, zIndex: 2, animation: 'slide' },
      { id: 'music', type: 'audio', mediaId: 'audio-1', startMs: 0, durationMs: 2000, zIndex: 1, volume: 0.4 },
    ],
  };

  it('resolves owned media references into renderer inputs', () => {
    const props = buildRemotionProps(composition, [{ mediaId: 'audio-1', assetUrl: '/assets/audio-1.mp3' }]);
    expect(props.durationInFrames).toBe(60);
    expect(props.layers[0]).toMatchObject({ id: 'music', type: 'audio', volume: 0.4, src: '/assets/audio-1.mp3' });
    expect(props.layers[1]).toMatchObject({ id: 'title', animation: 'slide' });
  });

  it('rejects missing and arbitrary media paths', () => {
    expect(() => buildRemotionProps(composition, [])).toThrow('Unresolved');
    expect(() => buildRemotionProps(composition, [
      { mediaId: 'audio-1', assetUrl: 'https://untrusted.example/asset' },
    ])).toThrow('Invalid resolved media');
  });
});
