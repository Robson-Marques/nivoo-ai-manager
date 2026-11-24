import { frontendIntent,frontendFocus,frontendEngineeringContext } from '../../src/specialties/software/frontend';
import { selectSkills } from '../../src/specialties/skills';

describe('Engenharia de frontend',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const ids=(text:string)=>selectSkills({...base,text}).map(s=>s.id);
  it('reconhece interfaces reais sem confundir contratos de tipos',()=>{
    expect(frontendIntent('Ajustar src/components/Form.tsx')).toBe(true);
    expect(frontendIntent('Corrigir tela de cadastro')).toBe(true);
    expect(frontendIntent('Corrigir teclado virtual no PWA iOS')).toBe(true);
    expect(frontendIntent('Refatorar interface TypeScript de um DTO')).toBe(false);
    expect(frontendIntent('Corrigir endpoint')).toBe(false);
    expect(ids('Ajustar src/components/Form.tsx')).toContain('software-frontend');
  });
  it('carrega focos pertinentes',()=>{
    expect(frontendFocus('Corrigir componente React')).toEqual(['componentes']);
    expect(frontendFocus('Formulário: salvar via API e manter foco')).toEqual(['formularios','api','acessibilidade']);
    expect(frontendFocus('Viewport PWA com teclado virtual')).toEqual(['responsividade','acessibilidade']);
    expect(frontendFocus('Estado da sessão e resposta atrasada')).toEqual(['estado']);
  });
  it('distingue planejamento de execução e reaproveita a conferência existente',()=>{
    const plan=frontendEngineeringContext('planner','Corrigir tela React').join('\n');
    const exec=frontendEngineeringContext('execution','Corrigir tela React').join('\n');
    expect(plan).toContain('No plano');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('Componentes:');
    expect(exec).not.toContain('Formulários e ações:');
    expect(exec).toContain('nivoo-conferir-telas');
    expect(exec).toContain('Uma captura de tela não comprova persistência');
  });
  it('permite operação full stack e mantém exclusões de mídia e executores',()=>{
    expect(ids('Corrigir frontend React e endpoint backend')).toEqual(expect.arrayContaining(['software-backend','software-frontend']));
    expect(selectSkills({...base,text:'Corrigir tela React',software:false}).some(s=>s.id==='software-frontend')).toBe(false);
    expect(selectSkills({...base,text:'Corrigir tela React',executor:true})).toEqual([]);
    expect(selectSkills({...base,text:'Criar composição em React',motionAuthor:true,media:true}).some(s=>s.id==='software-frontend')).toBe(false);
    expect(selectSkills({...base,text:'Criar imagem de interface React',nativeImage:true,media:true}).some(s=>s.id==='software-frontend')).toBe(false);
  });
});
