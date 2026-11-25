import { interfaceCompositionIntent,interfaceCompositionFocus,interfaceCompositionContext,INTERFACE_COMPOSITION_SKILL } from '../../src/specialties/software/interface-composition';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Composição de interfaces Design Taste',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('seleciona criação e composição de interfaces sem ampliar correções locais',()=>{
    expect(interfaceCompositionIntent("Composição de interfaces")).toBe(true);
    expect(interfaceCompositionIntent("Interfaces profissionais")).toBe(true);
    expect(interfaceCompositionIntent("Criar dashboard")).toBe(true);
    expect(interfaceCompositionIntent("Redesign de dashboard")).toBe(true);
    expect(interfaceCompositionIntent("Desenvolva uma landing page")).toBe(true);
    expect(interfaceCompositionIntent("Criar um site para a pizzaria")).toBe(true);
    expect(interfaceCompositionIntent("Organizar o layout da interface")).toBe(true);
    expect(interfaceCompositionIntent("Hierarquia de informações")).toBe(true);
    expect(interfaceCompositionIntent("Layout responsivo")).toBe(true);
    expect(interfaceCompositionIntent("Projetar painel administrativo")).toBe(true);
    expect(interfaceCompositionIntent("Corrigir endpoint")).toBe(false);
    expect(interfaceCompositionIntent("Ajustar componente React")).toBe(false);
    expect(interfaceCompositionIntent("Criar formulário React")).toBe(false);
    expect(interfaceCompositionIntent("Refatorar arquitetura e logs")).toBe(false);
    expect(interfaceCompositionIntent("Migração Prisma e testes")).toBe(false);
    expect(interfaceCompositionIntent("Direção artística para o site")).toBe(false);
    expect(interfaceCompositionIntent("Editar imagem de pizza")).toBe(false);
    expect(interfaceCompositionIntent("Criar vídeo de pizza")).toBe(false);
    expect(interfaceCompositionIntent("Corrigir interface TypeScript")).toBe(false);
  });
  it('seleciona focos pertinentes',()=>{
    expect(interfaceCompositionFocus("Hierarquia e densidade")).toEqual(["hierarquia"]);
    expect(interfaceCompositionFocus("Grid e alinhamento")).toEqual(["composicao"]);
    expect(interfaceCompositionFocus("Menus e abas")).toEqual(["navegacao"]);
    expect(interfaceCompositionFocus("Cards e tabelas")).toEqual(["componentes"]);
    expect(interfaceCompositionFocus("Hero e landing page")).toEqual(["produto"]);
    expect(interfaceCompositionFocus("Tablet e viewport")).toEqual(["adaptacao"]);
    expect(interfaceCompositionFocus("Acessibilidade e capturas")).toEqual(["evidencia"]);
    expect(interfaceCompositionFocus("Dashboard com grid, tabelas e mobile")).toEqual(["hierarquia","composicao","componentes","adaptacao"]);
  });
  it('coopera com frontend, Unslop e direção artística sem duplicar seções',()=>{
    const text='Redesign de dashboard e identidade visual do site';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-frontend','software-refinamento-visual','software-direcao-artistica','software-composicao-interface']));
    const sections=softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false});
    expect(sections.filter(s=>s.key==='engenharia-composicao-interface')).toHaveLength(1);
    expect(sections.find(s=>s.key==='engenharia-composicao-interface')?.lines.join('\n')).toContain('No plano');
    expect(interfaceCompositionContext('execution',text).join('\n')).toContain('Na etapa atual');
    expect(interfaceCompositionContext('planner','Grid').join('\n')).not.toContain('Apresentação:');
    expect(selectSkills({...base,text:'Criar um site para a pizzaria'}).map(s=>s.id)).toEqual(expect.arrayContaining(['software-frontend','software-direcao-artistica','software-composicao-interface']));
    expect(INTERFACE_COMPOSITION_SKILL.sourceAttribution).toContain('Leonxlnx (MIT)');
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags})).not.toContain(INTERFACE_COMPOSITION_SKILL);
    }
  });
});
