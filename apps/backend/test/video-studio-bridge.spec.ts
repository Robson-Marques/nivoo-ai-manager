import { studioEditToComposition, StudioEditV1 } from '../src/video/video-studio-bridge';

describe('existing Studio edit bridge', () => {
  const edit: StudioEditV1 = {
    version: 1, id: 'edit-1', updatedAt: '2026-11-22T00:00:00Z',
    clips: [
      { id: 'clip-1', source: 'media/one.mp4', start: 2, end: 5, duration: 3, volume: 0.8 },
      { id: 'clip-2', source: 'media/two.mp4', start: 0, end: 2, duration: 2 },
    ],
    captions: [{ id: 'caption-1', text: 'Olá', start: 1, end: 2, animation: 'karaoke', words: [{ text: 'Olá', start: 1, end: 1.5 }], x: 15, y: 80, fontSize: 42, color: '#ffffff' }],
    assets: [{ id: 'asset-1', source: 'media/logo.png', start: 0, end: 5, x: 10, y: 20, w: 30, h: 40 }],
    audioTracks: [{ id: 'voice-1', source: 'media/voice.mp3', start: 0, end: 5, offset: 1.2, volume: 0.7 }],
    soundtrack: { source: 'media/music.mp3', volume: 0.2 },
    protectedZones: [{ id: 'face-1', label: 'Rosto', start: 0, end: 5, x: 10, y: 10, w: 20, h: 20 }],
  };

  it('projects sequential clips and overlays without mutating the original edit', () => {
    const result = studioEditToComposition(edit);
    expect(result.durationMs).toBe(5000);
    expect(result.layers.find(x => x.id === 'clip-1')).toMatchObject({ startMs: 0, durationMs: 3000, sourceOffsetMs: 2000, volume: 0.8 });
    expect(result.layers.find(x => x.id === 'clip-2')).toMatchObject({ startMs: 3000, durationMs: 2000 });
    expect(result.layers.find(x => x.id === 'caption-1')).toMatchObject({ startMs: 1000, durationMs: 1000, fontSize: 42, color: '#ffffff', transform: { x: 15, y: 80, width: 100, height: 20 } });
    expect(result.layers.find(x => x.id === 'asset-1')).toMatchObject({ transform: { x: 10, y: 20, width: 30, height: 40 } });
    expect(result.layers.find(x => x.id === 'voice-1')).toMatchObject({ sourceOffsetMs: 1200 });
    expect(result.layers.find(x => x.id === 'caption-1')).toMatchObject({ animation: 'karaoke', words: [{ text: 'Olá', startMs: 1000, endMs: 1500 }] });
    expect(result.protectedZones).toMatchObject([{ id: 'face-1', width: 20, height: 20, durationMs: 5000 }]);
    expect(result.layers.find(x => x.id === 'studio-soundtrack')).toMatchObject({ type: 'audio', volume: 0.2 });
    expect(edit.clips[0].start).toBe(2);
  });

  it('rejects inconsistent source trim and duration', () => {
    expect(() => studioEditToComposition({
      ...edit, clips: [{ ...edit.clips[0], duration: 8 }],
    })).toThrow('clip trim');
  });

  it('rejects overlays extending beyond the timeline', () => {
    expect(() => studioEditToComposition({
      ...edit, captions: [{ id: 'caption-1', text: 'late', start: 4, end: 7 }],
    })).toThrow('layer timing');
  });
});
