import { QueueService } from '../../src/queue/queue.service';
describe('queue lease generations',()=>{
  it('fences heartbeat, completion and requeue with the generation and live deadline',async()=>{
    const execute=jest.fn().mockResolvedValue(0);
    const queue=new QueueService({$executeRaw:execute} as any);
    expect(await queue.heartbeat('t','w',3,1000)).toBe(false);
    expect(await queue.complete('t','w',3)).toBe(false);
    expect(await queue.requeue('t','w',3,new Date())).toBe(false);
    for(const call of execute.mock.calls){
      expect(call[0].join(' ')).toContain('claims =');
      expect(call[0].join(' ')).toContain('"lockedUntil" >');
      expect(call).toContain(3);
    }
  });
  it('does not mutate a task when its generation has been superseded',async()=>{
    const update=jest.fn();
    const tx={$queryRaw:jest.fn().mockResolvedValue([]),queueTask:{update}};
    const queue=new QueueService({$transaction:(f:any)=>f(tx)} as any);
    expect(await queue.recordInternalFailure({id:'t',claims:2} as any,'w','sig','reason')).toBe('lost');
    expect(update).not.toHaveBeenCalled();
  });
  it('uses persisted consecutive error count, even on a fresh service instance',async()=>{
    const update=jest.fn();
    const tx={$queryRaw:jest.fn().mockResolvedValue([{internalErrorSignature:'sig',internalErrorCount:3}]),queueTask:{update}};
    const queue=new QueueService({$transaction:(f:any)=>f(tx)} as any);
    expect(await queue.recordInternalFailure({id:'t',claims:4} as any,'w','sig','reason')).toBe('retry');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({internalErrorCount:4,status:'QUEUED'})}));
  });
  it('blocks the message and marks its task DEAD in the same transaction on the fifth error',async()=>{
    const update=jest.fn(),message=jest.fn();
    const tx={$queryRaw:jest.fn().mockResolvedValue([{internalErrorSignature:'sig',internalErrorCount:4}]),queueTask:{update},conversationMessage:{updateMany:message}};
    const queue=new QueueService({$transaction:(f:any)=>f(tx)} as any);
    expect(await queue.recordInternalFailure({id:'t',claims:5,messageId:'m'} as any,'w','sig','reason')).toBe('blocked');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({internalErrorCount:5,status:'DEAD'})}));
    expect(message).toHaveBeenCalledWith(expect.objectContaining({where:{id:'m',status:'PENDENTE'}}));
  });
});
