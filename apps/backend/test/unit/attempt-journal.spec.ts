import { attemptContract,canReplayAttempt,makeReplayEnvelope,readAttemptJournal,writeAttemptPhase,attachAttemptReplay,terminalAttemptJournal,replayAuxFingerprint } from '../../src/worker/executor/attempt-journal';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const result={exitCode:0,output:'done',costUsd:0.25,sessionId:'s1'};
const input:any={providerId:'codex-cli',isAi:true,nativeVisual:false,repoHarness:[],docsPendentes:[],mediaBefore:[],treeBefore:'old',activeMs:1200,failures:0,result};
const replay=makeReplayEnvelope({contract:'contract',head:'head',tree:'tree',notes:'notes',context:'context',knowledge:'knowledge',input})!;
describe('durable attempt phases',()=>{
  it('only allows replay of a completed phase with a complete envelope',()=>{
    expect(canReplayAttempt({version:1,phase:'RETURNED',replay})).toBe(true);
    expect(canReplayAttempt({version:1,phase:'VERIFYING',replay})).toBe(false);
    expect(canReplayAttempt({version:1,phase:'VERIFIED',replay})).toBe(false);
    expect(canReplayAttempt({version:1,phase:'FINALIZING',replay})).toBe(false);
    expect(canReplayAttempt(readAttemptJournal(null))).toBe(false);
  });
  it('requires the full verification receipt and does not infer success from exit zero',()=>{
    const verifiedReplay={...replay,input:{...input,beforeVerification:result,verification:{verified:false},verified:false,sessionClosedNormally:false}};
    expect(canReplayAttempt({version:1,phase:'VERIFIED',replay:verifiedReplay})).toBe(true);
    expect(canReplayAttempt({version:1,phase:'PUBLISHING',replay:verifiedReplay})).toBe(true);
    expect(canReplayAttempt({version:1,phase:'FINALIZING',replay:verifiedReplay})).toBe(false);
    const finalization={logId:'log',outputIds:['out'],videoIds:[],remove:['AGENTS.md'],docs:[['AGENTS.md','eA==']] as [string,string][],sourceHash:'source'};
    expect(canReplayAttempt({version:1,phase:'RESTORING',replay:verifiedReplay,finalization})).toBe(true);
    expect(canReplayAttempt({version:1,phase:'FINALIZING',replay:verifiedReplay,finalization})).toBe(true);
  });
  it('does not turn oversized or missing-head input into a replay',()=>{
    expect(makeReplayEnvelope({...replay,head:null})).toBeNull();
    expect(makeReplayEnvelope({...replay,input:{...input,result:{...result,output:'a'.repeat(2*1024*1024)}}})).toBeNull();
  });
  it('binds the exact options and verification contract',()=>{
    const j:any={id:'j',approvedScope:null,defaultProvider:'p'};
    const s:any={id:'s',key:'k',instructions:'build',verifyCommand:'test',provider:'p',providerOptions:{b:2,a:1},resumeFromAttempt:0,requiresApproval:false};
    expect(attemptContract(j,s,'p')).toBe(attemptContract(j,{...s,providerOptions:{a:1,b:2}},'p'));
    expect(attemptContract(j,s,'p')).not.toBe(attemptContract(j,{...s,verifyCommand:'other'},'p'));
  });
  it('charges the provider receipt once and preserves it as verification begins',async()=>{
    let state:any={version:1,phase:'DISPATCHING'};
    const update=jest.fn(async({data})=>{state=data.executionState;return {count:1};});
    const charge=jest.fn();
    const tx={$queryRaw:jest.fn().mockResolvedValue([{id:'q'}]),attempt:{findFirst:async()=>({executionState:state}),updateMany:update},job:{update:charge}};
    const prisma:any={$transaction:(fn:any)=>fn(tx)};
    const task:any={id:'q',claims:2,jobId:'j',stepId:'s'};
    await writeAttemptPhase(prisma,task,'w','a','DISPATCHING',{version:1,phase:'RETURNED',result});
    expect(state.replay).toBeNull();
    await attachAttemptReplay(prisma,task,'w','a','RETURNED',replay);
    expect(state.replay.contract).toBe('contract');
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith({where:{id:'j'},data:{costSpentUsd:{increment:0.25}}});
    await expect(writeAttemptPhase(prisma,task,'w','a','DISPATCHING',{version:1,phase:'RETURNED',result})).rejects.toThrow();
    await writeAttemptPhase(prisma,task,'w','a','RETURNED',{version:1,phase:'VERIFYING'});
    expect(charge).toHaveBeenCalledTimes(1);
    expect(state.result.sessionId).toBe('s1');
    expect(state.replay).toBeNull();
    await writeAttemptPhase(prisma,task,'w','a','VERIFYING',{version:1,phase:'VERIFIED',result:{...result,exitCode:1}});
    await attachAttemptReplay(prisma,task,'w','a','VERIFIED',replay);
    await writeAttemptPhase(prisma,task,'w','a','VERIFIED',{version:1,phase:'PUBLISHING'});
    expect(state.replay.contract).toBe('contract');
    await writeAttemptPhase(prisma,task,'w','a','PUBLISHING',{version:1,phase:'RESTORING',finalization:{logId:'l',outputIds:[],videoIds:[],remove:[],docs:[],sourceHash:'tree'}});
    expect(state.replay.contract).toBe('contract');
    await writeAttemptPhase(prisma,task,'w','a','RESTORING',{version:1,phase:'FINALIZING'});
    expect(state.replay).toBeNull();
    const terminal:any=await terminalAttemptJournal(tx as any,'a','w','FALHA');
    expect(terminal.providerResult.exitCode).toBe(0);
    expect(terminal.result.exitCode).toBe(1);
    expect(terminal.costKnown).toBe(true);
    expect(charge).toHaveBeenCalledTimes(1);
  });
  it('detects changed auxiliary content and refuses links',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nivoo-replay-'));
    try{
      const file=path.join(dir,'note');await fs.writeFile(file,'one');
      const first=await replayAuxFingerprint(dir);expect(first).not.toBeNull();
      await fs.writeFile(file,'two');expect(await replayAuxFingerprint(dir)).not.toBe(first);
      await fs.symlink(file,path.join(dir,'alias'));expect(await replayAuxFingerprint(dir)).toBeNull();
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
});
