import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeFileTool,skillReadReceipt,announceSkillRead,AGENT_READ_TOOLS } from '../../src/providers/agent-file-tools';
describe('Ferramentas compartilhadas de arquivo',()=>{
  let root:string;
  beforeEach(()=>root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-file-tools-')));
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  const call=(name:string,args:Record<string,unknown>)=>JSON.parse(executeFileTool(root,name,args));
  it('lê skills e grava notas sem liberar escrita no contexto',()=>{
    fs.mkdirSync(path.join(root,'contexto/skills-nivoo/codigo'),{recursive:true});
    fs.writeFileSync(path.join(root,'contexto/skills-nivoo/codigo/SKILL.md'),'Instruções');
    expect(call('ler_arquivo',{caminho:'contexto/skills-nivoo/codigo/SKILL.md'}).conteudo).toBe('Instruções');
    expect(()=>call('escrever_arquivo',{caminho:'contexto/skills-nivoo/codigo/SKILL.md',conteudo:'x'})).toThrow();
    const note={tipo:'PROGRESSO',titulo:'Etapa',conteudo:'Feito'};
    expect(call('registrar_progresso',note).alterado).toBe(true);
    expect(call('registrar_progresso',note).alterado).toBe(false);
    expect(fs.readFileSync(path.join(root,'.nivoo/notas.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
  });
  it('permite ler o histórico de tentativas gerado pelo backend sem liberar outros arquivos internos',()=>{
    fs.mkdirSync(path.join(root,'contexto'));
    fs.writeFileSync(path.join(root,'contexto/tentativas-da-etapa.md'),'Falha anterior');
    fs.writeFileSync(path.join(root,'contexto/privado.txt'),'Interno');
    expect(call('ler_arquivo',{caminho:'contexto/tentativas-da-etapa.md'}).conteudo).toBe('Falha anterior');
    expect(call('listar_arquivos',{pasta:'contexto'}).arquivos).toContain('contexto/tentativas-da-etapa.md');
    expect(()=>call('ler_arquivo',{caminho:'contexto/privado.txt'})).toThrow();
    expect(()=>call('escrever_arquivo',{caminho:'contexto/tentativas-da-etapa.md',conteudo:'alterado'})).toThrow();
  });
  it('registra páginas de skill realmente retornadas, sem expor seu texto nem aceitar avisos como leitura',()=>{
    const p='contexto/skills-nivoo/codigo/SKILL.md';
    fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});
    fs.writeFileSync(path.join(root,p),'0123456789');
    const result=executeFileTool(root,'ler_arquivo',{caminho:p,inicio:2,limite:4},true);
    const receipt=skillReadReceipt('ler_arquivo',result);
    expect(receipt).toMatchObject({path:p,start:2,end:6,total:10,sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
    const log=jest.fn();announceSkillRead('ler_arquivo',result,log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('intervalo=2..6/10'));
    expect(skillReadReceipt('ler_arquivo',JSON.stringify({aviso:'já lido'}))).toBeNull();
    expect(skillReadReceipt('listar_arquivos',result)).toBeNull();
    expect(skillReadReceipt('ler_arquivo',JSON.stringify({...JSON.parse(result),proximo:10}))).toBeNull();
    expect(skillReadReceipt('ler_arquivo',executeFileTool(root,'ler_arquivo',{caminho:p,inicio:10},true))).toBeNull();
  });
  it('expõe apenas as operações permitidas na sessão de leitura',()=>{
    expect(AGENT_READ_TOOLS.map(t=>(t.function as {name:string}).name)).toEqual(['listar_arquivos','ler_arquivo']);
  });
  it('planejador tem somente leitura',()=>{
    fs.writeFileSync(path.join(root,'a.txt'),'original');
    expect(JSON.parse(executeFileTool(root,'ler_arquivo',{caminho:'a.txt'},true)).conteudo).toBe('original');
    expect(()=>executeFileTool(root,'escrever_arquivo',{caminho:'a.txt',conteudo:'x'},true)).toThrow();
    expect(()=>executeFileTool(root,'registrar_progresso',{tipo:'PROGRESSO',titulo:'x',conteudo:'x'},true)).toThrow();
    expect(fs.readFileSync(path.join(root,'a.txt'),'utf8')).toBe('original');
  });
  it('paginação não trunca JSON escapado',()=>{
    fs.writeFileSync(path.join(root,'a.txt'),'\n'.repeat(18000));
    const r=call('ler_arquivo',{caminho:'a.txt'});
    expect(r.temMais).toBe(true);
    expect(r.proximo).toBe(r.conteudo.length);
    expect(call('ler_arquivo',{caminho:'a.txt',inicio:r.proximo}).inicio).toBe(r.proximo);
  });
  it('preserva binários, links e permissões e detecta mudança de conteúdo',()=>{
    fs.writeFileSync(path.join(root,'binary.png'),Buffer.from([0,1,2]));
    fs.writeFileSync(path.join(root,'secret.txt'),'original',{mode:0o755});
    fs.symlinkSync(path.join(root,'secret.txt'),path.join(root,'alias.txt'));
    expect(()=>call('escrever_arquivo',{caminho:'binary.png',conteudo:'x'})).toThrow();
    expect(()=>call('escrever_arquivo',{caminho:'out/novo.pdf',conteudo:'PDF fictício'})).toThrow();
    expect(()=>call('escrever_arquivo',{caminho:'alias.txt',conteudo:'x'})).toThrow();
    expect(()=>call('ler_arquivo',{caminho:'alias.txt'})).toThrow();
    const old=call('ler_arquivo',{caminho:'secret.txt'});
    expect(call('escrever_arquivo',{caminho:'secret.txt',conteudo:'original',sha256:old.sha256}).alterado).toBe(false);
    expect(call('substituir_texto',{caminho:'secret.txt',antes:'original',depois:'novo',sha256:old.sha256}).alterado).toBe(true);
    expect(fs.statSync(path.join(root,'secret.txt')).mode&0o777).toBe(0o755);
    expect(()=>call('escrever_arquivo',{caminho:'secret.txt',conteudo:'x',sha256:old.sha256})).toThrow();
    expect(fs.readFileSync(path.join(root,'secret.txt'),'utf8')).toBe('novo');
  });
  it('lista uma pasta por vez, sem segredos e com paginação',()=>{
    for(const f of ['a','b','.env','c'])fs.writeFileSync(path.join(root,f),'x');
    const a=call('listar_arquivos',{pasta:'.',limite:2});
    expect(a.arquivos).toEqual(['a','b']);
    expect(call('listar_arquivos',{pasta:'.',inicio:a.proximo}).arquivos).toEqual(['c']);
  });
});
