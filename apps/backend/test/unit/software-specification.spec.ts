import { specificationIntent,specificationFocus,specificationEngineeringContext } from '../../src/specialties/software/specification';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Especificação técnica',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('reconhece especificação e construção de produto sem disparar em mudanças locais',()=>{
    expect(specificationIntent("Elaborar especificação técnica")).toBe(true);
    expect(specificationIntent("Plano de implementação")).toBe(true);
    expect(specificationIntent("Planejar arquitetura do sistema")).toBe(true);
    expect(specificationIntent("Desenvolva um sistema de cadastro de clientes")).toBe(true);
    expect(specificationIntent("Criar ERP para provedor")).toBe(true);
    expect(specificationIntent("Sistema completo de atendimento")).toBe(true);
    expect(specificationIntent("Corrigir endpoint")).toBe(false);
    expect(specificationIntent("Criar formulário React")).toBe(false);
    expect(specificationIntent("Migração Prisma e testes")).toBe(false);
    expect(specificationIntent("Refatorar arquitetura e logs")).toBe(false);
    expect(specificationIntent("Levantar requisitos e critérios de aceitação")).toBe(false);
    expect(specificationIntent("Planejar postagem de pizza")).toBe(false);
    expect(specificationIntent("Editar imagem de pizza")).toBe(false);
  });
  it('seleciona focos relevantes',()=>{
    expect(specificationFocus("Contratos e interfaces")).toEqual(["contrato"]);
    expect(specificationFocus("Arquitetura e componentes")).toEqual(["arquitetura"]);
    expect(specificationFocus("Alternativas e trade-offs")).toEqual(["alternativas"]);
    expect(specificationFocus("Etapas e checkpoints")).toEqual(["sequencia"]);
    expect(specificationFocus("Riscos e rollback")).toEqual(["riscos"]);
    expect(specificationFocus("Testes e build")).toEqual(["verificacao"]);
    expect(specificationFocus("Dependências e critérios de aceitação")).toEqual(["arquitetura","sequencia","verificacao"]);
  });
  it('distingue descoberta, planejamento e execução sem criar etapas extras',()=>{
    const text='Desenvolva um sistema de cadastro de clientes';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['software-requisitos','software-especificacao']));
    const plan=softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false}).find(s=>s.key==='engenharia-especificacao')?.lines.join('\n');
    expect(plan).toContain('No plano');
    expect(plan).toContain('contrato Nivoo');
    const exec=specificationEngineeringContext('execution','Plano de implementação').join('\n');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('Não abra revisão independente');
    expect(exec).not.toContain('Verificação:');
    expect(selectSkills({...base,text:'Levantar requisitos e critérios de aceitação'}).some(s=>s.id==='software-especificacao')).toBe(false);
    expect(selectSkills({...base,text:'Corrigir endpoint'}).some(s=>s.id==='software-especificacao')).toBe(false);
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags}).some(s=>s.id==='software-especificacao')).toBe(false);
    }
  });
});
