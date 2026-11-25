import { automaticGoldfishDecision,automaticReviewMatches,readAutoReview,type AutoReviewRequest } from '../../src/specialties/software/egm/automatic-review';
import type { ApprovedScope } from '../../src/jobs/approved-scope';

const revision='a'.repeat(40),contract='docs/designs/billing.md';
const scope:ApprovedScope={version:1,projectId:'project',conversationId:'conversation',planMessageId:'plan',cutoff:'2026-11-25T12:00:00.000Z',approvedAt:'2026-11-25T12:01:00.000Z',approvedBy:'operator',areaTemplate:'studio-workflow',alignment:'Implement billing contract.',request:{id:'request',content:'Implement billing',kind:null},visual:{revision:0,profile:null}};
const criterion=(key:string,phase:string,path=contract,id='billing')=>({key,kind:'COMMAND',config:{capability:{id,contract:path,phase},command:'npm test'}});
const input={projectId:'project',area:{template:'studio-workflow'},approvedScope:scope,criteria:[criterion('structural','structural'),criterion('acceptance','acceptance')],passedKeys:new Set(['structural','acceptance']),files:[{status:'A',path:contract},{status:'M',path:'src/billing.ts'}],revision,providerType:'codex-cli',budgetConfigured:false,specialtyHandoff:false};
describe('Automatic Goldfish admission',()=>{
  it('selects one critical-review phase for a changed, verified structural contract',()=>{
    expect(automaticGoldfishDecision(input)).toEqual({kind:'review',targetPath:contract,preset:7});
  });
  it('does not review ordinary local repairs, documentation-only changes, unchanged contracts or missing acceptance',()=>{
    for(const change of [
      {criteria:[]},
      {files:[{status:'M',path:contract}]},
      {files:[{status:'M',path:'src/billing.ts'}]},
      {passedKeys:new Set(['structural'])},
      {criteria:[criterion('structural','structural'),{...criterion('acceptance','acceptance'),kind:'FILE_EXISTS'}]},
      {revision:null},
    ])expect(automaticGoldfishDecision({...input,...change}).kind).toBe('skip');
  });
  it('does not automatically escalate unsupported providers, cost limits, media or incomplete scope',()=>{
    for(const change of [
      {providerType:'gemini-api'},{budgetConfigured:true},{specialtyHandoff:true},{area:{template:'design-video'}},{approvedScope:null},{projectId:'other'},
    ])expect(automaticGoldfishDecision({...input,...change}).kind).toBe('skip');
  });
  it('never arbitrarily picks one of multiple contracts or mixes criteria from different capabilities',()=>{
    const other='docs/designs/account.md';
    expect(automaticGoldfishDecision({...input,criteria:[...input.criteria,criterion('s2','structural',other,'account'),criterion('a2','acceptance',other,'account')],passedKeys:new Set(['structural','acceptance','s2','a2']),files:[...input.files,{status:'M',path:other}]}).kind).toBe('skip');
    expect(automaticGoldfishDecision({...input,criteria:[criterion('structural','structural'),criterion('acceptance','acceptance',contract,'different')]}).kind).toBe('skip');
  });
  it('requires a server-side automatic request with fixed revision, mode and safe target',()=>{
    const request:AutoReviewRequest={version:1,jobId:'job',projectId:'project',conversationId:'conversation',revision,targetPath:contract,providerId:'codex-cli',model:null,preset:7};
    expect(readAutoReview({automaticRequest:request})).toEqual(request);
    expect(()=>readAutoReview({automaticRequest:{...request,targetPath:'../secret.md'}})).toThrow();
    expect(()=>readAutoReview({automaticRequest:{...request,preset:'uninterrupted'}})).toThrow();
    expect(()=>readAutoReview({automaticRequest:{...request,revision:'main'}})).toThrow();
    expect(()=>readAutoReview(request)).toThrow();
  });
  it('rejects changed connection, model, job, conversation, revision or budget at execution time',()=>{
    const request:AutoReviewRequest={version:1,jobId:'job',projectId:'project',conversationId:'conversation',revision,targetPath:contract,providerId:'codex-cli',model:'model',preset:7};
    const actual={...request,budgetConfigured:false};
    expect(automaticReviewMatches(request,actual)).toBe(true);
    for(const change of [{providerId:'other'},{model:null},{jobId:'other'},{conversationId:'other'},{revision:'b'.repeat(40)},{budgetConfigured:true}])expect(automaticReviewMatches(request,{...actual,...change})).toBe(false);
  });
});
