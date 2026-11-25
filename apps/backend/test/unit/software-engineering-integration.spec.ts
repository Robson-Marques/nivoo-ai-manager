import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NIVOO_SKILLS,SKILLS_VERSION,selectSkills,skillContext } from '../../src/specialties/skills';
import { SOFTWARE_SKILLS,softwareEngineeringSections } from '../../src/specialties/software/catalog';

describe('Integração de engenharia de software',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const task='Refatorar arquitetura backend e frontend React, migração Prisma, integração webhook, autorização RBAC, testes Jest, desempenho, requisitos, especificação técnica, contexto arquitetural redesign de dashboard , identidade visual do site , composição de interfaces e microinterações';
  const input={phase:'execution' as const,text:task,testDbConfigured:()=>false};
  it('mantém IDs estáveis e registra uma orientação por especialidade selecionada',()=>{
    expect(SKILLS_VERSION).toBe('1.4.7');
    expect(NIVOO_SKILLS).toHaveLength(25);
    expect(SOFTWARE_SKILLS.map(s=>s.id)).toEqual(['software-arquitetura','software-backend','software-frontend','software-dados','software-integracoes','software-seguranca','software-qualidade','software-manutencao','software-requisitos','software-especificacao','software-contexto-arquitetural','software-revisao-independente','software-refinamento-visual','software-direcao-artistica','software-composicao-interface','software-microinteracoes']);
    const skills=selectSkills({...base,text:task});
    expect(skills.filter(s=>s.id.startsWith('software-')).map(s=>s.id)).toEqual(SOFTWARE_SKILLS.filter(s=>s.id!=='software-revisao-independente').map(s=>s.id));
    const exec=softwareEngineeringSections(skills,input);
    const planner=softwareEngineeringSections(selectSkills({...base,phase:'planner',text:task}),{...input,phase:'planner'});
    const expected=['engenharia-backend','engenharia-frontend','engenharia-dados','engenharia-integracoes','engenharia-seguranca','engenharia-qualidade','engenharia-manutencao','engenharia-requisitos','engenharia-especificacao','engenharia-contexto-arquitetural','engenharia-refinamento-visual','engenharia-direcao-artistica','engenharia-composicao-interface','engenharia-microinteracoes'];
    expect(exec.map(s=>s.key)).toEqual(expected);
    expect(planner.map(s=>s.key)).toEqual(expected);
    expect(exec.every(s=>s.lines.join('\n').includes('Na etapa atual'))).toBe(true);
    expect(planner.every(s=>s.lines.join('\n').includes('No plano'))).toBe(true);
  });
  it('não consulta recursos nem carrega contexto de engenharia fora da seleção',()=>{
    const fail=()=>{throw new Error('Consulta de banco não deveria ocorrer');};
    for(const overrides of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      const skills=selectSkills({...base,text:task,...overrides});
      expect(softwareEngineeringSections(skills,{...input,testDbConfigured:fail})).toEqual([]);
    }
    const skills=selectSkills({...base,text:'Corrigir endpoint'});
    expect(softwareEngineeringSections(skills,{...input,text:'Corrigir endpoint',testDbConfigured:fail}).map(s=>s.key)).toEqual(['engenharia-backend']);
  });
  it('consulta configuração de banco só uma vez e respeita recuperação da etapa',()=>{
    let calls=0;
    const data=selectSkills({...base,text:'Migração Prisma'});
    const sections=softwareEngineeringSections(data,{...input,text:'Migração Prisma',testDbConfigured:()=>{calls++;return true;}});
    expect(calls).toBe(1);
    expect(sections.find(s=>s.key==='engenharia-dados')?.lines.join('\n')).toContain('disponibilidade efetiva depende da conexão');
    const text='Corrigir endpoint';
    const recovery=softwareEngineeringSections(selectSkills({...base,text,previousError:true}),{...input,text,previousError:true});
    expect(recovery.find(s=>s.key==='engenharia-manutencao')?.lines.join('\n')).toContain('última conferência e o checkpoint');
  });
  it('materializa somente skills selecionadas e um índice de arquitetura real',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-engineering-'));
    try{
      fs.writeFileSync(path.join(dir,'package.json'),'{}');
      const text='Corrigir endpoint';
      const skills=selectSkills({...base,text});
      skillContext(skills,dir);
      const sections=softwareEngineeringSections(skills,{...input,text,worktree:dir});
      expect(sections.map(s=>s.key)).toEqual(['arquitetura-workspace','engenharia-backend']);
      expect(fs.readdirSync(path.join(dir,'contexto','skills-nivoo')).sort()).toEqual(skills.map(s=>s.id).sort());
      expect(fs.readFileSync(path.join(dir,'contexto','acervo','arquitetura-001.md'),'utf8')).toContain('package.json');
      expect(fs.existsSync(path.join(dir,'contexto','acervo','arquitetura-indice.md'))).toBe(true);
      expect(fs.readFileSync(path.join(dir,'package.json'),'utf8')).toBe('{}');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
