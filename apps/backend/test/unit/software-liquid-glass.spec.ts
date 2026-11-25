import { LIQUID_GLASS_SKILL,liquidGlassIntent,liquidGlassFocus,liquidGlassContext } from '../../src/specialties/software/liquid-glass';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';
import { selectedVisualStyleId } from '../../src/projects/visual-profile';

describe('Liquid Glass Nivoo',()=>{
  it('ativa por solicitação explícita ou trabalho visual com perfil aprovado',()=>{
    expect(liquidGlassIntent("Liquid Glass",undefined)).toBe(true);
    expect(liquidGlassIntent("Aplicar Liquid Glass",undefined)).toBe(true);
    expect(liquidGlassIntent("Criar dashboard Liquid Glass",undefined)).toBe(true);
    expect(liquidGlassIntent("Vidro líquido nos botões",undefined)).toBe(true);
    expect(liquidGlassIntent("CSS com Liquid Glass",undefined)).toBe(true);
    expect(liquidGlassIntent("Criar dashboard","liquid-glass")).toBe(true);
    expect(liquidGlassIntent("Melhorar layout do frontend","liquid-glass")).toBe(true);
    expect(liquidGlassIntent("Criar formulário","liquid-glass")).toBe(true);
    expect(liquidGlassIntent("Ajustar CSS","liquid-glass")).toBe(true);
    expect(liquidGlassIntent("Corrigir endpoint","liquid-glass")).toBe(false);
    expect(liquidGlassIntent("Migração Prisma","liquid-glass")).toBe(false);
    expect(liquidGlassIntent("Ajustar componente React","liquid-glass")).toBe(false);
    expect(liquidGlassIntent("Criar dashboard","minimalist")).toBe(false);
    expect(liquidGlassIntent("Criar dashboard",undefined)).toBe(false);
    expect(liquidGlassIntent("Criar vídeo Liquid Glass",undefined)).toBe(false);
    expect(liquidGlassIntent("Criar pôster Liquid Glass",undefined)).toBe(false);
    expect(liquidGlassIntent("Criar vídeo de pizza","liquid-glass")).toBe(false);
    expect(liquidGlassIntent("Criar dashboard sem Liquid Glass","liquid-glass")).toBe(false);
    expect(liquidGlassIntent("Remover Liquid Glass do frontend","liquid-glass")).toBe(false);
    expect(liquidGlassIntent("Glassmorphism no frontend",undefined)).toBe(false);
  });
  it('seleciona focos pertinentes e diferencia vidro de refração',()=>{
    expect(liquidGlassFocus("Refração SVG")).toEqual(["refracao"]);
    expect(liquidGlassFocus("Dashboard e tabelas")).toEqual(["camadas"]);
    expect(liquidGlassFocus("Iluminação e sombra")).toEqual(["material"]);
    expect(liquidGlassFocus("Contraste e teclado")).toEqual(["acessibilidade"]);
    expect(liquidGlassFocus("GPU e fallback")).toEqual(["desempenho"]);
    expect(liquidGlassFocus("Microinterações e movimento")).toEqual(["movimento"]);
    expect(liquidGlassFocus("Transparência em menus")).toEqual(["material","camadas","acessibilidade"]);
    expect(liquidGlassContext('planner','Refração SVG').join('\n')).toContain('No plano');
    expect(liquidGlassContext('execution','Refração SVG').join('\n')).toContain('Na etapa atual');
    expect(liquidGlassContext('execution','Contraste').join('\n')).not.toContain('- Refração:');
    expect(LIQUID_GLASS_SKILL.body).toContain('não desvia a imagem de fundo');
  });
  it('valida escolha persistida, coopera com frontend e exclui mídia/executor',()=>{
    const base={phase:'planner' as const,media:false,software:true,text:'Criar dashboard'};
    const visualStyleId=selectedVisualStyleId({schemaVersion:1,mode:'guided',styleId:'liquid-glass'});
    expect(visualStyleId).toBe('liquid-glass');
    for(const value of [null,{},'liquid-glass',{schemaVersion:1,mode:'guided',styleId:'unknown'},{schemaVersion:2,mode:'guided',styleId:'liquid-glass'}])expect(selectedVisualStyleId(value)).toBeUndefined();
    const skills=selectSkills({...base,visualStyleId});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-frontend','software-liquid-glass']));
    expect(softwareEngineeringSections(skills,{phase:'planner',text:base.text,testDbConfigured:()=>false}).filter(s=>s.key==='engenharia-liquid-glass')).toHaveLength(1);
    expect(selectSkills(base)).not.toContain(LIQUID_GLASS_SKILL);
    expect(selectSkills({...base,visualStyleId,text:'Corrigir endpoint'})).not.toContain(LIQUID_GLASS_SKILL);
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}])expect(selectSkills({...base,visualStyleId,...flags})).not.toContain(LIQUID_GLASS_SKILL);
    expect(selectSkills({...base,phase:'execution',visualStyleId}).map(s=>s.id)).toContain('software-liquid-glass');
  });
});
