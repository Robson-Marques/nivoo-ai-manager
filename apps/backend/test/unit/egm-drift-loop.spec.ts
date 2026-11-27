import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { driftRequest,loadDriftIntake,parseDriftReport,runSemanticDrift,renderSemanticDrift } from '../../src/specialties/software/egm/drift';
import { loopRequest,nextLoopRecord,assertLoopContinuation,readLoopRecord } from '../../src/specialties/software/egm/review-loop';
import type { ResolutionLedger,Action } from '../../src/specialties/software/egm/review-resolution';
import type { GoldfishReviewerRequest } from '../../src/specialties/software/egm/review-pipeline';

describe('EGM drift: actual document and source evidence',()=>{
  let root:string;
  const write=(relative:string,value:string)=>{const p=path.join(root,relative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);};
  beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-egm-drift-'));
    write('docs/designs/invoices.md','# Invoices\nUse one invoice per card.\n[query](../../src/invoices.ts)\n');
    write('docs/designs/account.md','# Account\nUse \x60AccountFilter\x60 for isolation.\n');
    write('src/invoices.ts','export function invoices() {\n  return rows;\n}\n');
    write('src/account.ts','export class AccountFilter {}\n');
    write('.env','PRIVATE_VALUE');
    fs.symlinkSync(path.join(root,'.env'),path.join(root,'src/private.ts'));
  });
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  it('discovers each document and linked or symbol-matched source without following symlinks',()=>{
    expect(driftRequest('/goldfish-drift docs/designs')).toBe('docs/designs');
    expect(driftRequest('mention /goldfish-drift')).toBeNull();
    const intake=loadDriftIntake(root,'docs/designs');
    expect(intake.documents.map(d=>d.target.path)).toEqual(['docs/designs/account.md','docs/designs/invoices.md']);
    expect(intake.documents[0].references.map(r=>r.path)).toContain('src/account.ts');
    expect(intake.documents[1].references.map(r=>r.path)).toContain('src/invoices.ts');
    expect(JSON.stringify(intake)).not.toContain('PRIVATE_VALUE');
    expect(()=>loadDriftIntake(root,'../outside')).toThrow();
  });
  it('rejects an invented source quotation and accepts existing line evidence',()=>{
    const doc=loadDriftIntake(root,'docs/designs').documents[1];
    const item={kind:'logic-shortcut',description:'Aggregation is not applied in this function.',design:{path:doc.target.path,line:2,quote:'one invoice per card'},code:[{path:'src/invoices.ts',line:2,quote:'return rows;'}]};
    const report=(differences:unknown[])=>'NIVOO_DRIFT_BEGIN\n'+JSON.stringify({differences,limitations:[]})+'\nNIVOO_DRIFT_END';
    expect(parseDriftReport(report([item]),doc)?.differences).toEqual([item]);
    expect(parseDriftReport(report([{...item,code:[{...item.code[0],quote:'GROUP BY'}]}]),doc)).toBeNull();
    expect(parseDriftReport('No drift detected',doc)).toBeNull();
  });
  it('runs sequentially and stops if independent transport is unavailable',async()=>{
    const intake=loadDriftIntake(root,'docs/designs'),signal=new AbortController().signal,calls:GoldfishReviewerRequest[]=[];
    const result=await runSemanticDrift({intake,revision:'abc',signal,dispatch:async r=>{
      calls.push(r);return {status:'unavailable',reason:'no transport'};
    }});
    expect(calls).toHaveLength(1);
    expect(result.pending).toEqual(['docs/designs/invoices.md']);
    expect(renderSemanticDrift(result)).toContain('Análise não executada');
  });
  it('retains limited coverage even when every selected document reports no difference',async()=>{
    const intake=loadDriftIntake(root,'docs/designs');
    let calls=0;
    const result=await runSemanticDrift({intake,revision:'abc',signal:new AbortController().signal,dispatch:async r=>({status:'completed',report:'NIVOO_DRIFT_BEGIN\n{"differences":[],"limitations":[]}\nNIVOO_DRIFT_END',receipt:{sessionId:'new-'+(++calls),freshContext:true,readOnly:true,access:r.access}})});
    expect(result.pending).toEqual([]);
    expect(result.results.map(r=>r.status)).toEqual(['partial','partial']);
    expect(renderSemanticDrift(result)).toContain('não equivale a ausência de drift');
  });
  it('rejects oversized directory scope rather than silently omitting documents',()=>{
    for(let i=0;i<11;i++)write('docs/designs/extra-'+i+'.md','# Extra');
    expect(()=>loadDriftIntake(root,'docs/designs')).toThrow(/Mais de 10/);
  });
});
const major:Action={id:'ACT-1',severity:'Major',scope:'Invoice',description:'Double count',rationale:'Join',recommendation:'Aggregate',findingIds:['GF-7-design-1']};
const ledger=(actions:Action[]=[],revision='a',ready=true):ResolutionLedger=>({version:1,revision,targetPath:'docs/design.md',sourceRevision:'upstream',reviewStatus:ready?'complete':'incomplete',coverage:'full-design',findings:[],actions,unstructured:[],notRun:ready?[]:['reviewer'],ready});
const round=(messageId:string,l:ResolutionLedger,parent?:ReturnType<typeof nextLoopRecord>,coverageLimited=false)=>nextLoopRecord({messageId,ledger:l,parent,parentMessageId:parent?'previous':undefined,preset:'uninterrupted',coverageLimited});
describe('EGM loop with explicit continuation',()=>{
  it('requires two clean rounds and does not use Nits as major defects',()=>{
    const first=round('m1',ledger([{...major,severity:'Nit'}]));
    expect(first.status).toBe('awaiting-confirmation');expect(first.cleanStreak).toBe(1);
    const second=round('m2',ledger(),first);
    expect(second.status).toBe('converged');expect(second.cleanStreak).toBe(2);
    expect(readLoopRecord(second)).toEqual(second);
    expect(()=>round('m3',ledger(),second)).toThrow();
  });
  it('does not count incomplete or limited coverage as clean',()=>{
    const first=round('m1',ledger());
    expect(round('m2',ledger([], 'a',false),first).cleanStreak).toBe(0);
    expect(round('m2',ledger(),first,true).status).toBe('incomplete');
  });
  it('reopens recurring serious findings and refuses a new round without a linked correction',()=>{
    const first=round('m1',ledger([major]));
    expect(first.status).toBe('awaiting-resolution');
    expect(()=>assertLoopContinuation(first,ledger([major]),null,'a')).toThrow();
    expect(()=>assertLoopContinuation(first,ledger([major]),'b','c')).toThrow();
    expect(()=>assertLoopContinuation(first,ledger([major]),'b','b')).not.toThrow();
    const second=round('m2',ledger([{...major,id:'new-action'}],'b'),first);
    expect(second.recurring).toEqual(first.open);expect(second.cleanStreak).toBe(0);
  });
  it('stops at five rounds without fabricating convergence',()=>{
    let last=round('m1',ledger([major]));
    for(let i=2;i<=5;i++)last=round('m'+i,ledger([major],'r'+i),last);
    expect(last.status).toBe('cap');expect(last.round).toBe(5);
    expect(()=>round('m6',ledger([major]),last)).toThrow();
    expect(loopRequest('/goldfish-loop id')).toBe('id');
  });
});
