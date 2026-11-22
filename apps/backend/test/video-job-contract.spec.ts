import { videoJobIdempotencyKey, validateVideoJobRequest, VideoJobRequest } from '../src/video/video-job-contract';

describe('video job contract', () => {
  const base: VideoJobRequest = {
    projectId: 'project-1',
    requestedBy: 'user-1',
    operation: { kind: 'preview', compositionId: 'composition-1', revision: 'v1' },
  };

  it('deduplicates the same composition revision across repeated requests', () => {
    expect(videoJobIdempotencyKey(base)).toBe(videoJobIdempotencyKey({ ...base }));
  });

  it('does not deduplicate distinct revisions or projects', () => {
    const changedRevision: VideoJobRequest = {
      ...base, operation: { kind: 'preview', compositionId: 'composition-1', revision: 'v2' },
    };
    expect(videoJobIdempotencyKey(base)).not.toBe(videoJobIdempotencyKey(changedRevision));
    expect(videoJobIdempotencyKey(base)).not.toBe(videoJobIdempotencyKey({ ...base, projectId: 'project-2' }));
  });

  it('distinguishes preview from final render', () => {
    expect(videoJobIdempotencyKey(base)).not.toBe(videoJobIdempotencyKey({
      ...base, operation: { kind: 'render', compositionId: 'composition-1', revision: 'v1', format: 'mp4' },
    }));
  });

  it('rejects malformed payloads from API input', () => {
    expect(() => validateVideoJobRequest(null as unknown as VideoJobRequest)).toThrow();
    expect(() => validateVideoJobRequest({ ...base, operation: null } as unknown as VideoJobRequest)).toThrow();
    expect(() => validateVideoJobRequest({ ...base, projectId: 123 } as unknown as VideoJobRequest)).toThrow();
    expect(() => validateVideoJobRequest({
      ...base, operation: { kind: 'render', compositionId: 'x', revision: '1', format: 'avi' },
    } as unknown as VideoJobRequest)).toThrow();
  });
});
