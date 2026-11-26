import { compareProcessIdentity,parseProcessStat } from '../../src/common/process-identity';
import { assertStepLease,LostStepLease } from '../../src/worker/executor/lease';
import type { Prisma } from '@prisma/client';
const p={version:1 as const,pid:123,bootId:'boot-a',startTicks:'456'};
describe('process ownership on recovery',()=>{
  it('parses comm with spaces and parentheses, retaining group and start time',()=>{
    const fields=['S','1','123','123',...Array(15).fill('0'),'456','0'];
    expect(parseProcessStat('123 (worker (test)) '+fields.join(' '))).toEqual({pid:123,group:123,session:123,startTicks:'456'});
    expect(parseProcessStat('bad')).toBeNull();
  });
  it('recognizes exact identity, not PID reuse or reboot',()=>{
    expect(compareProcessIdentity(123,p,p,true,'boot-a')).toBe('owned');
    expect(compareProcessIdentity(123,p,{...p,startTicks:'999'},true,'boot-a')).toBe('foreign');
    expect(compareProcessIdentity(123,p,null,true,'boot-b')).toBe('foreign');
  });
  it('does not authorize killing a legacy PID or unidentified group',()=>{
    expect(compareProcessIdentity(123,null,p,true,'boot-a')).toBe('uncertain');
    expect(compareProcessIdentity(123,p,null,true,'boot-a')).toBe('uncertain');
    expect(compareProcessIdentity(123,p,null,false,'boot-a')).toBe('absent');
  });
});
describe('step lease fence',()=>{
  const task={id:'t',claims:9,jobId:'j',stepId:'s'};
  it('uses worker, generation and task binding to lock the live lease',async()=>{
    const query=jest.fn().mockResolvedValue([{id:'t'}]);
    await assertStepLease({$queryRaw:query} as unknown as Prisma.TransactionClient,task,'w');
    const [sql,...values]=query.mock.calls[0];
    expect(sql.join(' ')).toContain('FOR UPDATE');
    expect(sql.join(' ')).toContain('"lockedUntil" >');
    expect(values).toEqual(['t','w',9,'j','s']);
  });
  it('rejects missing, expired or superseded lease rather than authorizing a stale result',async()=>{
    const query=jest.fn().mockResolvedValue([]);
    await expect(assertStepLease({$queryRaw:query} as unknown as Prisma.TransactionClient,task,'w')).rejects.toBeInstanceOf(LostStepLease);
  });
});
