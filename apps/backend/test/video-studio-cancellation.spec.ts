import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { clearStudioRenderCancellation, isStudioRenderCancellationRequested,
  requestStudioRenderCancellation } from '../src/video-studio/render-cancellation';

describe('durable Studio render cancellation',()=>{
  let root:string;
  let editId:string;
  let runId:string;
  beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-cancel-'));
    editId=randomUUID();
    runId=randomUUID();
  });
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));

  it('shares the cancellation request across independent readers',()=>{
    expect(isStudioRenderCancellationRequested(root,editId,runId)).toBe(false);
    requestStudioRenderCancellation(root,editId,runId);
    expect(isStudioRenderCancellationRequested(root,editId,runId)).toBe(true);
    clearStudioRenderCancellation(root,editId,runId);
    expect(isStudioRenderCancellationRequested(root,editId,runId)).toBe(false);
  });

  it('never cancels another render revision',()=>{
    const nextRun=randomUUID();
    requestStudioRenderCancellation(root,editId,runId);
    expect(isStudioRenderCancellationRequested(root,editId,nextRun)).toBe(false);
    expect(isStudioRenderCancellationRequested(root,editId,runId)).toBe(true);
  });

  it('rejects tampered cancellation markers',()=>{
    requestStudioRenderCancellation(root,editId,runId);
    const marker=path.join(root,'studio',editId+'.cancel-'+runId+'.json');
    fs.writeFileSync(marker,JSON.stringify({runId:randomUUID()}));
    expect(()=>isStudioRenderCancellationRequested(root,editId,runId)).toThrow('Invalid Studio cancellation marker');
  });

  it('rejects path traversal in identifiers',()=>{
    expect(()=>requestStudioRenderCancellation(root,'../bad',runId)).toThrow();
    expect(()=>requestStudioRenderCancellation(root,editId,'../bad')).toThrow();
  });
});
