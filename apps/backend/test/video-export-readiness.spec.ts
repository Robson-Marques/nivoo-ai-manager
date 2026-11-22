import { assessRemotionExport } from '../src/video/video-export-readiness';
import { StudioEditV1 } from '../src/video/video-studio-bridge';

describe('Remotion export readiness', () => {
  const edit: StudioEditV1 = {
    version: 1, id: 'project', updatedAt: 'r1',
    clips: [{ id: 'clip', source: 'video.mp4', start: 0, end: 2, duration: 2 }],
    captions: [], assets: [],
  };
  const media = [{ mediaId: 'video.mp4', assetUrl: '/media/video.mp4' }];

  it('does not enable an unverified renderer for a simple project', () => {
    const status = assessRemotionExport(edit, media);
    expect(status.ready).toBe(false);
    expect(status.props?.layers[0]).toMatchObject({ type: 'video', src: '/media/video.mp4' });
    expect(status.blockers).toContain('Remotion composition bundle and end-to-end export are not yet verified');
  });

  it('identifies edit features requiring parity work', () => {
    const status = assessRemotionExport({
      ...edit,
      clips: [{ ...edit.clips[0], start: 2, end: 4 }],
      captions: [{ id: 'caption', text: 'Olá', start: 0, end: 1, animation: 'karaoke',
        words: [{ text: 'Olá', start: 0, end: 0.5 }] }],
      protectedZones: [{ id: 'zone', label: 'Logo', start: 0, end: 2, x: 0, y: 0, w: 20, h: 20 }],
    }, media);
    expect(status.blockers.join(' ')).toMatch(/karaoke/);
    expect(status.blockers.join(' ')).toMatch(/protected-zones/);
    expect(status.blockers.join(' ')).toMatch(/source-offset/);
  });

  it('does not return props when project media is unresolved', () => {
    const status = assessRemotionExport(edit, []);
    expect(status.ready).toBe(false);
    expect(status.props).toBeUndefined();
    expect(status.blockers.join(' ')).toMatch(/Unresolved/);
  });
});
