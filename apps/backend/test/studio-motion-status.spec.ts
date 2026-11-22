import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readStudioMotionState, saveStudioMotionState, type StudioMotionState } from '../src/video-studio/studio-motion-status';

describe('Studio motion job durability',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const runId='22222222-2222-4222-8222-222222222222';
  let media:string;
  beforeEach(()=>{media=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-motion-status-'));});
  afterEach(()=>{fs.rmSync(media,{recursive:true,force:true});});
  const initial=():StudioMotionState=>({
    state:'running',runId,started:'2026-11-22T10:00:00.000Z',
    preset:'kinetic-title',title:'Nivoo',fingerprint:'a'.repeat(64),
  });
  it('stores a render status atomically with restricted permissions',()=>{
    saveStudioMotionState(media,id,initial());
    const filename=path.join(media,'studio',id+'.motion-status.json');
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    const restored=readStudioMotionState(media,id)!;
    // No running in-memory job after a restart => never claim it completed.
    expect(restored.state).toBe('failed');
    expect(restored.error).toContain('interrompida');
  });
  it('reuses a completed result only while the published file exists',()=>{
    fs.mkdirSync(path.join(media,'saida'));
    const output='midia/saida/motion-'+id+'-'+runId+'.mp4';
    fs.writeFileSync(path.join(media,'saida',path.basename(output)),Buffer.alloc(2048));
    saveStudioMotionState(media,id,{...initial(),state:'done',output,durationMs:3200});
    expect(readStudioMotionState(media,id)?.state).toBe('done');
    fs.unlinkSync(path.join(media,'saida',path.basename(output)));
    expect(readStudioMotionState(media,id)?.state).toBe('failed');
  });
  it('rejects a published result when the output directory is redirected',()=>{
    const output='midia/saida/motion-'+id+'-'+runId+'.mp4';
    fs.symlinkSync(os.tmpdir(),path.join(media,'saida'));
    saveStudioMotionState(media,id,{...initial(),state:'done',output,durationMs:3200});
    expect(()=>readStudioMotionState(media,id)).toThrow('não confiável');
  });
  it('refuses publication paths outside the project',()=>{
    expect(()=>saveStudioMotionState(media,id,{...initial(),state:'done',
      output:'../../etc/passwd'})).toThrow('Saída de motion inválida');
  });
  it('does not trust a symlinked state file',()=>{
    fs.mkdirSync(path.join(media,'studio'));
    const statePath=path.join(media,'studio',id+'.motion-status.json');
    fs.symlinkSync('/etc/passwd',statePath);
    expect(()=>readStudioMotionState(media,id)).toThrow('symlink');
  });
});
