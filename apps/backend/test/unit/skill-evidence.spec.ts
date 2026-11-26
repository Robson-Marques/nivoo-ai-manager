import { collectSkillCoverage,manifestEntry,skillExecutionEvidence,summarizeSkillEvidence,verificationReceipt } from '../../src/specialties/skill-evidence';
import { skillContext,skillDocument,skillManifest,selectSkills } from '../../src/specialties/skills';
import { announceSkillRead } from '../../src/providers/agent-file-tools';
import { nativeSkillReadObserver } from '../../src/providers/cli-skill-observer';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const m=manifestEntry('codigo','abcdefghij');
const page=(start:number,end:number)=>({kind:'http-page' as const,path:m.path,sha256:m.sha256,total:m.chars,start,end});
describe('Skill evidence is tied to the delivered document',()=>{
  it('merges overlapping and out-of-order pages, without counting gaps as full coverage',()=>{
    const c=collectSkillCoverage([m]);
    expect(c.snapshot()[0].read).toBe('not-observed');
    c.observe(page(5,10));c.observe(page(0,3));c.observe(page(0,3));
    expect(c.snapshot()[0]).toMatchObject({read:'partial',ranges:[[0,3],[5,10]]});
    c.observe(page(2,7));
    expect(c.snapshot()[0]).toMatchObject({read:'full-local',ranges:[[0,10]]});
  });
  it('rejects changed hashes, foreign paths, invalid bounds and mismatched document length',()=>{
    const c=collectSkillCoverage([m]);
    for(const p of [{...page(0,10),sha256:'wrong'},{...page(0,10),path:'other'},{...page(0,10),total:11},page(-1,10),page(0,11),page(0,0)])c.observe(p);
    expect(c.snapshot()[0].read).toBe('not-observed');
  });
  it('retains CLI observations separately from hash-verified local pages',()=>{
    const c=collectSkillCoverage([m]);
    c.observe({kind:'cli-read',path:m.path,cli:'claude'});
    expect(c.snapshot()[0]).toMatchObject({read:'cli-reported',ranges:[],cli:'claude'});
  });
  it('uses actual generated skill document bytes for the manifest',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-skill-evidence-'));
    try{
      const skills=selectSkills({phase:'execution',text:'corrigir código backend',software:true,media:false});
      skillContext(skills,root);
      expect(skills.length).toBeGreaterThan(0);
      for(const [i,entry] of skillManifest(skills).entries()){
        const bytes=fs.readFileSync(path.join(root,entry.path),'utf8');
        expect(bytes).toBe(skillDocument(skills[i]));
        expect(entry).toEqual(manifestEntry(skills[i].id,bytes));
      }
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  it('observes actual tool responses and native results rather than the model saying it read a skill',()=>{
    const c=collectSkillCoverage([m]);
    const log=jest.fn();
    announceSkillRead('ler_arquivo',JSON.stringify({caminho:m.path,sha256:m.sha256,inicio:0,proximo:5,total:10,conteudo:'abcde'}),log,e=>c.observe(e));
    expect(c.snapshot()[0].read).toBe('partial');
    const cli=collectSkillCoverage([m]);
    const observe=nativeSkillReadObserver('claude','/work',log,e=>cli.observe(e));
    observe(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'I read the skill'}]}}));
    expect(cli.snapshot()[0].read).toBe('not-observed');
    observe(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Read',id:'read1',input:{file_path:m.path}}]}}));
    expect(cli.snapshot()[0].read).toBe('not-observed');
    observe(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read1',content:'some text'}]}}));
    expect(cli.snapshot()[0].read).toBe('cli-reported');
  });
});
describe('Skill delivery evidence is not an application claim',()=>{
  const c=collectSkillCoverage([m]);c.observe(page(0,10));
  const e=skillExecutionEvidence({provider:'nvidia-api',model:'model',coverage:c.snapshot(),verification:verificationReceipt('npm test',0,true,false,false),attemptStatus:'SUCESSO',treeBefore:'a',treeAfter:'b',artifacts:['artifact']});
  it('does not convert a successful check into proof of skill application',()=>{
    expect(e.application).toBe('not-independently-established');
    expect(e.verification).toMatchObject({state:'passed',exitCode:0});
    expect(verificationReceipt('npm test',null,false,true,false).state).toBe('interrupted');
    expect(verificationReceipt('npm test',1,false,false,false).state).toBe('failed');
  });
  it('summarizes only the current successful attempt of completed steps',()=>{
    const attempts=[{stepId:'s',number:1,status:'SUCESSO',contextStats:{skillEvidence:e}},{stepId:'s',number:2,status:'SUCESSO',contextStats:{skillEvidence:{...e,coverage:collectSkillCoverage([m]).snapshot(),verification:{state:'not-run'}}}},{stepId:'pending',number:1,status:'SUCESSO',contextStats:{skillEvidence:e}}];
    const lines=summarizeSkillEvidence([{id:'s',status:'CONCLUIDO',attemptCount:2},{id:'pending',status:'PENDENTE',attemptCount:1}],attempts);
    expect(lines.join('\n')).toContain('leitura local integral 0, parcial 0, relatada pelo CLI 0; conferência de etapa aprovada 0');
    expect(lines.join('\n')).toContain('não demonstram causalidade');
    expect(summarizeSkillEvidence([{id:'s',status:'CONCLUIDO',attemptCount:3}],attempts)).toEqual([]);
  });
});
