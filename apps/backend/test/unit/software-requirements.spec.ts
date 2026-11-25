import { requirementsIntent,requirementsFocus,requirementsEngineeringContext } from '../../src/specialties/software/requirements';
import { selectSkills,skillContext } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Engenharia de requisitos',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('reconhece descoberta e construção de produto sem acionar em toda correção',()=>{
    expect(requirementsIntent("Desenvolva um sistema de cadastro de clientes")).toBe(true);
    expect(requirementsIntent("Criar ERP para provedor")).toBe(true);
    expect(requirementsIntent("Sistema completo de atendimento")).toBe(true);
    expect(requirementsIntent("Levantar requisitos e critérios de aceitação")).toBe(true);
    expect(requirementsIntent("Definir escopo do produto")).toBe(true);
    expect(requirementsIntent("Corrigir endpoint")).toBe(false);
    expect(requirementsIntent("Criar formulário React")).toBe(false);
    expect(requirementsIntent("Ajustar login")).toBe(false);
    expect(requirementsIntent("Editar imagem de pizza")).toBe(false);
    expect(requirementsIntent("Refatorar arquitetura backend e frontend React, migração Prisma, integração webhook, autorização RBAC, testes Jest e desempenho")).toBe(false);
  });
  it('seleciona focos pertinentes',()=>{
    expect(requirementsFocus("Problema e objetivos")).toEqual(["problema"]);
    expect(requirementsFocus("Usuários e operadores")).toEqual(["usuarios"]);
    expect(requirementsFocus("Escopo e requisitos")).toEqual(["escopo"]);
    expect(requirementsFocus("Critérios de aceitação e métricas")).toEqual(["aceitacao"]);
    expect(requirementsFocus("Riscos e alternativas")).toEqual(["riscos"]);
    expect(requirementsFocus("Hipóteses e decisões")).toEqual(["decisoes"]);
    expect(requirementsFocus("Objetivos, usuários, requisitos e critérios de aceitação")).toEqual(["problema","usuarios","escopo","aceitacao"]);
  });
  it('carrega apenas a orientação selecionada nas fases existentes',()=>{
    const text='Desenvolva um sistema de cadastro de clientes com requisitos e critérios de aceitação';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toContain('software-requisitos');
    expect(softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false}).find(s=>s.key==='engenharia-requisitos')?.lines.join('\n')).toContain('No plano');
    expect(requirementsEngineeringContext('execution',text).join('\n')).toContain('Na etapa atual');
    expect(requirementsEngineeringContext('planner',text).join('\n')).toContain('Não declare revisão Goldfish independente');
    expect(selectSkills({...base,text:'Corrigir endpoint'}).some(s=>s.id==='software-requisitos')).toBe(false);
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}]){
      expect(selectSkills({...base,text,...flags}).some(s=>s.id==='software-requisitos')).toBe(false);
    }
  });
  it('materializa atribuição correta, preservando a origem NVIDIA das outras Skills',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-requirements-'));
    try{
      const skills=selectSkills({...base,phase:'execution',text:'Desenvolva um sistema de cadastro de clientes'});
      skillContext(skills,dir);
      const read=(id:string)=>fs.readFileSync(path.join(dir,'contexto','skills-nivoo',id,'SKILL.md'),'utf8');
      expect(read('software-requisitos')).toContain('Elephant-Goldfish Model (Apache-2.0)');
      expect(read('software-requisitos')).not.toContain('NVIDIA Agent Skills');
      expect(read('execucao-enxuta')).toContain('NVIDIA Agent Skills (Apache-2.0)');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
