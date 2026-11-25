import { assertReviewBinding,checkpointedGoldfishDispatch,createReviewCheckpoint,readReviewCheckpoint,reviewBinding,reviewTotals,type GoldfishCheckpoint } from '../../src/specialties/software/egm/review-checkpoint';
import { runGoldfishReview,type GoldfishReviewerRequest,type GoldfishReviewerResult } from '../../src/specialties/software/egm/review-pipeline';
import { goldfishMessageWriter } from '../../src/specialties/software/egm/review-persistence';
import type { PrismaService } from '../../src/prisma/prisma.service';

const target={path:'docs/design.md',content:'# Design\n## Feature\nOne invoice per card.\n## Implementation Plan\nChange query.'};
const binding=reviewBinding({projectId:'p',conversationId:'c',messageId:'m',providerId:'codex-cli',model:'model',revision:'abc',preset:5},target,[]);
const signal=new AbortController().signal;
const req:GoldfishReviewerRequest={stage:5,role:'egm-zoom-out',attempt:1,revision:'abc',persona:'Review',target:{path:target.path,ranges:[{start:1,end:1,text:'# Design'}]},baseline:[],priorReports:[],access:'authorized-baseline',signal};
function receipt(request:GoldfishReviewerRequest,id:string):GoldfishReviewerResult{
  return {status:'completed',report:'Report '+request.role,receipt:{sessionId:id,freshContext:true,readOnly:true,access:request.access}};
}
const usage={exitCode:0,output:'Report',costUsd:0.0123,inputTokens:200,outputTokens:70};
const clone=(s:GoldfishCheckpoint)=>readReviewCheckpoint(JSON.parse(JSON.stringify(s)));

