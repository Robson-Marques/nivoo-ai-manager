import { buildCaptionDraft } from '../src/video/video-caption-draft';
import { VideoComposition } from '../src/video/video-composition';

describe('caption review draft', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'video-1', revision: 'rev-1', width: 1080, height: 1920,
    fps: 30, durationMs: 3000, layers: [],
  };

  it('trims captions and warns instead of silently applying them', () => {
    const draft = buildCaptionDraft(composition, [
      { id: 'subtitle-1', startMs: 2500, endMs: 4500, text: 'Até o fim' },
      { id: 'subtitle-2', startMs: 3100, endMs: 3500, text: 'Fora' },
    ]);
    expect(draft.cues).toEqual([{ id: 'subtitle-1', startMs: 2500, endMs: 3000, text: 'Até o fim' }]);
    expect(draft.warnings).toHaveLength(2);
    expect(draft.revision).toBe('rev-1');
  });

  it('rejects unordered and duplicate cues', () => {
    expect(() => buildCaptionDraft(composition, [
      { id: 'subtitle-1', startMs: 1000, endMs: 1100, text: 'A' },
      { id: 'subtitle-2', startMs: 500, endMs: 900, text: 'B' },
    ])).toThrow('Invalid');
    expect(() => buildCaptionDraft(composition, [
      { id: 'subtitle-1', startMs: 1000, endMs: 1100, text: 'A' },
      { id: 'subtitle-1', startMs: 1200, endMs: 1400, text: 'B' },
    ])).toThrow('Duplicate');
  });
});
