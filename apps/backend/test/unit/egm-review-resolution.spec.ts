import { consolidateGoldfish,parseReviewFindings,readResolutionLedger,renderResolutionLedger,resolutionRequest,resolutionContext,resolutionSource,validateResolutionDecisions,renderResolutionDecisions } from '../../src/specialties/software/egm/review-resolution';
import type { GoldfishRunResult } from '../../src/specialties/software/egm/review-pipeline';
import upstream from '../../src/specialties/software/egm/resolution-upstream.json';

const item={severity:'Major',scope:'Query / line 12',description:'The invoice can be counted twice.',rationale:'The join repeats a card.',recommendation:'Aggregate by card and month.'};
const report=(findings:unknown[])=>'Original report\nGOLD_FISH_FINDINGS_BEGIN\n'+JSON.stringify({findings})+'\nGOLD_FISH_FINDINGS_END';
function run(first=report([item]),second=report([item])):GoldfishRunResult{
  return {status:'complete',preset:5,revision:'abc',coverage:'single-stage',approved:false,pendingStages:[],phases:[{stage:5,status:'complete',reportPath:'zoom_out_report.md',markdown:'raw reports',reviewers:[{role:'egm-zoom-out',attempts:1,status:'completed',report:first,sessionId:'a'},{role:'egm-inventive-catalyst',attempts:1,status:'completed',report:second,sessionId:'b'}]}]};
}
const ledger=()=>consolidateGoldfish(run(),'docs/design.md');
describe('Goldfish traceability and Elephant resolution',()=>{
  it('preserves original protocols and checks their Git blob identity',()=>{
    expect(upstream.files).toHaveLength(3);
    for(const f of upstream.files)expect(resolutionSource(f.path)).toBe(f.content);
  });
  it('does not interpret invalid or missing structured findings as a clean report',()=>{
    expect(parseReviewFindings('No problems')).toBeNull();
    expect(parseReviewFindings(report([]))).toEqual([]);
    expect(parseReviewFindings(report([{...item,severity:'Minor'}]))).toBeNull();
    expect(parseReviewFindings(report([{...item,rationale:''}]))).toBeNull();
    expect(parseReviewFindings(report([item])+'\ntrailing text')).toBeNull();
    expect(parseReviewFindings(report([item])+'\n'+report([]))).toBeNull();
    const l=consolidateGoldfish(run('Legacy report',report([])),'docs/design.md');
    expect(l.ready).toBe(false);expect(l.unstructured).toEqual(['5:egm-zoom-out']);
  });
  it('consolidates identical findings while retaining their distinct origins and severity',()=>{
    const l=ledger();
    expect(l.ready).toBe(true);expect(l.findings).toHaveLength(2);expect(l.actions).toHaveLength(1);
    expect(l.actions[0].findingIds).toEqual(['GF-5-zoom-out-1','GF-5-inventive-catalyst-1']);
    expect(renderResolutionLedger(l)).toContain('nenhuma correção aplicada');
    expect(readResolutionLedger(JSON.parse(JSON.stringify(l)))).toEqual(l);
    const different=consolidateGoldfish(run(report([item]),report([{...item,severity:'Blocker'}])),'docs/design.md');
    expect(different.actions.map(a=>a.severity)).toEqual(['Blocker','Major']);
  });
  it('does not erase partial coverage or permit resolution as if it were complete',()=>{
    const r=run();r.status='incomplete';r.pendingStages=[5];r.phases[0].reviewers[1]={role:'egm-inventive-catalyst',attempts:2,status:'not-run',reason:'timeout'};
    const l=consolidateGoldfish(r,'docs/design.md');
    expect(l.ready).toBe(false);expect(l.notRun).toEqual(['5:egm-inventive-catalyst']);
    expect(l.findings).toHaveLength(1);
    expect(()=>resolutionContext(l,'m')).toThrow();
  });
  it('rejects altered traceability and false coverage',()=>{
    const l=ledger();
    expect(()=>readResolutionLedger({...l,actions:[{...l.actions[0],findingIds:['fabricated']}]})).toThrow(/Rastreabilidade/);
    expect(()=>readResolutionLedger({...l,notRun:['missing']})).toThrow(/Cobertura/);
  });
  it('binds each proposed repair to a real step and refuses unrelated steps',()=>{
    const l=ledger(),actionId=l.actions[0].id;
    const response={tipo:'plano',egmDecisions:[{actionId,category:'PROPOSE FIX',justification:'Confirmed join issue',proposedEdit:'Group results per card',stepKey:'repair'}]};
    expect(validateResolutionDecisions(l,response,[{key:'repair'}])).toHaveLength(1);
    expect(renderResolutionDecisions(validateResolutionDecisions(l,response,[{key:'repair'}]))).toContain('não executadas');
    expect(()=>validateResolutionDecisions(l,response,[{key:'other'}])).toThrow();
    expect(()=>validateResolutionDecisions(l,response,[{key:'repair'},{key:'unrelated'}])).toThrow();
    expect(()=>validateResolutionDecisions(l,{tipo:'resposta',egmDecisions:[]},[])).toThrow();
  });
  it('rejects dismissal of major findings and contests without evidence',()=>{
    const l=ledger(),actionId=l.actions[0].id;
    const d={actionId,justification:'Reason'};
    for(const category of ['DECLINE','CONTEST'])expect(()=>validateResolutionDecisions(l,{tipo:'resposta',egmDecisions:[{...d,category}]},[])).toThrow();
    expect(validateResolutionDecisions(l,{tipo:'resposta',egmDecisions:[{...d,category:'ESCALATE'}]},[])).toHaveLength(1);
    expect(()=>validateResolutionDecisions(l,{tipo:'resposta',egmDecisions:[{...d,category:'ESCALATE',stepKey:'repair'}]},[])).toThrow();
  });
  it('cannot contest comprehension gaps even when an evidence field is supplied',()=>{
    const r=run();r.phases[0].stage=6;r.phases[0].reviewers=[{role:'egm-comprehension',attempts:1,status:'completed',report:report([item]),sessionId:'c'}];
    const l=consolidateGoldfish(r,'docs/design.md');
    expect(()=>validateResolutionDecisions(l,{tipo:'resposta',egmDecisions:[{actionId:l.actions[0].id,category:'CONTEST',justification:'Intentional',evidence:'docs/design.md'}]},[])).toThrow(/compreensão/);
  });
  it('only recognizes an explicit resolution request and attaches original protocol to author context',()=>{
    expect(resolutionRequest('/goldfish-resolve abc')).toBe('abc');
    expect(resolutionRequest('Use /goldfish-resolve abc')).toBeNull();
    expect(resolutionContext(ledger(),'m')).toContain('PROPOSE FIX');
  });
});
