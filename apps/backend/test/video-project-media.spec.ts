import { resolveCompositionMedia } from '../src/video/video-project-media';
import { VideoComposition } from '../src/video/video-composition';

describe('project media authorization for video export', () => {
  const composition: VideoComposition = {
    schemaVersion: 1, id: 'composition', revision: 'v1',
    width: 1080, height: 1920, fps: 30, durationMs: 1000,
    layers: [
      { id: 'clip', type: 'video', mediaId: 'clip-1', startMs: 0, durationMs: 1000, zIndex: 0 },
      { id: 'title', type: 'text', text: 'Title', startMs: 0, durationMs: 1000, zIndex: 1 },
    ],
  };

  it('resolves owned media only', () => {
    expect(resolveCompositionMedia(composition, 'project-a', [
      { id: 'clip-1', projectId: 'project-a', assetUrl: '/media/clip-1.mp4' },
      { id: 'unused', projectId: 'project-a', assetUrl: '/media/unused.mp4' },
    ])).toEqual([{ mediaId: 'clip-1', assetUrl: '/media/clip-1.mp4' }]);
  });

  it('refuses media from another project', () => {
    expect(() => resolveCompositionMedia(composition, 'project-a', [
      { id: 'clip-1', projectId: 'project-b', assetUrl: '/media/clip-1.mp4' },
    ])).toThrow('Missing or unauthorized');
  });

  it('refuses deleted and unsafe media', () => {
    expect(() => resolveCompositionMedia(composition, 'project-a', [
      { id: 'clip-1', projectId: 'project-a', assetUrl: '/media/clip.mp4', deleted: true },
    ])).toThrow('Missing or unauthorized');
    expect(() => resolveCompositionMedia(composition, 'project-a', [
      { id: 'clip-1', projectId: 'project-a', assetUrl: '//outside.example/file.mp4' },
    ])).toThrow('Invalid project media URL');
  });
});
