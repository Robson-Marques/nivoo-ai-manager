import { securityIntent,securityFocus,securityEngineeringContext } from '../../src/specialties/software/security';
import { selectSkills } from '../../src/specialties/skills';

describe('Engenharia de segurança',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const ids=(text:string)=>selectSkills({...base,text}).map(s=>s.id);
  it('reconhece intenção de segurança sem confundir tarefas genéricas',()=>{
    expect(securityIntent("Corrigir autenticação local")).toBe(true);
    expect(securityIntent("Corrigir webhook com autenticação")).toBe(true);
    expect(securityIntent("Revisar src/auth/access.guard.ts")).toBe(true);
    expect(securityIntent("Revisar src/security/policy.ts")).toBe(true);
    expect(securityIntent("Corrigir IDOR")).toBe(true);
    expect(securityIntent("Evitar prompt injection")).toBe(true);
    expect(securityIntent("Corrigir CVE-2026-1234")).toBe(true);
    expect(securityIntent("Criar formulário React")).toBe(false);
    expect(securityIntent("Atualizar dependências do layout")).toBe(false);
    expect(securityIntent("Ajustar logs do vídeo")).toBe(false);
    expect(securityIntent("Reduzir tokens no prompt")).toBe(false);
    expect(securityIntent("Criar integração de pagamentos")).toBe(false);
    expect(ids('Corrigir webhook com autenticação')).toEqual(expect.arrayContaining(['codigo','software-integracoes','software-seguranca']));
    expect(ids('Criar formulário React')).not.toContain('software-seguranca');
  });
  it('seleciona focos pertinentes',()=>{
    expect(securityFocus("Autenticação e JWT")).toEqual(["identidade"]);
    expect(securityFocus("Autorização RBAC")).toEqual(["autorizacao"]);
    expect(securityFocus("SQL injection e XSS")).toEqual(["entradas"]);
    expect(securityFocus("Rotação de credenciais")).toEqual(["segredos"]);
    expect(securityFocus("Isolamento entre projetos")).toEqual(["isolamento"]);
    expect(securityFocus("Vulnerabilidade CVE-2026-1234")).toEqual(["dependencias"]);
    expect(securityFocus("Auditoria e testes")).toEqual(["evidencias"]);
  });
  it('distingue planejamento de execução e não concede acesso',()=>{
    const plan=securityEngineeringContext('planner','Autorização RBAC').join('\n');
    const exec=securityEngineeringContext('execution','Autorização RBAC').join('\n');
    expect(plan).toContain('No plano');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('não produza efeito indevido');
    expect(exec).toContain('não concede acesso');
    expect(exec).toContain('Autorização:');
    expect(exec).not.toContain('Dependências:');
    expect(securityEngineeringContext('execution','Segurança').join('\n')).toContain('aprovações existentes prevalecem');
  });
  it('preserva isolamento de domínio e execução determinística',()=>{
    expect(selectSkills({...base,text:'Corrigir autorização',software:false}).some(s=>s.id==='software-seguranca')).toBe(false);
    expect(selectSkills({...base,text:'Corrigir autorização',executor:true})).toEqual([]);
    expect(selectSkills({...base,text:'Criar animação com login',motionAuthor:true,media:true}).some(s=>s.id==='software-seguranca')).toBe(false);
    expect(selectSkills({...base,text:'Gerar imagem de login',nativeImage:true,media:true}).some(s=>s.id==='software-seguranca')).toBe(false);
    expect(selectSkills({...base,phase:'planner',text:'Corrigir autorização'}).some(s=>s.id==='software-seguranca')).toBe(true);
  });
});
