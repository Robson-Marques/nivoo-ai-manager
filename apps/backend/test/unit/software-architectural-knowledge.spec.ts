import { architecturalKnowledgeIntent,architecturalKnowledgeFocus,architecturalKnowledgeContext } from '../../src/specialties/software/architectural-knowledge';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Conhecimento arquitetural',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('seleciona contexto e contratos sem duplicar toda tarefa de arquitetura',()=>{
    expect(architecturalKnowledgeIntent("Mapear a arquitetura atual do sistema")).toBe(true);
    expect(architecturalKnowledgeIntent("Contexto arquitetural do projeto")).toBe(true);
    expect(architecturalKnowledgeIntent("Documentar contratos de módulos")).toBe(true);
    expect(architecturalKnowledgeIntent("Verificar documentação e código")).toBe(true);
    expect(architecturalKnowledgeIntent("Detectar divergências entre documentação e implementação")).toBe(true);
    expect(architecturalKnowledgeIntent("Revisar docs/adr/001-storage.md")).toBe(true);
    expect(architecturalKnowledgeIntent("Atualizar decisões arquiteturais")).toBe(true);
    expect(architecturalKnowledgeIntent("Corrigir endpoint")).toBe(false);
    expect(architecturalKnowledgeIntent("Criar formulário React")).toBe(false);
    expect(architecturalKnowledgeIntent("Refatorar arquitetura e logs")).toBe(false);
    expect(architecturalKnowledgeIntent("Migração Prisma e testes")).toBe(false);
    expect(architecturalKnowledgeIntent("Plano de implementação")).toBe(false);
    expect(architecturalKnowledgeIntent("Criar ERP para provedor")).toBe(false);
    expect(architecturalKnowledgeIntent("Editar imagem de pizza")).toBe(false);
  });
  it('carrega focos pertinentes',()=>{
    expect(architecturalKnowledgeFocus("Memória e histórico")).toEqual(["contexto"]);
    expect(architecturalKnowledgeFocus("Invariantes e efeitos colaterais")).toEqual(["contratos"]);
    expect(architecturalKnowledgeFocus("Mapa de módulos")).toEqual(["mapa"]);
    expect(architecturalKnowledgeFocus("Drift e divergências")).toEqual(["divergencias"]);
    expect(architecturalKnowledgeFocus("Reuso e complexidade")).toEqual(["reuso"]);
    expect(architecturalKnowledgeFocus("Documentar")).toEqual(["documentacao"]);
    expect(architecturalKnowledgeFocus("Documentação arquitetural e contratos")).toEqual(["contexto","contratos","mapa","documentacao"]);
  });
  it('preserva a arquitetura anterior e usa o catálogo compartilhado',()=>{
    const text='Mapear a arquitetura atual do sistema e suas decisões arquiteturais';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-arquitetura','software-contexto-arquitetural']));
    const plan=softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false}).find(s=>s.key==='engenharia-contexto-arquitetural')?.lines.join('\n');
    expect(plan).toContain('No plano');
    const exec=architecturalKnowledgeContext('execution',text).join('\n');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('Não crie subagentes, indexador, memória ou sessão adicional');
    expect(architecturalKnowledgeContext('planner','Invariantes').join('\n')).not.toContain('Divergências:');
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags}).some(s=>s.id==='software-contexto-arquitetural')).toBe(false);
    }
  });
});
