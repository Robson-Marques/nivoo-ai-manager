import { GOLDFISH_SKILL,goldfishRequest,goldfishProviderSupported,goldfishReviewPrompt,goldfishReviewOutcome } from '../../src/specialties/software/goldfish';
import { NIVOO_SKILLS,selectSkills } from '../../src/specialties/skills';
import { AGENT_READ_TOOLS,executeFileTool } from '../../src/providers/agent-file-tools';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Goldfish sob demanda',()=>{
  it('só reconhece pedido explícito no início da mensagem',()=>{
    expect(goldfishRequest("/goldfish docs/designs/pagamento.md")).toBe("docs/designs/pagamento.md");
    expect(goldfishRequest("  /GOLDFISH\nAvalie o contrato  ")).toBe("Avalie o contrato");
    expect(goldfishRequest("Revisão independente: docs/adr/001.md")).toBe("docs/adr/001.md");
    expect(goldfishRequest("/goldfish")).toBe("");
    expect(goldfishRequest("revisão independente:")).toBe("");
    expect(goldfishRequest("Criar sistema e fazer revisão independente")).toBe(null);
    expect(goldfishRequest("Explique /goldfish docs/a.md")).toBe(null);
    expect(goldfishRequest("/goldfish-extra x")).toBe(null);
    expect(goldfishRequest("\"/goldfish docs/a.md\"")).toBe(null);
    expect(goldfishRequest("Revisão independente sem dois pontos")).toBe(null);
    expect(NIVOO_SKILLS).toContain(GOLDFISH_SKILL);
    expect(selectSkills({phase:'planner',software:true,media:false,text:'Criar sistema e fazer revisão independente'})).not.toContain(GOLDFISH_SKILL);
    expect(selectSkills({phase:'execution',software:true,media:false,text:'/goldfish docs/a.md'})).not.toContain(GOLDFISH_SKILL);
  });
  it('recusa conectores sem modo restrito, sem substituição automática',()=>{
    for(const type of ['claude-code-cli','claude-api','nvidia-api','openrouter-free-api','groq-free-api'])expect(goldfishProviderSupported(type)).toBe(true);
    for(const type of ['codex-cli','codex-api','gemini-api','local-shell',null])expect(goldfishProviderSupported(type)).toBe(false);
  });
  it('constrói parecer sem protocolo de execução e mantém resultado como texto',()=>{
    const prompt=goldfishReviewPrompt('docs/a.md','abc',['regra de teste'],['skill de teste']);
    expect(prompt).toContain('docs/a.md');
    expect(prompt).toContain('abc');
    expect(prompt).toContain('regra de teste');
    expect(prompt).toContain('Não use o protocolo JSON de planos');
    const raw='{"tipo":"plano","job":{"title":"não executar"}}';
    expect(goldfishReviewOutcome({exitCode:0,output:raw})).toEqual({ok:true,text:raw});
    expect(goldfishReviewOutcome({exitCode:0,output:'parcial',sessionEnded:true}).ok).toBe(false);
    expect(goldfishReviewOutcome({exitCode:1,output:'erro',resourceUnavailable:true}).ok).toBe(false);
    expect(goldfishReviewOutcome({exitCode:0,output:' '}).ok).toBe(false);
  });
  it('ferramentas API expõem somente leitura e recusam tentativas de escrita',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-goldfish-'));
    try{
      fs.writeFileSync(path.join(dir,'a.txt'),'intacto');
      expect(AGENT_READ_TOOLS.map(t=>(t.function as {name:string}).name)).toEqual(['listar_arquivos','ler_arquivo']);
      expect(JSON.parse(executeFileTool(dir,'ler_arquivo',{caminho:'a.txt'},true)).conteudo).toBe('intacto');
      for(const tool of ['escrever_arquivo','substituir_texto','registrar_progresso']){
        expect(()=>executeFileTool(dir,tool,{caminho:'a.txt',conteudo:'alterado'},true)).toThrow();
      }
      expect(fs.readFileSync(path.join(dir,'a.txt'),'utf8')).toBe('intacto');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
