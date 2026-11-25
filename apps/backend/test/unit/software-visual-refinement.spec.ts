import { visualRefinementIntent,visualRefinementFocus,visualRefinementContext,VISUAL_REFINEMENT_SKILL } from '../../src/specialties/software/visual-refinement';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Refinamento visual Unslop',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('reconhece pedidos de refinamento sem ativar em toda edição de código',()=>{
    expect(visualRefinementIntent("Unslop")).toBe(true);
    expect(visualRefinementIntent("Anti-Slop")).toBe(true);
    expect(visualRefinementIntent("Redesign de dashboard")).toBe(true);
    expect(visualRefinementIntent("Refinar a interface do sistema")).toBe(true);
    expect(visualRefinementIntent("Dashboard com aparência genérica")).toBe(true);
    expect(visualRefinementIntent("Melhorar o layout da interface")).toBe(true);
    expect(visualRefinementIntent("Remover gradientes da tela")).toBe(true);
    expect(visualRefinementIntent("Corrigir endpoint")).toBe(false);
    expect(visualRefinementIntent("Ajustar componente React")).toBe(false);
    expect(visualRefinementIntent("Criar formulário React")).toBe(false);
    expect(visualRefinementIntent("Migração Prisma e testes")).toBe(false);
    expect(visualRefinementIntent("Refatorar arquitetura e logs")).toBe(false);
    expect(visualRefinementIntent("Editar imagem de pizza")).toBe(false);
    expect(visualRefinementIntent("Criar vídeo de pizza")).toBe(false);
    expect(visualRefinementIntent("Ajustar interface TypeScript")).toBe(false);
  });
  it('seleciona os nove aspectos conforme a tarefa',()=>{
    expect(visualRefinementFocus("Espaçamento e alinhamento")).toEqual(["espacamento"]);
    expect(visualRefinementFocus("Paleta e contraste")).toEqual(["cores"]);
    expect(visualRefinementFocus("Ícones e emojis")).toEqual(["icones"]);
    expect(visualRefinementFocus("Rótulos e microcopy")).toEqual(["texto"]);
    expect(visualRefinementFocus("Tipografia e legibilidade")).toEqual(["tipografia"]);
    expect(visualRefinementFocus("Layout e responsividade")).toEqual(["layout"]);
    expect(visualRefinementFocus("Bordas e gráficos")).toEqual(["detalhes"]);
    expect(visualRefinementFocus("Imagens e ilustrações")).toEqual(["visuais"]);
    expect(visualRefinementFocus("Animações e transições")).toEqual(["movimento"]);
    expect(visualRefinementFocus("Dashboard com cores e espaçamento")).toEqual(["espacamento","cores","layout"]);
  });
  it('coopera com frontend, preserva isolamento de mídia e usa os mecanismos existentes',()=>{
    const text='Redesign de dashboard';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-frontend','software-refinamento-visual']));
    const sections=softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false});
    expect(sections.filter(s=>s.key==='engenharia-refinamento-visual')).toHaveLength(1);
    expect(sections.find(s=>s.key==='engenharia-refinamento-visual')?.lines.join('\n')).toContain('No plano');
    expect(visualRefinementContext('execution',text).join('\n')).toContain('Na etapa atual');
    expect(visualRefinementContext('planner','Paleta').join('\n')).not.toContain('Movimento:');
    expect(VISUAL_REFINEMENT_SKILL.sourceAttribution).toContain('Damir Sokolovsky');
    expect(VISUAL_REFINEMENT_SKILL.sourceAttribution).toContain('CC BY 4.0');
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags})).not.toContain(VISUAL_REFINEMENT_SKILL);
    }
  });
});
