import { VideoJobRequest, validateVideoJobRequest, videoJobIdempotencyKey } from './video-job-contract';

export type VideoJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type VideoJobRecord = {
  key: string;
  request: VideoJobRequest;
  state: VideoJobState;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  leaseUntil?: number;
  error?: string;
};

export interface VideoJobStore {
  get(key: string): Promise<VideoJobRecord | undefined>;
  /** Must be atomic (insert-if-absent) across processes. */
  insertIfAbsent(record: VideoJobRecord): Promise<VideoJobRecord>;
  /** Must atomically compare state, lease and updatedAt before writing. */
  compareAndSwap(expected: VideoJobRecord, next: VideoJobRecord): Promise<boolean>;
}

/**
 * Persistent-store orchestration primitives. No in-memory lock is used:
 * callers must provide database-backed atomic insert and compare-and-swap.
 * This is not wired to a queue until a durable store exists.
 */
export class VideoJobCoordinator {
  constructor(private readonly store: VideoJobStore, private readonly now: () => number = Date.now) {}

  async submit(request: VideoJobRequest): Promise<VideoJobRecord> {
    validateVideoJobRequest(request);
    const key = videoJobIdempotencyKey(request);
    const time = this.now();
    const proposed: VideoJobRecord = {
      key, request, state: 'queued', attempt: 0, createdAt: time, updatedAt: time,
    };
    return this.store.insertIfAbsent(proposed);
  }

  async claim(key: string, leaseMs: number): Promise<VideoJobRecord | undefined> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3_600_000) {
      throw new Error('Invalid video job lease');
    }
    const current = await this.store.get(key);
    if (!current) return undefined;
    const time = this.now();
    if (current.state !== 'queued' &&
        !(current.state === 'running' && current.leaseUntil !== undefined && current.leaseUntil <= time)) {
      return undefined;
    }
    const next: VideoJobRecord = {
      ...current, state: 'running', attempt: current.attempt + 1,
      updatedAt: time, leaseUntil: time + leaseMs, error: undefined,
    };
    return await this.store.compareAndSwap(current, next) ? next : undefined;
  }

  async complete(claimed: VideoJobRecord, result: 'succeeded' | 'failed' | 'cancelled', error?: string): Promise<boolean> {
    if (claimed.state !== 'running') throw new Error('Only a running job may be completed');
    const current = await this.store.get(claimed.key);
    if (!current || current.state !== 'running' || current.attempt !== claimed.attempt ||
        current.leaseUntil !== claimed.leaseUntil || current.leaseUntil === undefined ||
        current.leaseUntil <= this.now()) return false;
    const next: VideoJobRecord = {
      ...current, state: result, updatedAt: this.now(), leaseUntil: undefined,
      error: error?.slice(0, 1024),
    };
    return this.store.compareAndSwap(current, next);
  }

  async cancel(key: string): Promise<boolean> {
    const current = await this.store.get(key);
    if (!current || current.state === 'succeeded' || current.state === 'failed' ||
        current.state === 'cancelled') return false;
    return this.store.compareAndSwap(current, {
      ...current, state: 'cancelled', leaseUntil: undefined, updatedAt: this.now(),
    });
  }
}
