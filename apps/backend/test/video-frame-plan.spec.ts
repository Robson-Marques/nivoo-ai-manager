import { VideoComposition } from '../src/video/video-composition';
import { previewFrame, toFramePlan } from '../src/video/video-frame-plan';

describe('video frame plan', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'scene', revision: 'v1', width: 1080, height: 1920,
    fps: 30, durationMs: 2000,
    layers: [
      { id: 'text', type: 'text', text: 'Olá mundo', startMs: 500, durationMs: 1000, zIndex: 2, animation: 'fade' },
      { id: 'bg', type: 'image', mediaId: 'image-1', startMs: 0, durationMs: 2000, zIndex: 0 },
    ],
  };

  it('converts milliseconds into bounded frame intervals', () => {
    const plan = toFramePlan(composition);
    expect(plan.durationInFrames).toBe(60);
    expect(plan.layers.map(l => l.id)).toEqual(['bg', 'text']);
    expect(plan.layers.find(l => l.id === 'text')).toMatchObject({ fromFrame: 15, durationInFrames: 30 });
  });

  it('produces a preview state without a video render', () => {
    const plan = toFramePlan(composition);
    expect(previewFrame(plan, 0).map(l => l.id)).toEqual(['bg']);
    const start = previewFrame(plan, 15).find(l => l.id === 'text');
    expect(start?.opacity).toBe(0);
    const later = previewFrame(plan, 24).find(l => l.id === 'text');
    expect(later?.opacity).toBe(1);
    expect(previewFrame(plan, 60)).toEqual([]);
  });

  it('handles very short layers without zero-frame output', () => {
    const short: VideoComposition = { ...composition, layers: [
      { id: 'flash', type: 'text', text: '!', startMs: 0, durationMs: 1, zIndex: 0, animation: 'typewriter' },
    ] };
    expect(toFramePlan(short).layers[0].durationInFrames).toBe(1);
  });
});
