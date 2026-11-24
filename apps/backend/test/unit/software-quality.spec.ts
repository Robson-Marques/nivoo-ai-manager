import { qualityIntent,qualityFocus,qualityEngineeringContext } from '../../src/specialties/software/quality';
import { selectSkills } from '../../src/specialties/skills';

describe('Engenharia de qualidade',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const ids=(text:string)=>selectSkills({...base,text}).map(s=>s.id);
  it('reconhece qualidade sem confundir tarefas genéricas',()=>{
    expect(qualityIntent("Corrigir erro TS2322")).toBe(true);
    expect(qualityIntent("Corrigir sintaxe Python")).toBe(true);
    expect(qualityIntent("Ajustar src/orders.service.spec.ts")).toBe(true);
    expect(qualityIntent("Revisar tsconfig.build.json")).toBe(true);
    expect(qualityIntent("Criar teste de integração")).toBe(true);
    expect(qualityIntent("Corrigir lint")).toBe(true);
    expect(qualityIntent("Ajustar cobertura de testes")).toBe(true);
    expect(qualityIntent("Criar formulário React")).toBe(false);
    expect(qualityIntent("Criar API de pagamentos")).toBe(false);
    expect(qualityIntent("Atualizar dependências do layout")).toBe(false);
    expect(qualityIntent("Melhorar logs de execução")).toBe(false);
    expect(qualityIntent("Editar arquivo de imagem")).toBe(false);
    expect(ids('Migração Prisma e testes')).toEqual(expect.arrayContaining(['codigo','software-dados','software-qualidade']));
    expect(ids('Corrigir TS2322')).toContain('software-qualidade');
  });
  it('seleciona focos pertinentes',()=>{
    expect(qualityFocus("Corrigir ESLint")).toEqual(["sintaxe"]);
    expect(qualityFocus("Corrigir TS2322")).toEqual(["tipagem"]);
    expect(qualityFocus("Executar build")).toEqual(["compilacao"]);
    expect(qualityFocus("Testes unitários com mocks")).toEqual(["unitarios"]);
    expect(qualityFocus("Testes de integração com Playwright")).toEqual(["integracao"]);
    expect(qualityFocus("Regressão e cobertura")).toEqual(["regressao"]);
    expect(qualityFocus("Ambiente de teste e lockfile")).toEqual(["ambiente"]);
    expect(qualityFocus("Build e testes unitários com Jest")).toEqual(["compilacao","unitarios"]);
  });
  it('distingue as fases e a evidência de validação',()=>{
    const plan=qualityEngineeringContext('planner','Executar build').join('\n');
    const exec=qualityEngineeringContext('execution','Executar build').join('\n');
    expect(plan).toContain('No plano');
    expect(exec).toContain('Na etapa atual');
    expect(exec).toContain('Não repita um build');
    expect(exec).toContain('Não declare sucesso não observado');
    expect(exec).not.toContain('Testes unitários:');
  });
  it('preserva domínio e execução determinística',()=>{
    expect(selectSkills({...base,text:'Corrigir build',software:false}).some(s=>s.id==='software-qualidade')).toBe(false);
    expect(selectSkills({...base,text:'Corrigir build',executor:true})).toEqual([]);
    expect(selectSkills({...base,text:'Animar vídeo e testar',motionAuthor:true,media:true}).some(s=>s.id==='software-qualidade')).toBe(false);
    expect(selectSkills({...base,text:'Gerar imagem e testar',nativeImage:true,media:true}).some(s=>s.id==='software-qualidade')).toBe(false);
    expect(selectSkills({...base,phase:'planner',text:'Corrigir build'}).some(s=>s.id==='software-qualidade')).toBe(true);
  });
});
