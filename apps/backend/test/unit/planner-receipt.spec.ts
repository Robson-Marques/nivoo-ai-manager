import { plannerBinding,plannerCost,plannerReplay,readPlannerReceipt } from '../../src/worker/planner/receipt';
describe('planner receipt',()=>{
  const binding=plannerBinding(['msg','provider','model']);
  const result={exitCode:0,output:'plan',costUsd:0.25};
  it('reuses a completed result even when repair was interrupted',()=>{
    for(const phase of ['RETURNED','REPAIRING','REPAIRED']){
      const state=readPlannerReceipt({version:1,binding,phase,result,repair:result});
      expect(plannerReplay(state,binding)).toEqual(result);
    }
  });
  it('does not repeat dispatch with uncertain result',()=>{
    expect(()=>plannerReplay(readPlannerReceipt({version:1,binding,phase:'DISPATCHING'}),binding)).toThrow();
  });
  it('rejects a changed binding and incomplete repair receipt',()=>{
    expect(()=>plannerReplay(readPlannerReceipt({version:1,binding,phase:'RETURNED',result}),'changed')).toThrow();
    expect(()=>readPlannerReceipt({version:1,binding,phase:'REPAIRED',result})).toThrow();
  });
  it('only charges finite nonnegative reported amounts',()=>{
    expect(plannerCost(result)).toBe(0.25);
    expect(plannerCost({...result,costUsd:NaN})).toBe(0);
    expect(plannerCost({...result,costUsd:-1})).toBe(0);
  });
});