describe('Durable Goldfish checkpoint',()=>{
  it('persists start before provider invocation and commits receipt with accounting',async()=>{
    const writes:GoldfishCheckpoint[]=[];
    const journal=checkpointedGoldfishDispatch({checkpoint:createReviewCheckpoint(binding),canContinue:()=>true,
      save:async s=>{writes.push(clone(s));return true;},
      dispatch:async r=>{expect(writes).toHaveLength(1);expect(writes[0].entries[0].finishedAt).toBeUndefined();journal.onUsage(usage);return receipt(r,'s1');}});
    expect((await journal.dispatch(req)).status).toBe('completed');
    expect(writes).toHaveLength(2);expect(writes[1].entries[0].result).toMatchObject({receipt:{sessionId:'s1'}});
    expect(reviewTotals(writes[1])).toEqual({costUsd:0.0123,costKnown:true,inputTokens:200,outputTokens:70,tokensKnown:true,uncertain:0,calls:1});
    expect(await journal.dispatch(req)).toEqual(writes[1].entries[0].result);
    expect(writes).toHaveLength(2);
  });
  it('reconstructs an interrupted phase without charging completed reviewers again',async()=>{
    let disk=createReviewCheckpoint(binding),calls=0;
    const first=checkpointedGoldfishDispatch({checkpoint:disk,canContinue:()=>true,save:async s=>{disk=clone(s);return true;},
      dispatch:async r=>{calls++;first.onUsage(usage);return receipt(r,'old-'+calls);}});
    // Capture actual request from pipeline instead of fabricating its fingerprint.
    let recorded:GoldfishReviewerRequest|undefined;
    const initial=await runGoldfishReview({preset:5,revision:'abc',target,signal,dispatch:async r=>{
      if(r.role==='egm-zoom-out'){recorded=r;return first.dispatch(r);}
      return {status:'unavailable',reason:'worker stopped before next request'};
    }});
    expect(initial.status).toBe('unavailable');expect(recorded).toBeDefined();expect(calls).toBe(1);
    const resumed=checkpointedGoldfishDispatch({checkpoint:disk,canContinue:()=>true,save:async s=>{disk=clone(s);return true;},
      dispatch:async r=>{calls++;resumed.onUsage(usage);return receipt(r,'new-'+calls);}});
    const run=await runGoldfishReview({preset:5,revision:'abc',target,signal,dispatch:resumed.dispatch});
    expect(run.status).toBe('complete');expect(calls).toBe(2);
    expect(run.phases[0].reviewers.map(r=>r.sessionId)).toEqual(['old-1','new-2']);
    expect(reviewTotals(disk)).toMatchObject({calls:2,costUsd:0.0246,inputTokens:400,outputTokens:140});
  });
  it('does not retry an in-flight call with unknown result after a crash',async()=>{
    let disk=createReviewCheckpoint(binding),calls=0;
    const interrupted=checkpointedGoldfishDispatch({checkpoint:disk,canContinue:()=>true,
      save:async s=>{disk=clone(s);return true;},dispatch:async()=>{calls++;throw Error('worker lost provider response');}});
    expect((await interrupted.dispatch(req)).status).toBe('unavailable');
    expect(reviewTotals(disk)).toMatchObject({uncertain:1,costKnown:false,tokensKnown:false});
    const next=checkpointedGoldfishDispatch({checkpoint:disk,canContinue:()=>true,save:async()=>true,
      dispatch:async r=>{calls++;return receipt(r,'unexpected');}});
    expect(await next.dispatch(req)).toMatchObject({status:'unavailable',reason:expect.stringContaining('incerto')});
    expect(await next.dispatch({...req,attempt:2})).toMatchObject({status:'unavailable'});
    expect(calls).toBe(1);
  });
  it('stops before invocation when the lease cannot persist the start',async()=>{
    let calls=0;
    const journal=checkpointedGoldfishDispatch({checkpoint:createReviewCheckpoint(binding),canContinue:()=>true,save:async()=>false,dispatch:async r=>{calls++;return receipt(r,'unexpected');}});
    expect((await journal.dispatch(req)).status).toBe('interrupted');expect(calls).toBe(0);
  });
  it('never repeats when the post-call write fails or the request identity changes',async()=>{
    let writes=0,calls=0,disk=createReviewCheckpoint(binding);
    const journal=checkpointedGoldfishDispatch({checkpoint:disk,canContinue:()=>true,save:async s=>{if(++writes===2)throw Error('db lost');disk=clone(s);return true;},dispatch:async r=>{calls++;return receipt(r,'s1');}});
    expect((await journal.dispatch(req)).status).toBe('unavailable');
    expect((await journal.dispatch({...req,attempt:2})).status).toBe('unavailable');
    const next=checkpointedGoldfishDispatch({checkpoint:disk,canContinue:()=>true,save:async()=>true,dispatch:async r=>{calls++;return receipt(r,'s2');}});
    expect(await next.dispatch({...req,persona:'Changed'})).toMatchObject({status:'unavailable',reason:expect.stringContaining('mudou')});
    expect(calls).toBe(1);
  });
  it('rejects changed project, model, target or corrupt checkpoint',()=>{
    const saved=createReviewCheckpoint(binding);
    for(const change of [{projectId:'other'},{model:'other'},{targetHash:'other'},{revision:'other'},{providerId:'other'}])expect(()=>assertReviewBinding(saved,{...binding,...change})).toThrow(/mudou/);
    expect(()=>readReviewCheckpoint({...saved,version:2})).toThrow();
    expect(()=>readReviewCheckpoint({...saved,entries:[{key:'bad'}]})).toThrow();
    expect(reviewTotals(saved)).toMatchObject({costKnown:true,tokensKnown:true,calls:0});
  });
  it('retains partial accounting without inventing a monetary zero or complete tokens',async()=>{
    const journal=checkpointedGoldfishDispatch({checkpoint:createReviewCheckpoint(binding),canContinue:()=>true,save:async()=>true,
      dispatch:async r=>{journal.onUsage({exitCode:1,output:'',inputTokens:25,usagePartial:true});return {status:'failed',reason:'timeout'};}});
    expect((await journal.dispatch(req)).status).toBe('failed');
    expect(journal.totals()).toMatchObject({costKnown:false,tokensKnown:false,inputTokens:25,outputTokens:0,uncertain:0,calls:1});
  });
});

describe('Goldfish fenced message persistence',()=>{
  it('checks the current queue claim before updating the message',async()=>{
    const query=jest.fn().mockResolvedValueOnce([{id:'m'}]).mockResolvedValueOnce([]);
    const updateMany=jest.fn();
    const prisma={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:query,conversationMessage:{updateMany}})} as unknown as PrismaService;
    const write=goldfishMessageWriter(prisma,{messageId:'m',taskId:'t',workerId:'w',claims:2},signal);
    expect(await write({content:'new'})).toBe(false);expect(updateMany).not.toHaveBeenCalled();
    expect(query.mock.calls[1].slice(1)).toEqual(['t','m','w',2]);
  });
  it('updates once only with a live claim and pending message',async()=>{
    const query=jest.fn().mockResolvedValue([{id:'valid'}]),updateMany=jest.fn().mockResolvedValue({count:1});
    const prisma={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:query,conversationMessage:{updateMany}})} as unknown as PrismaService;
    const write=goldfishMessageWriter(prisma,{messageId:'m',taskId:'t',workerId:'w',claims:2},signal);
    expect(await write({costUsd:0.0123})).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({where:{id:'m',status:'PENDENTE'},data:{costUsd:0.0123}});
  });
});
