import { studioEditToComposition, StudioEditV1 } from '../src/video/video-studio-bridge';

describe('existing Studio edit bridge', () => {
  const edit: StudioEditV1 = {
    version: 1, id: 'edit-1', updatedAt: '2026-11-22T00:00:00Z',
    clips: [
      { id: 'clip-1', source: 'media/one.mp4', start: 2, end: 5, duration: 3 },
      { id: 'clip-2', source: 'media/two.mp4', start: 0, end: 2, duration: 2 },
    ],
    captions: [{ id: 'caption-1', text: 'Olá', start: 1, end: 2, animation: 'fade' }],
    assets: [{ id: 'asset-1', source: 'media/logo.png', start: 0, end: 5 }],
    audioTracks: [{ id: 'voice-1', source: 'media/voice.mp3', start: 0, end: 5, volume: 0.7 }],
    soundtrack: { source: 'media/music.mp3', volume: 0.2 },
  };

  it('projects sequential clips and overlays without mutating the original edit', () => {
    const result = studioEditToComposition(edit);
    expect(result.durationMs).toBe(5000);
    expect(result.layers.find(x => x.id === 'clip-1')).toMatchObject({ startMs: 0, durationMs: 3000 });
    expect(result.layers.find(x => x.id === 'clip-2')).toMatchObject({ startMs: 3000, durationMs: 2000 });
    expect(result.layers.find(x => x.id === 'caption-1')).toMatchObject({ startMs: 1000, durationMs: 1000 });
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
