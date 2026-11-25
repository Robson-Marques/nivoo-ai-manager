import { createReviewCheckpoint,reviewBinding } from '../../src/specialties/software/egm/review-checkpoint';
import { assertLiteReceipt,liteFindings,liteDiffLedger,validateLiteSpecRevision,liteSpecContext,renderLiteSpecDecisions } from '../../src/specialties/software/egm/lite-resolution';
import { readResolutionLedger } from '../../src/specialties/software/egm/review-resolution';
import type { LiteResult } from '../../src/specialties/software/egm/lite-review';

const item={scope:'step:fix',description:'Missing boundary case',evidence:'No empty-list test in checklist',recommendation:'Add empty-list test'};
const report='[P1] '+JSON.stringify(item);
const result:LiteResult={mode:'lite-spec',status:'findings',sourceId:'plan',revision:'a'.repeat(40),report,sessionId:'fresh'};
const original={title:'Invoices',objective:'Display invoices',defaultProvider:'codex-cli',steps:[{key:'fix',instructions:'Correct calculation'},{key:'ui',instructions:'Preserve layout'}],criteria:[{key:'test',kind:'COMMAND',config:{command:'npm test'}}]};
const revised={...original,criteria:[...original.criteria,{key:'empty',kind:'COMMAND',config:{command:'npm run test:empty'}}]};
const findingId=liteFindings(report)![0].id;
const fix={findingId,category:'PROPOSE FIX',justification:'Missing case',evidence:'Checklist has no empty-list test',changes:['criterion:empty']};
describe('Lite resolution',()=>{
  it('creates stable IDs and preserves priority and raw evidence',()=>{
    expect(liteFindings(report)).toEqual(liteFindings(report));
    expect(liteFindings(report)?.[0]).toMatchObject({priority:'P1',...item});
    expect(liteFindings('[✅ LGTM]')).toEqual([]);
    expect(liteFindings(report+'\n'+report)).toBeNull();
    expect(liteFindings(report+'\n[✅ LGTM]')).toBeNull();
    expect(liteFindings('[P1] generic')).toBeNull();
  });
  it('converts only a received diff finding into existing resolution ledger',()=>{
    const ledger=liteDiffLedger({...result,mode:'lite-diff'});
    expect(readResolutionLedger(ledger)).toEqual(ledger);
    expect(ledger.findings[0]).toMatchObject({id:findingId,severity:'Major',reviewer:'lite-diff'});
    expect(ledger.actions[0].findingIds).toEqual([findingId]);
    expect(()=>liteDiffLedger(result)).toThrow();
    expect(()=>liteDiffLedger({...result,mode:'lite-diff',sessionId:undefined})).toThrow();
  });
  it('requires one decision per finding and accounts for every actual checklist change',()=>{
    const decisions=validateLiteSpecRevision(result,original,revised,[fix]);
    expect(decisions[0].changes).toEqual(['criterion:empty']);
    expect(renderLiteSpecDecisions(decisions)).toContain('aguardando Fazer');
    expect(liteSpecContext(result,original,'review')).toContain(findingId);
    expect(()=>validateLiteSpecRevision(result,original,revised,[])).toThrow();
    expect(()=>validateLiteSpecRevision(result,original,original,[fix])).toThrow();
    expect(()=>validateLiteSpecRevision(result,original,{...revised,steps:[{...original.steps[0],instructions:'Other work'},original.steps[1]]},[fix])).toThrow(/sem achado/);
  });
  it('rejects removed items, changed objective, provider and attachments',()=>{
    for(const plan of [{...revised,steps:[original.steps[0]]},{...revised,objective:'Other task'},{...revised,defaultProvider:'other'},{...revised,anexosNoProjeto:[{anexo:'private',para:'new'}]}])expect(()=>validateLiteSpecRevision(result,original,plan,[fix])).toThrow();
  });
  it('requires the native receipt for the exact persisted report and mode',()=>{
    const state=createReviewCheckpoint(reviewBinding({projectId:'p',conversationId:'c',messageId:'m',providerId:'codex-cli',model:null,revision:result.revision,preset:'lite-spec',liteSourceId:result.sourceId},{path:'lite-review.md',content:'target'},[]));
    state.lite=result;
    expect(()=>assertLiteReceipt(state)).toThrow(/recibo/);
    state.entries.push({key:'7:lite-spec:1',fingerprint:'fingerprint',stage:7,role:'lite-spec',attempt:1,startedAt:'2026-11-25T12:00:00Z',finishedAt:'2026-11-25T12:01:00Z',result:{status:'completed',report,receipt:{sessionId:'fresh',freshContext:true,readOnly:true,access:'document-only'}}});
    expect(assertLiteReceipt(state)).toEqual(result);
    expect(()=>assertLiteReceipt({...state,lite:{...result,sessionId:'other'}})).toThrow(/recibo/);
  });
  it('allows a contest proposal only without changes and with declared evidence',()=>{
    const contest={...fix,category:'CONTEST',changes:[]};
    expect(validateLiteSpecRevision(result,original,original,[contest])).toHaveLength(1);
    expect(()=>validateLiteSpecRevision(result,original,revised,[contest])).toThrow();
    expect(()=>validateLiteSpecRevision(result,original,original,[{...contest,evidence:''}])).toThrow();
  });
});
