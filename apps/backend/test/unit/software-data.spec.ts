import { dataIntent,dataFocus,dataEngineeringContext } from '../../src/specialties/software/data';
import { selectSkills } from '../../src/specialties/skills';
import { nomeDeBancoDescartavelValido,nomeDoBancoDeTeste } from '../../src/common/banco-de-teste';

describe('Engenharia de dados',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  it('seleciona persistência por intenção, sem impor banco',()=>{
    expect(dataIntent('Corrigir migrations/001.sql')).toBe(true);
    expect(dataIntent('Ajustar consulta de pedidos')).toBe(true);
    expect(dataIntent('Criar formulário React')).toBe(false);
    expect(selectSkills({...base,text:'Migração Prisma'}).map(s=>s.id)).toContain('software-dados');
    expect(selectSkills({...base,text:'Migração Prisma',executor:true})).toEqual([]);
    expect(selectSkills({...base,text:'Migração Prisma',software:false}).some(s=>s.id==='software-dados')).toBe(false);
  });
  it('carrega focos seletivos',()=>{
    expect(dataFocus('Schema Prisma')).toEqual(['modelagem']);
    expect(dataFocus('Migração com backfill')).toEqual(['migracoes']);
    expect(dataFocus('Transação e rollback')).toEqual(['transacoes']);
    expect(dataFocus('Consulta com paginação e índice')).toEqual(['consultas']);
    expect(dataFocus('Restrição unique')).toEqual(['integridade']);
    expect(dataFocus('Banco de teste com fixtures')).toEqual(['isolamento']);
  });
  it('distingue configuração de conectividade e não usa produção como fallback',()=>{
    const plan=dataEngineeringContext('planner','Migração',true).join('\n');
    const exec=dataEngineeringContext('execution','Migração',false).join('\n');
    expect(plan).toContain('disponibilidade efetiva depende da conexão');
    expect(exec).toContain('não está configurado');
    expect(exec).toContain('Nunca use produção');
    expect(exec).not.toContain('Consultas:');
  });
  it('limita os nomes descartáveis ao identificador e preserva prévias existentes',()=>{
    const id='ab123456-1234-1234-1234-123456789abc';
    const name=nomeDoBancoDeTeste(id);
    expect(nomeDeBancoDescartavelValido(id,name)).toBe(true);
    expect(nomeDeBancoDescartavelValido(id,name.replace(/^teste_/,'previa_'))).toBe(true);
    expect(nomeDeBancoDescartavelValido(id,'nivoo')).toBe(false);
    expect(nomeDeBancoDescartavelValido(id,'teste_deadbeef')).toBe(false);
    expect(nomeDeBancoDescartavelValido(id,name+'"; DROP DATABASE nivoo; --')).toBe(false);
    expect(nomeDeBancoDescartavelValido('','teste_')).toBe(false);
  });
});
