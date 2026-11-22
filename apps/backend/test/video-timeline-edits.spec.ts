import { VideoComposition } from '../../src/video/video-composition';
import { applyTimelineEdit } from '../../src/video/video-timeline-edits';

describe('atomic video timeline edits', () => {
  const base: VideoComposition = {
    schemaVersion: 1, id: 'scene', revision: 'v1', width: 1080, height: 1920,
    fps: 30, durationMs: 5000,
    layers: [
      { id: 'title', type: 'text', text: 'Original', startMs: 0, durationMs: 2000, zIndex: 1 },
      { id: 'voice', type: 'audio', mediaId: 'voice-1', startMs: 0, durationMs: 4000, zIndex: 0, volume: 1 },
    ],
  };

  it('edits text and animation without mutating the original', () => {
    const edited = applyTimelineEdit(base, { kind: 'set-text', layerId: 'title', text: 'Novo' });
    const animated = applyTimelineEdit(edited, { kind: 'set-animation', layerId: 'title', animation: 'slide' });
    expect(animated.layers[0]).toMatchObject({ text: 'Novo', animation: 'slide' });
    expect(base.layers[0]).toMatchObject({ text: 'Original' });
  });

  it('supports move, trim, remove and volume updates', () => {
    const moved = applyTimelineEdit(base, { kind: 'move', layerId: 'title', startMs: 500 });
    expect(moved.layers[0].startMs).toBe(500);
    const trimmed = applyTimelineEdit(moved, { kind: 'trim', layerId: 'title', durationMs: 1000 });
    expect(trimmed.layers[0].durationMs).toBe(1000);
    expect(applyTimelineEdit(trimmed, { kind: 'remove', layerId: 'title' }).layers).toHaveLength(1);
    const volume = applyTimelineEdit(base, { kind: 'set-volume', layerId: 'voice', volume: 0.5 });
    expect(volume.layers[1]).toMatchObject({ volume: 0.5 });
  });

  it('rejects invalid edits without changing source state', () => {
    expect(() => applyTimelineEdit(base, { kind: 'move', layerId: 'title', startMs: 4500 })).toThrow();
    expect(() => applyTimelineEdit(base, { kind: 'set-volume', layerId: 'title', volume: 1 })).toThrow();
    expect(() => applyTimelineEdit(base, { kind: 'remove', layerId: 'missing' })).toThrow();
    expect(base.layers).toHaveLength(2);
  });
});
