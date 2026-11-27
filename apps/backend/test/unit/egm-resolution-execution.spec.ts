import { approvedGoldfish,bindApprovedGoldfish,checkApprovedGoldfishStep,summarizeGoldfishExecution } from '../../src/specialties/software/egm/resolution-execution';
import type { ResolutionLedger,ResolutionDecision } from '../../src/specialties/software/egm/review-resolution';

const revision='a'.repeat(40);
const step={key:'fix-invoices',instructions:'Correct invoice aggregation',verifyCommand:'npm run test:invoices',provider:'codex-cli'};
const decision:ResolutionDecision={actionId:'ACT-1',category:'PROPOSE FIX',justification:'Reproduce duplication',proposedEdit:'Aggregate once per card',stepKey:step.key};
const action={id:'ACT-1',severity:'Major' as const,scope:'Monthly invoices',description:'Duplicate invoices',rationale:'Join repeats cards',recommendation:'Aggregate',findingIds:['GF-5-zoom-out-1']};
const ledger:ResolutionLedger={version:1,revision,targetPath:'docs/design.md',sourceRevision:'original',reviewStatus:'complete',coverage:'single-stage',findings:[],actions:[action],unstructured:[],notRun:[],ready:true};
const binding=()=>bindApprovedGoldfish('review-id',ledger,[decision],[step]);
describe('Approved Goldfish execution contract',()=>{
  it('persists a binding separately from the model and supports legacy jobs',()=>{
    const b=binding();
    expect(approvedGoldfish({egmResolution:JSON.parse(JSON.stringify(b))})).toEqual(b);
    expect(approvedGoldfish({version:1})).toBeNull();
    expect(()=>approvedGoldfish({egmResolution:{...b,revision:'invalid'}})).toThrow();
    expect(()=>approvedGoldfish({egmResolution:{...b,steps:[]}})).toThrow();
  });
  it('rejects changes in step instructions, provider or test command',()=>{
    const b=binding();
    expect(()=>checkApprovedGoldfishStep(b,step)).not.toThrow();
    for(const modified of [{...step,instructions:'Unrelated work'},{...step,verifyCommand:'npm run test:other'},{...step,provider:'local-shell'},{...step,key:'other'}])expect(()=>checkApprovedGoldfishStep(b,modified)).toThrow();
  });
  it('rejects a repair with no verification or a trivial command',()=>{
    for(const verifyCommand of ['', 'true', ':', 'exit 0', 'echo ok'])expect(()=>bindApprovedGoldfish('review-id',ledger,[decision],[{...step,verifyCommand}])).toThrow();
  });
  it('preserves the finding IDs and rejects missing decisions',()=>{
    expect(binding().actions[0].findingIds).toEqual(action.findingIds);
    expect(()=>bindApprovedGoldfish('review-id',ledger,[],[step])).toThrow();
  });
  it('never promotes a completed step without the matching successful attempt and checkpoint',()=>{
    const executed={...step,id:'step-id',status:'CONCLUIDO',attemptCount:2};
    const b=binding();
    const attempt={id:'attempt-id',stepId:executed.id,number:2,status:'SUCESSO',exitCode:0,treeAfter:'tree'};
    const cp={id:'cp-id',stepId:executed.id,gitCommit:'b'.repeat(40),seq:2,state:{tentativa:2,etapas:{[step.key]:'CONCLUIDO'}}};
    expect(summarizeGoldfishExecution(b,[executed],[],[],null,'EXECUTANDO').join('\n')).toContain('sem recibo técnico completo');
    expect(summarizeGoldfishExecution(b,[executed],[attempt],[{...cp,state:{tentativa:1,etapas:{[step.key]:'CONCLUIDO'}}}],null,'EXECUTANDO').join('\n')).toContain('sem recibo técnico completo');
    expect(summarizeGoldfishExecution(b,[executed],[{...attempt,exitCode:1}],[cp],null,'EXECUTANDO').join('\n')).toContain('sem recibo técnico completo');
    const text=summarizeGoldfishExecution(b,[executed],[attempt],[cp],'c'.repeat(40),'CONCLUIDO').join('\n');
    expect(text).toContain('checkpoint cp-id');expect(text).toContain('Correção semântica individual ainda não comprovada');
  });
});
