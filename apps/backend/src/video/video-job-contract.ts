import { createHash } from 'node:crypto';

/**
 * Versioned, serializable request contract for a future persistent video worker.
 * This module does not enqueue jobs or authorize project access.
 */
export type VideoOperation =
  | { kind: 'transcribe'; mediaId: string; language: string }
  | { kind: 'preview'; compositionId: string; revision: string }
  | { kind: 'render'; compositionId: string; revision: string; format: 'mp4' }
  | { kind: 'import'; sourceUrl: string };

export type VideoJobRequest = {
  projectId: string;
  operation: VideoOperation;
  requestedBy: string;
};

function nonEmpty(value: string, field: string): void {
  if (!value || value.length > 512 || /[\x00-\x1f]/.test(value)) {
    throw new Error('Invalid ' + field);
  }
}

export function validateVideoJobRequest(request: VideoJobRequest): void {
  nonEmpty(request.projectId, 'projectId');
  nonEmpty(request.requestedBy, 'requestedBy');
  switch (request.operation.kind) {
    case 'transcribe':
      nonEmpty(request.operation.mediaId, 'mediaId');
      if (!/^[a-z]{2,3}$/.test(request.operation.language)) throw new Error('Invalid language');
      break;
    case 'preview':
    case 'render':
      nonEmpty(request.operation.compositionId, 'compositionId');
      nonEmpty(request.operation.revision, 'revision');
      if (request.operation.kind === 'render' && request.operation.format !== 'mp4') {
        throw new Error('Unsupported format');
      }
      break;
    case 'import':
      // Remote import remains disabled in the tool adapter until egress isolation.
      nonEmpty(request.operation.sourceUrl, 'sourceUrl');
      break;
    default:
      throw new Error('Unknown video operation');
  }
}

/** Stable for a given project, operation and media/composition revision. */
export function videoJobIdempotencyKey(request: VideoJobRequest): string {
  validateVideoJobRequest(request);
  const operation = request.operation;
  const fields: string[] = [request.projectId, operation.kind];
  switch (operation.kind) {
    case 'transcribe': fields.push(operation.mediaId, operation.language); break;
    case 'preview': fields.push(operation.compositionId, operation.revision); break;
    case 'render': fields.push(operation.compositionId, operation.revision, operation.format); break;
    case 'import': fields.push(operation.sourceUrl); break;
  }
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
