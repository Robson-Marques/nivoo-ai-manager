import { applySubtitleCues } from '../src/video/video-caption-composition';
import { VideoComposition } from '../src/video/video-composition';
import { parseWhisperSrt } from '../src/video/video-subtitles';

describe('Whisper captions in composition', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'clip', revision: 'r1', width: 1080, height: 1920,
    fps: 30, durationMs: 5000,
    layers: [
      { id: 'manual-title', type: 'text', text: 'Título', startMs: 0, durationMs: 5000, zIndex: 100 },
      { id: 'subtitle-99', type: 'text', text: 'Legenda antiga', startMs: 0, durationMs: 1000, zIndex: 900 },
    ],
  };

  it('replaces old generated captions while preserving manual layers', () => {
    const cues = parseWhisperSrt('1\n00:00:00,200 --> 00:00:01,500\nNova legenda');
    const result = applySubtitleCues(composition, cues);
    expect(result.layers.map(layer => layer.id)).toEqual(['manual-title', 'subtitle-1']);
    expect(result.layers[1]).toMatchObject({ type: 'text', startMs: 200, durationMs: 1300, animation: 'fade' });
    expect(composition.layers[1].id).toBe('subtitle-99');
  });

  it('rejects captions outside composition duration', () => {
    expect(() => applySubtitleCues(composition, [
      { id: 'subtitle-1', startMs: 4000, endMs: 6000, text: 'Fora' },
    ])).toThrow();
  });
});
