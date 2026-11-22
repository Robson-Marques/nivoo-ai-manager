import { approveWhisperCaptionDraft } from '../src/video/video-whisper-pipeline';
import { VideoComposition } from '../src/video/video-composition';

describe('Whisper caption approval', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'video', revision: 'r2', width: 1080, height: 1920,
    fps: 30, durationMs: 2000, layers: [],
  };

  it('rejects a draft from a previous revision', () => {
    expect(() => approveWhisperCaptionDraft(composition, {
      compositionId: 'video', revision: 'r1', cues: [], warnings: [],
    })).toThrow('stale');
  });

  it('applies only matching approved drafts', () => {
    const updated = approveWhisperCaptionDraft(composition, {
      compositionId: 'video', revision: 'r2', warnings: [],
      cues: [{ id: 'subtitle-1', startMs: 0, endMs: 1000, text: 'Olá' }],
    });
    expect(updated.layers).toHaveLength(1);
    expect(updated.layers[0]).toMatchObject({ type: 'text', text: 'Olá' });
  });

  it('rejects drafts exceeding the layer budget', () => {
    expect(() => approveWhisperCaptionDraft(composition, {
      compositionId: 'video', revision: 'r2', cues: [],
      warnings: ['Too many captions to apply: split or combine cues before approval'],
    })).toThrow('budget');
  });
});
