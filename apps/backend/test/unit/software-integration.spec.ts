import { integrationIntent,integrationFocus,integrationEngineeringContext } from '../../src/specialties/software/integration';
import { selectSkills } from '../../src/specialties/skills';

describe('Engenharia de integrações',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const ids=(text:string)=>selectSkills({...base,text}).map(s=>s.id);
  it('reconhece integração sem pressupor provedor',()=>{
    expect(integrationIntent('Corrigir src/gateway/payment.adapter.ts')).toBe(true);
    expect(integrationIntent('Integrar API de pagamentos')).toBe(true);
    expect(integrationIntent('Criar formulário React')).toBe(false);
    expect(integrationIntent('Ajustar autenticação local')).toBe(false);
    expect(ids('Corrigir webhook com autenticação')).toEqual(expect.arrayContaining(['software-integracoes','software-seguranca']));
  });
  it('seleciona focos de acordo com o contrato',()=>{
    expect(integrationFocus('Contrato de API REST')).toEqual(['contratos']);
    expect(integrationFocus('OAuth e refresh')).toEqual(['autenticacao']);
    expect(integrationFocus('Webhook com assinatura e timeout')).toEqual(['autenticacao','eventos','recuperacao']);
    expect(integrationFocus('Sincronização incremental por cursor')).toEqual(['sincronizacao']);
    expect(integrationFocus('Streaming SSE com cancelamento')).toEqual(['streaming']);
    expect(integrationFocus('Idempotência e Retry-After')).toEqual(['recuperacao']);
  });
  it('distingue plano, execução e efeitos remotos incertos',()=>{
    const plan=integrationEngineeringContext('planner','Webhook com timeout').join('\n');
    const exec=integrationEngineeringContext('execution','Webhook com timeout').join('\n');
    expect(plan).toContain('No plano');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('Confirme o resultado real');
    expect(exec).toContain('resultado incerto');
    expect(exec).toContain('Diferencie mock, teste de contrato e integração real');
    expect(exec).not.toContain('Sincronização:');
  });
  it('preserva isolamento de domínio e execução determinística',()=>{
    expect(selectSkills({...base,text:'Corrigir webhook',software:false}).some(s=>s.id==='software-integracoes')).toBe(false);
    expect(selectSkills({...base,text:'Corrigir webhook',executor:true})).toEqual([]);
    expect(selectSkills({...base,text:'Criar animação com API externa',motionAuthor:true,media:true}).some(s=>s.id==='software-integracoes')).toBe(false);
    expect(selectSkills({...base,text:'Gerar imagem via API externa',nativeImage:true,media:true}).some(s=>s.id==='software-integracoes')).toBe(false);
  });
});
