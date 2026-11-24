import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildPrompt } from '../../src/providers/provider.interface';
import { writeContextArchive } from '../../src/worker/context-archive';
import { compactRepeatedReads } from '../../src/providers/tool-history';
describe('Contexto seletivo',()=>{
  const profile='# Perfil\nRegra integral';
  it('não duplica perfil no canal de sistema e não o perde em reparos',()=>{
    const req={context:'# Segurança\n'+profile+'\n# Estado',instructions:'Implementar',systemPrompt:profile};
    expect(buildPrompt(req,true)).not.toContain(profile);
    expect(buildPrompt(req,true)).toContain('# Segurança');
    expect(buildPrompt(req,false)).toContain(profile);
    expect(buildPrompt({...req,context:''},false)).toContain(profile);
    expect(buildPrompt({...req,context:'',instructions:profile+'\nPlano'},true)).not.toContain(profile);
  });
  it('preserva texto integral em páginas UTF-8 legíveis',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-archive-'));
    try{
      const content=('Árvore😀\n').repeat(40000);
      const index=writeContextArchive(dir,'memoria',content);
      const names=fs.readFileSync(path.join(dir,index),'utf8').split('\n').filter(x=>x.startsWith('- ')).map(x=>x.slice(2));
      expect(names.length).toBeGreaterThan(1);
      expect(names.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('')).toBe(content);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('remove só leituras idênticas, sem alterar os IDs e a sequência',()=>{
    const body=JSON.stringify({conteudo:'x'.repeat(1000)});
    const msgs=[
      {role:'assistant',tool_calls:[{id:'a',function:{name:'ler_arquivo',arguments:'{}'}}]},
      {role:'tool',tool_call_id:'a',content:body},
      {role:'assistant',tool_calls:[{id:'b',function:{name:'ler_arquivo',arguments:'{}'}}]},
      {role:'tool',tool_call_id:'b',content:body},
      {role:'tool',tool_call_id:'c',content:body},
    ];
    const result=compactRepeatedReads(msgs);
    expect(result.savedChars).toBeGreaterThan(0);
    expect(result.messages[1].tool_call_id).toBe('a');
    expect(result.messages[3].content).toBe(body);
    expect(result.messages[4].content).toBe(body);
    expect(msgs[1].content).toBe(body);
  });
});
