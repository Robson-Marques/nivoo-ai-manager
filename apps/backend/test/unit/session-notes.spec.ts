import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseAgentNotes,readAgentNotes } from '../../src/worker/executor/session-notes';
import { stageCard } from '../../src/worker/executor/stage-card';
import { fullMemoryDocument } from '../../src/worker/context-builder';
describe('Continuidade e memória de sessão',()=>{
  it('importa somente notas válidas e deduplica representações equivalentes',()=>{
    const result=parseAgentNotes([
      '{"tipo":"PROGRESSO","titulo":"Passo","conteudo":"Feito"}',
      '{"conteudo":"Feito","titulo":"Passo","tipo":"PROGRESSO"}',
      '{"tipo":"PROGRESSO","titulo":"","conteudo":"x"}',
      '{"tipo":"INVENTADO","titulo":"x","conteudo":"y"}',
      'texto truncado',
      '{"tipo":"EVIDENCIA","titulo":"Relatório","conteudo":"entregue","arquivos":["out/a.md","../segredo","/etc/a","out/a.md"]}',
    ].join('\n'));
    expect(result.invalid).toBe(3);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[1].arquivos).toEqual(['a.md']);
  });
  it('não lê diário por link simbólico',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-notes-'));
    try{
      fs.mkdirSync(path.join(dir,'.nivoo'));
      fs.writeFileSync(path.join(dir,'original'),'segredo');
      fs.symlinkSync(path.join(dir,'original'),path.join(dir,'.nivoo','notas.jsonl'));
      expect(readAgentNotes(dir).text).toBe('');
      expect(readAgentNotes(dir).warning).toBeTruthy();
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('distingue checkpoint do trabalho e da etapa',()=>{
    const stage={key:'codigo',title:'Código',status:'PENDENTE',dependsOn:[]};
    expect(stageCard(stage,[stage],[],{seq:8,label:'outra etapa'},{seq:7,label:'código parcial'})).toContain('Checkpoint desta etapa: #7');
  });
  it('não corta conteúdo longo do espelho completo',()=>{
    const content='x'.repeat(30000)+'FIM';
    expect(fullMemoryDocument([{id:'m',category:'ESPECIFICACAO',title:'teste',content,author:'usuário',createdAt:new Date(),references:{}}],[])).toContain(content);
  });
});
