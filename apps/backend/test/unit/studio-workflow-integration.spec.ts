import {studioAlignmentSkills,selectSkills} from '../../src/specialties/skills';
import {findTemplate,AREAS_INSTALADAS} from '../../src/areas/area-templates';
import {plannerRules} from '../../src/worker/planner/contract';
describe('Studio Workflow e Skills coexistem',()=>{
  it('disponibiliza o pacote original e mantém a base Software',()=>{
    const t=findTemplate('studio-workflow')!;
    expect(AREAS_INSTALADAS).toContain('software');
    expect(AREAS_INSTALADAS).toContain('studio-workflow');
    expect(Object.keys(t.baseFiles)).toHaveLength(18);
    expect(t.baseFiles['capability-contract.md']).toContain('Capability Acceptance');
    expect(t.baseFiles['architecture-baseline.md']).toContain('Architecture Recovery');
  });
  it('ativa requisitos e especificação no alinhamento e preserva as três orientações na capacidade',()=>{
    expect(studioAlignmentSkills().map(s=>s.id)).toEqual(expect.arrayContaining(['software-requisitos','software-especificacao']));
    expect(studioAlignmentSkills()).toHaveLength(2);
    const ids=selectSkills({phase:'execution',text:'Entregar dashboard',software:true,media:false,capabilityWork:true}).map(s=>s.id);
    expect(ids).toEqual(expect.arrayContaining(['software-requisitos','software-especificacao','software-contexto-arquitetural']));
    expect(ids).not.toContain('software-revisao-independente');
  });
  it('não contradiz alinhamento, escopo ou aceitação do método',()=>{
    const rules=plannerRules({media:false,softwareInterface:true,studioWorkflow:true,paidVideo:false}).join('\n');
    expect(rules).toContain('Ausência de especialidade segue specialty-creation.md');
    expect(rules).toContain('Não repita aceitação global por slice');
    expect(rules).toContain('O campo texto do plano É o Relatório de alinhamento');
    expect(rules).not.toContain('ausência de catálogo de especialidades');
    expect(rules).not.toContain('Leia integralmente o componente relevante');
    const normal=plannerRules({media:false,softwareInterface:true,paidVideo:false}).join('\n');
    expect(normal).toContain('ausência de catálogo de especialidades');
  });
});
