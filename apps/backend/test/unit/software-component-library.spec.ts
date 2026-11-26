import { componentLibraryIntent,componentLibraryFocus,componentLibraryContext,COMPONENT_LIBRARY_SKILL } from '../../src/specialties/software/component-library';
import { selectSkills } from '../../src/specialties/skills';
import { softwareEngineeringSections } from '../../src/specialties/software/catalog';
import { MCP_PRONTOS } from '../../src/mcp/mcp';
import { configClaude,codexMcpSession,serversGemini } from '../../src/mcp/para-ia';

describe('Biblioteca 21st.dev',()=>{
  const base={phase:'planner' as const,media:false,software:true};
  it('seleciona catálogo ou criação de interfaces sem acionar em correções locais',()=>{
    expect(componentLibraryIntent("21st.dev MCP")).toBe(true);
    expect(componentLibraryIntent("Biblioteca de componentes")).toBe(true);
    expect(componentLibraryIntent("Buscar componentes profissionais")).toBe(true);
    expect(componentLibraryIntent("Criar dashboard")).toBe(true);
    expect(componentLibraryIntent("Desenvolva uma landing page")).toBe(true);
    expect(componentLibraryIntent("Criar um site para a pizzaria")).toBe(true);
    expect(componentLibraryIntent("Magic MCP")).toBe(true);
    expect(componentLibraryIntent("Corrigir endpoint")).toBe(false);
    expect(componentLibraryIntent("Ajustar componente React")).toBe(false);
    expect(componentLibraryIntent("Criar formulário React")).toBe(false);
    expect(componentLibraryIntent("Migração Prisma e testes")).toBe(false);
    expect(componentLibraryIntent("Integração webhook com autenticação")).toBe(false);
    expect(componentLibraryIntent("Editar imagem de pizza")).toBe(false);
    expect(componentLibraryIntent("Criar vídeo de pizza")).toBe(false);
    expect(componentLibraryIntent("Ajustar interface TypeScript")).toBe(false);
  });
  it('seleciona focos',()=>{
    expect(componentLibraryFocus("Busca e catálogo")).toEqual(["selecao"]);
    expect(componentLibraryFocus("React e tokens")).toEqual(["adaptacao"]);
    expect(componentLibraryFocus("Cotas e licença")).toEqual(["limites"]);
    expect(componentLibraryFocus("Testes e responsividade")).toEqual(["evidencia"]);
    expect(componentLibraryFocus("Componentes React e cota")).toEqual(["selecao","adaptacao","limites"]);
  });
  it('compõe orientação e preserva escopo de mídia',()=>{
    const text='Criar dashboard com biblioteca de componentes 21st.dev';
    const skills=selectSkills({...base,text});
    expect(skills.map(s=>s.id)).toEqual(expect.arrayContaining(['codigo','software-frontend','software-composicao-interface','software-biblioteca-componentes']));
    expect(softwareEngineeringSections(skills,{phase:'planner',text,testDbConfigured:()=>false}).filter(s=>s.key==='engenharia-biblioteca-componentes')).toHaveLength(1);
    expect(componentLibraryContext('planner',text).join('\n')).toContain('No plano');
    expect(componentLibraryContext('execution',text).join('\n')).toContain('Na etapa atual');
    expect(componentLibraryContext('execution',text).join('\n')).toContain('implementação local');
    for(const flags of [{software:false},{executor:true},{nativeImage:true},{motionAuthor:true}])expect(selectSkills({...base,text,...flags})).not.toContain(COMPONENT_LIBRARY_SKILL);
  });
  it('usa o transporte HTTP existente e cabeçalho secreto',()=>{
    const p=MCP_PRONTOS.find(x=>x.chave==='21st')!;
    expect(p).toMatchObject({url:'https://21st.dev/api/mcp',cabecalhos:['x-api-key'],somenteProjetosEscolhidos:true});
    const m=[{nome:'21st-dev',tipo:'http' as const,url:p.url,headers:{'x-api-key':'dummy'}}];
    expect(configClaude(m).mcpServers['21st-dev']).toMatchObject({type:'http',url:p.url,headers:{'x-api-key':'dummy'}});
    // O Codex recebe o cabeçalho secreto por variável de ambiente aliased, nunca
    // inline na linha de comando (não vaza em listagens de processo).
    const codex=codexMcpSession(m);
    const argsText=codex.args.join(' ');
    expect(argsText).toContain('env_http_headers');
    expect(argsText).not.toContain('dummy');
    const alias=Object.keys(codex.env).find(k=>codex.env[k]==='dummy');
    expect(alias).toBeTruthy();
    expect(argsText).toContain(alias!);
    expect(serversGemini(m)['21st-dev']).toMatchObject({httpUrl:p.url,headers:{'x-api-key':'dummy'}});
  });
});
