import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { routeEgm,declaredSourceTargets,renderEgmRoute,executionChecklist,renderExecutionChecklist,captureEgmBaseline,previousEgmBaseline } from '../../src/specialties/software/egm/lite-routing';
import { egmLiteReference } from '../../src/specialties/software/egm/planning';
import upstream from '../../src/specialties/software/egm/planning-upstream.json';

const step={key:'fix-invoices',title:'Faturas em despesas',instructions:'Corrigir src/invoices.ts para agrupar uma fatura por cartão. Preservar outros comportamentos.',verifyCommand:'npm run test:invoices',provider:'codex-cli',status:'PENDENTE',dependsOn:[]};
const criteria=[{key:'regression',kind:'COMMAND',description:'Faturas sem duplicação',status:'PENDENTE',config:{command:'npm run test:invoices'}}];
const plan={objective:'Exibir faturas sem duplicação',defaultProvider:'codex-cli',steps:[step],criteria};
const area={template:'studio-workflow'};
describe('Elephant routing and existing checklist',()=>{
  it('uses Lite for a routine single declared production file, without inventing independent review',()=>{
    const r=routeEgm(plan,area);
    expect(r).toMatchObject({route:'lite',recommendSpecReview:false,targets:['src/invoices.ts']});
    expect(renderEgmRoute(r)).toContain('Não equivale a parecer Goldfish');
  });
  it('recognizes adaptive gating risks without using the number of steps as proof',()=>{
    for(const instructions of [
      'Alterar src/invoices.ts e src/cards.ts',
      'Alterar src/invoices.ts e preservar concorrência',
      'Alterar src/invoices.ts e endpoint público',
      'Alterar src/invoices.ts [⚠️ UNVERIFIED]',
    ])expect(routeEgm({...plan,steps:[{...step,instructions}]},area).recommendSpecReview).toBe(true);
    expect(routeEgm({...plan,steps:[step,{...step,key:'other'}]},area).recommendSpecReview).toBe(false);
    expect(routeEgm({...plan,steps:[{...step,instructions:'Corrigir a linha de fatura.'}]},area)).toMatchObject({route:'lite',coverage:'uncertain',recommendSpecReview:true});
  });
  it('selects design for actual capability structure rather than just a title',()=>{
    const structural={...criteria[0],config:{command:'npm test',capability:{id:'billing',contract:'docs/designs/billing.md',phase:'structural'}}};
    expect(routeEgm({...plan,criteria:[structural]},area)).toMatchObject({route:'design',recommendSpecReview:true});
  });
  it('does not route native executors or media into the software checklist',()=>{
    expect(routeEgm(plan,{template:'design-video'}).route).toBe('excluded');
    expect(routeEgm({...plan,steps:[{...step,provider:'local-shell'}]},area).route).toBe('excluded');
    expect(routeEgm(plan,{template:'geral'}).route).toBe('lite');
    expect(declaredSourceTargets('src/invoices.ts tests/invoices.spec.ts docs/code.ts ../private/file.ts .nivoo/file.ts node_modules/lib/a.ts')).toEqual(['src/invoices.ts']);
  });
  it('preserves existing completion state, criteria and approval without treating checklist as a review',()=>{
    const route=routeEgm(plan,area),approval={planMessageId:'p',approvedAt:'2026-11-25T12:00:00Z'},baseline={commit:'a'.repeat(40),dirty:[' M src/other.ts'],complete:true};
    const initial=executionChecklist(plan,route,approval,baseline);
    const done=executionChecklist({...plan,steps:[{...step,status:'CONCLUIDO'}]},route,approval,baseline);
    expect(initial.scopeHash).toBe(done.scopeHash);
    expect(executionChecklist({...plan,steps:[{...step,instructions:'Other task'}]},route,approval,baseline).scopeHash).not.toBe(initial.scopeHash);
    expect(renderExecutionChecklist(done)).toContain('- [x] fix-invoices');
    expect(renderExecutionChecklist(done)).toContain('Parecer independente: não executado');
    expect(previousEgmBaseline({egmExecution:{baseline}})).toEqual(baseline);
    expect(previousEgmBaseline(null)).toEqual({commit:null,dirty:[],complete:false});
  });
});
describe('EGM Lite baseline and pinned source',()=>{
  let repo:string;
  const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  beforeEach(()=>{
    repo=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-lite-'));
    git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    fs.writeFileSync(path.join(repo,'code.ts'),'const a=1;\n');git('add','.');git('commit','-qm','base');
  });
  afterEach(()=>fs.rmSync(repo,{recursive:true,force:true}));
  it('records actual dirty state without staging, committing or removing user changes',async()=>{
    const head=git('rev-parse','HEAD');
    fs.writeFileSync(path.join(repo,'code.ts'),'const a=2;\n');
    fs.writeFileSync(path.join(repo,'local.ts'),'const privateChange=1;\n');
    const before=git('status','--porcelain=v1');
    const baseline=await captureEgmBaseline(repo);
    expect(baseline).toMatchObject({commit:head,complete:true,dirty:[' M code.ts','?? local.ts']});
    expect(git('status','--porcelain=v1')).toBe(before);
    expect(git('rev-parse','HEAD')).toBe(head);
    expect(git('diff','--cached','--name-only')).toBe('');
    fs.writeFileSync(path.join(repo,'code.ts'),'const a=3;\n');
    expect(previousEgmBaseline({egmExecution:{baseline}})).toEqual(baseline);
  });
  it('materializes the exact pinned original Lite skill, not a paraphrase',()=>{
    egmLiteReference(repo);
    const expected=upstream.files.find(f=>f.path==='skills/egm-lite/SKILL.md');
    expect(expected).toBeDefined();
    expect(fs.readFileSync(path.join(repo,'contexto/egm/original/skills/egm-lite/SKILL.md'),'utf8')).toBe(expected!.content);
  });
});
