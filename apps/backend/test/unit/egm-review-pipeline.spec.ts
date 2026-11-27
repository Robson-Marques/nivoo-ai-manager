import { goldfishSource,goldfishPhases,splitGoldfishDocument,runGoldfishReview,type GoldfishReviewerRequest,type GoldfishReviewerResult,type GoldfishPhaseRecord } from '../../src/specialties/software/egm/review-pipeline';
import original from '../../src/specialties/software/egm/review-upstream.json';

const target={path:'docs/designs/faturas.md',content:'# Faturas\n## Overview\nUma fatura por cartão.\n## Detailed Implementation Plan\nAlterar consulta e teste.'};
const baseline=[{path:'src/faturas.ts',content:'export const baselineOnly = 1;'}];
const paraphrase='## What this proposes\nOne invoice per card.\n## How the existing system works, per this document\nThe document describes a monthly query.\nNo findings.';
function success(req:GoldfishReviewerRequest,id:string):GoldfishReviewerResult{
  return {status:'completed',report:req.stage===6?paraphrase:'Finding from '+req.role,receipt:{sessionId:id,freshContext:true,readOnly:true,access:req.access}};
}
function fixture(){
  const signal=new AbortController().signal;
  const calls:GoldfishReviewerRequest[]=[];
  const phases:GoldfishPhaseRecord[]=[];
  const dispatch=async(req:GoldfishReviewerRequest)=>{calls.push(req);return success(req,'review-'+calls.length);};
  const onPhase=(p:GoldfishPhaseRecord)=>{phases.push(p);};
  return {signal,calls,phases,dispatch,onPhase};
}

