import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import upstream from '../../src/specialties/software/egm/planning-upstream.json';
import { compileEgmHandoff,egmPlanningContext,writeEgmHandoff } from '../../src/specialties/software/egm/planning';

const step={key:'faturas',title:'Exibir faturas',instructions:'Preserve os filtros.',dependsOn:[],status:'PENDENTE',verifyCommand:'node nivoo-roteiros/despesas-postgres.cjs'};
const criterion={key:'faturas',kind:'ARTIFACT_PRESENT',description:'Uma linha por cartão',status:'PENDENTE',config:{name:'out/relatorio.md'}};
const input={approved:null,objective:{version:1,sha256:'abc',text:'Mostrar faturas no mês'},steps:[step],criteria:[criterion]};

describe('EGM: fontes originais e handoff do plano Nivoo',()=>{
  it('preserva cada fonte de planejamento e a licença do commit upstream',()=>{
    expect(upstream.files.some(f=>f.path==='LICENSE')).toBe(true);
    expect(upstream.files.some(f=>f.path==='skills/egm-lite/SKILL.md')).toBe(true);
    for(const file of upstream.files){
      const bytes=Buffer.from(file.content,'utf8');
      expect(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')).toBe(file.sha);
    }
  });
  it('não confunde candidato Lite, plano sem vínculo e revisão realizada',()=>{
    const h=compileEgmHandoff(input);
    expect(h.route).toBe('lite-candidate');
    expect(h.approval).toBeNull();
    expect(h.review).toEqual({status:'not-run',independent:false});
    expect(h.steps[0]).toEqual(step);
    expect(h.objective).toEqual(input.objective);
    expect(compileEgmHandoff({...input,steps:[step,{...step,key:'outra'}]}).route).toBe('scope-undetermined');
    const c={...criterion,kind:'COMMAND',config:{command:'npm run test:acceptance',capability:{id:'app.ui',contract:'docs/ui.md',phase:'acceptance'}}};
    expect(compileEgmHandoff({...input,criteria:[c]})).toMatchObject({route:'design',criteria:[{command:'npm run test:acceptance',capability:{id:'app.ui'}}]});
  });
  it('materializa apenas referências pertinentes depois do pré-gate e o handoff descartável',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-egm-plan-'));
    try{
      expect(egmPlanningContext([],false,dir)).toEqual([]);
      expect(egmPlanningContext([{id:'codigo'}],true,dir).join('\n')).toContain('Antes de Fazer');
      expect(fs.existsSync(path.join(dir,'contexto','egm'))).toBe(false);
      expect(egmPlanningContext([{id:'codigo'}],false,dir).join('\n')).toContain('Referências originais');
      expect(fs.existsSync(path.join(dir,'contexto','egm','original','skills','egm-draft','references','design_doc.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir,'contexto','egm','original','skills','egm-lite','SKILL.md'))).toBe(false);
      const h=writeEgmHandoff(dir,input);
      expect(JSON.parse(fs.readFileSync(path.join(dir,'contexto','egm','handoff.json'),'utf8'))).toEqual(h);
      expect(fs.existsSync(path.join(dir,'egm_lite_checklist.md'))).toBe(false);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
