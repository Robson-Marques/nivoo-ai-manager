import { VideoJobCoordinator, VideoJobRecord, VideoJobStore } from '../src/video/video-job-coordinator';
import { VideoJobRequest } from '../src/video/video-job-contract';

const request: VideoJobRequest = {
  projectId: 'project-1', requestedBy: 'user-1',
  operation: { kind: 'transcribe', mediaId: 'media-1', language: 'pt' },
};

function memoryStore(): VideoJobStore {
  const data = new Map<string, VideoJobRecord>();
  return {
    get: async key => data.get(key),
    insertIfAbsent: async record => {
      const existing = data.get(record.key);
      if (existing) return existing;
      data.set(record.key, record);
      return record;
    },
    compareAndSwap: async (expected, next) => {
      if (data.get(expected.key) !== expected) return false;
      data.set(expected.key, next);
      return true;
    },
  };
}

describe('VideoJobCoordinator', () => {
  it('deduplicates identical submissions', async () => {
    const jobs = new VideoJobCoordinator(memoryStore(), () => 1000);
    const first = await jobs.submit(request);
    const second = await jobs.submit(request);
    expect(second).toEqual(first);
    expect(first.state).toBe('queued');
  });

  it('prevents two workers from claiming the same lease', async () => {
    const jobs = new VideoJobCoordinator(memoryStore(), () => 1000);
    const queued = await jobs.submit(request);
    const [first, second] = await Promise.all([
      jobs.claim(queued.key, 5000), jobs.claim(queued.key, 5000),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first?.attempt ?? second?.attempt).toBe(1);
  });

  it('rejects stale completion after another worker takes over', async () => {
    let now = 1000;
    const jobs = new VideoJobCoordinator(memoryStore(), () => now);
    const queued = await jobs.submit(request);
    const first = await jobs.claim(queued.key, 5000);
    expect(first).toBeDefined();
    now = 6001;
    const second = await jobs.claim(queued.key, 5000);
    expect(second?.attempt).toBe(2);
    expect(await jobs.complete(first!, 'succeeded')).toBe(false);
    expect(await jobs.complete(second!, 'succeeded')).toBe(true);
  });

  it('cancels queued work and prevents claiming it', async () => {
    const jobs = new VideoJobCoordinator(memoryStore(), () => 1000);
    const queued = await jobs.submit(request);
    expect(await jobs.cancel(queued.key)).toBe(true);
    expect(await jobs.claim(queued.key, 5000)).toBeUndefined();
    expect(await jobs.cancel(queued.key)).toBe(false);
  });

  it('rejects invalid leases', async () => {
    const jobs = new VideoJobCoordinator(memoryStore());
    await expect(jobs.claim('missing', 0)).rejects.toThrow('lease');
  });
});
