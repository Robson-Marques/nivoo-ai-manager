import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertGoldfishProofContracts,bindGoldfishProofs,detectGoldfishGitDrift,goldfishProofEvidence,renderGoldfishGitDrift } from '../../src/specialties/software/egm/resolution-proof';
import type { ResolutionDecision } from '../../src/specialties/software/egm/review-resolution';

const action=(id:string,scenario:string):ResolutionDecision=>({actionId:id,category:'PROPOSE FIX',justification:'Reproduce regression',proposedEdit:'Correct behavior',stepKey:'fix',criterionKey:'regression',scenario});
const decisions=[action('ACT-1','One monthly invoice per card'),action('ACT-2','Preserve other account isolation')];
const criteria=[{key:'regression',kind:'COMMAND',config:{command:'npm run test:regression',expectExitCode:0}}];
const marker=(id:string,scenario:string,passed=true)=>'NIVOO_EGM_EVIDENCE '+JSON.stringify({actionId:id,scenario,passed});
describe('Goldfish proof contract on the existing final suite',()=>{
  it('binds multiple actions to one approved final command without adding another call',()=>{
    const proofs=bindGoldfishProofs(decisions,criteria,[{verifyCommand:'npm run lint'}]);
    expect(proofs).toHaveLength(2);
    expect(new Set(proofs.map(p=>p.criterionKey))).toEqual(new Set(['regression']));
    expect(()=>assertGoldfishProofContracts(proofs,criteria)).not.toThrow();
  });
  it('rejects missing scenario, file-presence checks, trivial commands and nonzero expected exits',()=>{
    expect(()=>bindGoldfishProofs([{...decisions[0],scenario:undefined}],criteria,[])).toThrow();
    expect(()=>bindGoldfishProofs(decisions,[{...criteria[0],kind:'FILE_EXISTS'}],[])).toThrow();
    for(const command of ['true','echo success','printf ok','test -f report.md'])expect(()=>bindGoldfishProofs(decisions,[{...criteria[0],config:{command}}],[])).toThrow();
    expect(()=>bindGoldfishProofs(decisions,[{...criteria[0],config:{command:'npm test',expectExitCode:1}}],[])).toThrow();
  });
  it('does not repeat the same final command as an earlier step',()=>{
    expect(()=>bindGoldfishProofs(decisions,criteria,[{verifyCommand:'npm run test:regression'}])).toThrow(/duplique/);
  });
  it('rejects a modified criterion or missing criterion after approval',()=>{
    const proofs=bindGoldfishProofs(decisions,criteria,[]);
    expect(()=>assertGoldfishProofContracts(proofs,[])).toThrow();
    expect(()=>assertGoldfishProofContracts(proofs,[{...criteria[0],config:{command:'npm run test:other'}}])).toThrow();
  });
  it('requires exact action and scenario, rejects contradictory markers, and does not infer success from exit alone',()=>{
    const proofs=bindGoldfishProofs(decisions,criteria,[]);
    expect(goldfishProofEvidence('All tests passed',proofs).missing).toEqual(['ACT-1','ACT-2']);
    const first=marker('ACT-1',decisions[0].scenario!);
    const second=marker('ACT-2',decisions[1].scenario!);
    expect(goldfishProofEvidence(first+'\n'+marker('ACT-2','wrong'),proofs).missing).toEqual(['ACT-2']);
    expect(goldfishProofEvidence(first+'\n'+second,proofs).missing).toEqual([]);
    expect(goldfishProofEvidence(first+'\n'+second+'\n'+marker('ACT-1',decisions[0].scenario!,false),proofs).missing).toEqual(['ACT-1']);
    expect(goldfishProofEvidence(first+'\nNIVOO_EGM_EVIDENCE malformed\n'+marker('unknown','other'),proofs).observed).toEqual([{actionId:'ACT-1',scenario:decisions[0].scenario}]);
  });
});
describe('Git drift of reviewed revision',()=>{
  let repo:string;
  const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  beforeEach(()=>{
    repo=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-egm-drift-'));
    git('init','-q','-b','main');
    git('config','user.name','Test');git('config','user.email','test@example.invalid');
    fs.mkdirSync(path.join(repo,'docs'));fs.writeFileSync(path.join(repo,'docs/design.md'),'# Design\n');fs.writeFileSync(path.join(repo,'source.ts'),'const x=1;\n');
    git('add','.');git('commit','-qm','baseline');
  });
  afterEach(()=>fs.rmSync(repo,{recursive:true,force:true}));
  it('distinguishes unchanged, code-only drift, and changed target without claiming semantic conformity',async()=>{
    const base=git('rev-parse','HEAD');
    expect(await detectGoldfishGitDrift(repo,base,'docs/design.md')).toMatchObject({status:'unchanged',targetChanged:false,paths:[]});
    fs.writeFileSync(path.join(repo,'source.ts'),'const x=2;\n');git('add','.');git('commit','-qm','source change');
    const code=await detectGoldfishGitDrift(repo,base,'docs/design.md');
    expect(code).toMatchObject({status:'changed',targetChanged:false,paths:['source.ts']});
    expect(renderGoldfishGitDrift(code)).toContain('não é parecer semântico');
    fs.writeFileSync(path.join(repo,'docs/design.md'),'# Changed\n');git('add','.');git('commit','-qm','design change');
    expect(await detectGoldfishGitDrift(repo,base,'docs/design.md')).toMatchObject({status:'changed',targetChanged:true,paths:['docs/design.md','source.ts']});
  });
  it('fails closed when base identity or Git comparison is unavailable',async()=>{
    expect((await detectGoldfishGitDrift(repo,'invalid','docs/design.md')).status).toBe('unavailable');
    expect((await detectGoldfishGitDrift(repo,'f'.repeat(40),'docs/design.md')).status).toBe('unavailable');
  });
});
