import { interfaceMotionIntent,interfaceMotionFocus,interfaceMotionContext,INTERFACE_MOTION_SKILL } from '../../src/specialties/software/interface-motion';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Microinterações Design Taste',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('reconhece movimento de interface sem ativar para audiovisual ou correções comuns',()=>{
    expect(interfaceMotionIntent("Microinterações")).toBe(true);
    expect(interfaceMotionIntent("UI motion")).toBe(true);
    expect(interfaceMotionIntent("Animações de interface")).toBe(true);
    expect(interfaceMotionIntent("Animar hover dos cards")).toBe(true);
    expect(interfaceMotionIntent("Transições de estados")).toBe(true);
    expect(interfaceMotionIntent("Frontend com animações e WebGL")).toBe(true);
    expect(interfaceMotionIntent("Landing page com microinterações")).toBe(true);
    expect(interfaceMotionIntent("Corrigir prefers-reduced-motion")).toBe(true);
    expect(interfaceMotionIntent("CSS transitions")).toBe(true);
    expect(interfaceMotionIntent("Animar imagem da pizza em JavaScript")).toBe(false);
    expect(interfaceMotionIntent("Renderizar vídeo 3D")).toBe(false);
    expect(interfaceMotionIntent("Criar vídeo de pizza")).toBe(false);
    expect(interfaceMotionIntent("Corrigir código do encoder de vídeo")).toBe(false);
    expect(interfaceMotionIntent("Corrigir endpoint")).toBe(false);
    expect(interfaceMotionIntent("Ajustar componente React")).toBe(false);
    expect(interfaceMotionIntent("Criar formulário React")).toBe(false);
    expect(interfaceMotionIntent("Migração Prisma e testes")).toBe(false);
    expect(interfaceMotionIntent("Redesign de dashboard")).toBe(false);
    expect(interfaceMotionIntent("Criar um site para a pizzaria")).toBe(false);
  });
  it('carrega focos pertinentes',()=>{
    expect(interfaceMotionFocus("Hover e toque")).toEqual(["feedback"]);
    expect(interfaceMotionFocus("Transições de estados")).toEqual(["estados"]);
    expect(interfaceMotionFocus("Entrada do hero")).toEqual(["entrada"]);
    expect(interfaceMotionFocus("WebGL e shaders")).toEqual(["efeitos"]);
    expect(interfaceMotionFocus("FPS e GPU")).toEqual(["desempenho"]);
    expect(interfaceMotionFocus("Movimento reduzido e teclado")).toEqual(["acessibilidade"]);
    expect(interfaceMotionFocus("Capturas e testes")).toEqual(["evidencia"]);
    expect(interfaceMotionFocus("Hover, modal, WebGL e FPS")).toEqual(["feedback","estados","efeitos","desempenho"]);
  });
  it('coopera com frontend e composição, sem ativar motion audiovisual',()=>{
    const text='Criar dashboard com microinterações e movimento reduzido';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-frontend','software-composicao-interface','software-microinteracoes']));
    expect(skills.map(s=>s.id)).not.toContain('motion');
    const sections=softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false});
    expect(sections.filter(s=>s.key==='engenharia-microinteracoes')).toHaveLength(1);
    expect(sections.find(s=>s.key==='engenharia-microinteracoes')?.lines.join('\n')).toContain('No plano');
    expect(interfaceMotionContext('execution',text).join('\n')).toContain('Na etapa atual');
    expect(interfaceMotionContext('planner','Hover').join('\n')).not.toContain('Efeitos:');
    expect(INTERFACE_MOTION_SKILL.sourceAttribution).toContain('Leonxlnx (MIT)');
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags})).not.toContain(INTERFACE_MOTION_SKILL);
    }
    expect(selectSkills({...base,phase:'execution',software:true,media:true,motionAuthor:true,text:'Animar imagem da pizza em JavaScript'}).map(s=>s.id)).toContain('motion');
    expect(selectSkills({...base,phase:'execution',software:true,media:true,motionAuthor:true,text:'Animar imagem da pizza em JavaScript'})).not.toContain(INTERFACE_MOTION_SKILL);
  });
});