describe('Pipeline Goldfish: five upstream stages',()=>{
  it('checks all original review personas against their original git blob hashes',()=>{
    expect(original.files).toHaveLength(10);
    for(const file of original.files)expect(goldfishSource(file.path)).toBe(file.content);
    expect(()=>goldfishSource('agents/nonexistent.md')).toThrow(/ausente/);
  });
  it('preserves semantic line ranges, ignoring examples inside fenced blocks',()=>{
    const s=splitGoldfishDocument('# Design\n~~~md\n## Implementation Plan\n~~~\n## Plano de implementação\nAlterar arquivo');
    expect(s.feature.end).toBe(4);
    expect(s.detailed).toEqual({start:5,end:6,text:'## Plano de implementação\nAlterar arquivo'});
    expect(()=>splitGoldfishDocument('# Design\n## Implementation Plan\nA\n## Work Breakdown\nB')).toThrow(/ambíguo/);
    expect(splitGoldfishDocument('# Design\n## Implementation Plan\nA\n## Work Breakdown\nB',4).detailed?.start).toBe(4);
    expect(()=>splitGoldfishDocument('# Design\nA',0)).toThrow(/inválido/);
    expect(()=>goldfishPhases('uninterrupted',splitGoldfishDocument('# Design\nNo plan'))).toThrow(/ausente/);
  });
  it('runs ten distinct reviewers in five phases; comprehension gets no baseline or previous reports',async()=>{
    const f=fixture();
    const r=await runGoldfishReview({preset:'uninterrupted',revision:'base',target,baseline,...f});
    expect(r.status).toBe('complete');
    expect(r.approved).toBe(false);
    expect(r.coverage).toBe('full-design');
    expect(r.pendingStages).toEqual([]);
    expect(f.phases.map(p=>p.stage)).toEqual([5,6,7,8,9]);
    expect(f.calls.map(c=>c.stage)).toEqual([5,5,6,7,7,7,8,9,9,9]);
    const c=f.calls.find(c=>c.stage===6)!;
    expect(c.access).toBe('document-only');
    expect(c.baseline).toEqual([]);
    expect(c.priorReports).toEqual([]);
    expect(c.standard).toBeUndefined();
    expect(c.target.ranges.map(r=>r.start)).toEqual([1,4]);
    expect(r.phases[1].markdown).toContain(paraphrase);
    expect(f.calls.filter(c=>c.stage===7).every(c=>c.target.ranges[0].end===3)).toBe(true);
    expect(f.calls.filter(c=>c.stage===9).every(c=>c.target.ranges[0].start===4)).toBe(true);
    const intermediate=f.calls.find(c=>c.stage===8)!;
    expect(intermediate.priorReports.map(r=>r.path)).toEqual(['zoom_out_report.md','comprehension_report.md','critic_report.md']);
    expect(f.calls.filter(c=>c.stage!==6).every(c=>c.baseline[0].path===baseline[0].path)).toBe(true);
    expect(new Set(r.phases.flatMap(p=>p.reviewers.map(x=>x.sessionId))).size).toBe(10);
  });
  it('supports feature-only and implementation-only without silently adding review phases',async()=>{
    const f=fixture();
    const ambiguous={...target,content:target.content+'\n## Work Breakdown\nAnother section'};
    const r=await runGoldfishReview({preset:'feature_spec',revision:'base',target:ambiguous,...f});
    expect(r.phases.map(p=>p.stage)).toEqual([5,6,7,8]);
    expect(f.calls.find(c=>c.stage===7)?.target.ranges[0].text).toBe(ambiguous.content);
    const g=fixture();
    expect((await runGoldfishReview({preset:'implementation',revision:'base',target,...g})).phases.map(p=>p.stage)).toEqual([9]);
    expect(g.calls).toHaveLength(3);
    await expect(runGoldfishReview({preset:8,revision:'base',target,...fixture()})).rejects.toThrow(/fase 5/);
    const h=fixture();
    await runGoldfishReview({preset:8,revision:'base',target,initialZoomOutReport:{path:'zoom_out_report.md',content:'previous result'},...h});
    expect(h.calls[0].priorReports).toHaveLength(1);
  });
  it('retries a failed reviewer once, retains the failure and never claims full coverage',async()=>{
    const f=fixture();
    const r=await runGoldfishReview({preset:5,revision:'base',target,...f,dispatch:async req=>{
      f.calls.push(req);
      return req.role==='egm-zoom-out'?{status:'failed',reason:'timeout'}:success(req,'unique');
    }});
    expect(r.status).toBe('incomplete');
    expect(r.pendingStages).toEqual([5]);
    expect(r.phases[0].reviewers[0]).toMatchObject({attempts:2,status:'not-run',reason:'timeout'});
    expect(r.phases[0].markdown).toContain('NÃO EXECUTADO: timeout');
    expect(f.calls).toHaveLength(3);
  });
  it('does not accept a review without the mandatory comprehension paraphrases',async()=>{
    const f=fixture();
    const r=await runGoldfishReview({preset:6,revision:'base',target,...f,dispatch:async req=>{
      f.calls.push(req);
      return {...success(req,'unique-'+f.calls.length),report:'All good.'} as GoldfishReviewerResult;
    }});
    expect(r.status).toBe('incomplete');
    expect(f.calls).toHaveLength(2);
  });
  it('fails closed for repeated session IDs and unavailable isolation, no further phases',async()=>{
    const f=fixture();
    const r=await runGoldfishReview({preset:'uninterrupted',revision:'base',target,...f,dispatch:async req=>{
      f.calls.push(req);return success(req,'reused-session');
    }});
    expect(r.status).toBe('unavailable');
    expect(r.pendingStages).toEqual([5,6,7,8,9]);
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0].reviewers.some(x=>x.reason?.includes('Isolamento'))).toBe(true);
    expect(f.calls).toHaveLength(2);
  });
  it('does not invoke the provider if already cancelled, and stops subsequent phases on provider failure',async()=>{
    const f=fixture();
    const controller=new AbortController();controller.abort();
    const r=await runGoldfishReview({preset:'uninterrupted',revision:'base',target,...f,signal:controller.signal});
    expect(r.status).toBe('interrupted');expect(f.calls).toHaveLength(0);
    const g=fixture();
    const u=await runGoldfishReview({preset:'uninterrupted',revision:'base',target,...g,dispatch:async req=>{
      g.calls.push(req);return {status:'unavailable',reason:'isolamento indisponível'};
    }});
    expect(u.status).toBe('unavailable');expect(g.calls).toHaveLength(2);expect(u.phases).toHaveLength(1);
  });
});
