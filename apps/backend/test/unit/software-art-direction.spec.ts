import { artDirectionIntent,artDirectionFocus,artDirectionContext,ART_DIRECTION_SKILL } from '../../src/specialties/software/art-direction';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Direção artística Design Taste',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('reconhece identidade e criação de sites sem ativar para correções locais ou mídia',()=>{
    expect(artDirectionIntent("Design Taste Frontend")).toBe(true);
    expect(artDirectionIntent("tasteskill")).toBe(true);
    expect(artDirectionIntent("Direção artística para o site")).toBe(true);
    expect(artDirectionIntent("Identidade visual do dashboard")).toBe(true);
    expect(artDirectionIntent("Interface com identidade visual própria")).toBe(true);
    expect(artDirectionIntent("Criar um site para a pizzaria")).toBe(true);
    expect(artDirectionIntent("Desenvolva uma landing page")).toBe(true);
    expect(artDirectionIntent("Definir tipografia do site")).toBe(true);
    expect(artDirectionIntent("Criar loja virtual")).toBe(true);
    expect(artDirectionIntent("Corrigir endpoint")).toBe(false);
    expect(artDirectionIntent("Ajustar componente React")).toBe(false);
    expect(artDirectionIntent("Redesign de dashboard")).toBe(false);
    expect(artDirectionIntent("Criar formulário React")).toBe(false);
    expect(artDirectionIntent("Direção artística de vídeo de pizza")).toBe(false);
    expect(artDirectionIntent("Criar logo da pizzaria")).toBe(false);
    expect(artDirectionIntent("Corrigir interface TypeScript")).toBe(false);
    expect(artDirectionIntent("Migração Prisma e testes")).toBe(false);
  });
  it('seleciona focos de identidade sem impor o mesmo tratamento a todas as tarefas',()=>{
    expect(artDirectionFocus("Público e posicionamento")).toEqual(["segmento"]);
    expect(artDirectionFocus("Marca e paleta")).toEqual(["marca"]);
    expect(artDirectionFocus("Voz e microcopy")).toEqual(["voz"]);
    expect(artDirectionFocus("Tipografia e fontes")).toEqual(["tipografia"]);
    expect(artDirectionFocus("Fotografias e imagens")).toEqual(["imagem"]);
    expect(artDirectionFocus("Assinatura e personalidade")).toEqual(["assinatura"]);
    expect(artDirectionFocus("Consistência e acessibilidade")).toEqual(["coerencia"]);
    expect(artDirectionFocus("Design system e contraste")).toEqual(["marca","coerencia"]);
    expect(artDirectionFocus("Identidade visual e direção artística")).toEqual(["segmento","marca","assinatura"]);
  });
  it('coopera com frontend e Unslop quando pertinentes e preserva isolamento',()=>{
    const text='Redesign de dashboard e identidade visual do site';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-frontend','software-refinamento-visual','software-direcao-artistica']));
    const sections=softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false});
    expect(sections.filter(s=>s.key==='engenharia-direcao-artistica')).toHaveLength(1);
    expect(sections.find(s=>s.key==='engenharia-direcao-artistica')?.lines.join('\n')).toContain('No plano');
    expect(artDirectionContext('execution',text).join('\n')).toContain('Na etapa atual');
    expect(artDirectionContext('planner','Paleta').join('\n')).not.toContain('Imagem:');
    expect(ART_DIRECTION_SKILL.sourceAttribution).toContain('Leonxlnx (MIT)');
    expect(selectSkills({...base,text:'Criar um site para a pizzaria'}).map(s=>s.id)).toEqual(expect.arrayContaining(['software-frontend','software-direcao-artistica']));
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags})).not.toContain(ART_DIRECTION_SKILL);
    }
  });
});
