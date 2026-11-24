import { backendIntent,backendFocus,backendEngineeringContext } from '../../src/specialties/software/backend';
import { selectSkills } from '../../src/specialties/skills';

describe('Engenharia de backend',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const ids=(text:string)=>selectSkills({...base,text}).map(s=>s.id);
  it('reconhece fonte específica e intenção operacional sem impor framework',()=>{
    expect(backendIntent('Ajustar src/jobs/jobs.service.ts')).toBe(true);
    expect(backendIntent('Corrigir a rota HTTP de cadastro')).toBe(true);
    expect(backendIntent('Criar formulário React')).toBe(false);
    expect(ids('Ajustar src/jobs/jobs.service.ts')).toContain('software-backend');
  });
  it('seleciona focos relevantes sem carregar todos os demais',()=>{
    expect(backendFocus('Corrigir endpoint com DTO')).toEqual(['entrada']);
    expect(backendFocus('Fila de pagamentos com transição de estado, idempotência e timeout')).toEqual(['negocio','assincrono','estados','concorrencia','falhas']);
    expect(backendFocus('Corrigir regra de negócio')).toEqual(['negocio']);
    expect(backendFocus('backend')).toEqual([]);
  });
  it('distingue planejamento e execução sem acrescentar etapas',()=>{
    const plan=backendEngineeringContext('planner','Corrigir endpoint').join('\n');
    const exec=backendEngineeringContext('execution','Corrigir endpoint').join('\n');
    expect(plan).toContain('No plano');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('Entrada/saída');
    expect(exec).not.toContain('Assíncrono:');
    expect(exec).not.toContain('Concorrência:');
  });
  it('preserva isolamento do domínio e os executores locais',()=>{
    expect(selectSkills({...base,text:'Corrigir worker',software:false}).some(s=>s.id==='software-backend')).toBe(false);
    expect(selectSkills({...base,text:'Corrigir worker',executor:true})).toEqual([]);
    expect(selectSkills({...base,text:'Corrigir worker',motionAuthor:true,media:true}).some(s=>s.id==='software-backend')).toBe(false);
  });
});
