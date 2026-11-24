import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { selectSkills,skillContext } from '../../src/specialties/skills';
import { mediaAuthorRules } from '../../src/specialties/media/planner-contract';
import { writeSessionContextFile } from '../../src/common/session-context-file';
import { previousSessions,stageCard,writeStageCard } from '../../src/worker/executor/stage-card';
describe('Skills Nivoo',()=>{
  const base={phase:'execution' as const,media:true,software:false,text:''};
  const ids=(args:Parameters<typeof selectSkills>[0])=>selectSkills(args).map(s=>s.id);
  it('seleciona por intenção atual, preserva isolamento de domínios',()=>{
    expect(ids({...base,text:'Criar imagem de pizza',nativeImage:true})).toEqual(['execucao-enxuta','direcao-artistica']);
    expect(ids({...base,text:'Retome animação 3D',resume:true,previousError:true})).toEqual(['retomada','execucao-enxuta','diagnostico','motion']);
    expect(ids({...base,text:'Corrigir código do encoder de vídeo',media:false,software:true})).toEqual(['execucao-enxuta','codigo']);
    expect(ids({...base,text:'Renderizar vídeo',executor:true})).toEqual([]);
    expect(ids({...base,phase:'planner',text:'Olá'})).toEqual([]);
    expect(ids({...base,text:'imagem de referência para vídeo Reels com narração',nativeImage:true})).toEqual(['execucao-enxuta','direcao-artistica']);
    expect(ids({...base,text:'implementar_endpoint e gravar arquivos',media:false,software:true})).toEqual(['execucao-enxuta','arquivos','codigo']);
    expect(ids({...base,text:'preserve a marca na arte'})).toEqual(['execucao-enxuta','direcao-artistica']);
    expect(ids({...base,text:'editar documento',media:false,software:false})).toEqual(['execucao-enxuta','arquivos']);
  });
  it('edição pontual não recebe regras de criação ou reposicionamento',()=>{
    const text=mediaAuthorRules(true,true).join('\n');
    expect(text).toContain('Edição audiovisual delimitada');
    expect(text).toContain('preserve tudo'.replace(/^p/,'P'));
    expect(text).not.toContain('PUBLICAÇÃO REELS:');
    expect(text).not.toContain('NivooGraphics');
    expect(ids({...base,text:'Recuperar pizza',motionAuthor:true,resume:true})).toEqual(['retomada','execucao-enxuta','motion']);
  });
  it('não segue links nem permite caminhos fora do contexto descartável',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-skills-path-'));
    try{
      fs.mkdirSync(path.join(dir,'contexto'));
      fs.writeFileSync(path.join(dir,'original.txt'),'intacto');
      fs.symlinkSync(path.join(dir,'original.txt'),path.join(dir,'contexto','estado-etapa.md'));
      writeSessionContextFile(dir,'estado-etapa.md','novo');
      expect(fs.readFileSync(path.join(dir,'original.txt'),'utf8')).toBe('intacto');
      expect(fs.readFileSync(path.join(dir,'contexto','estado-etapa.md'),'utf8')).toBe('novo');
      fs.symlinkSync(dir,path.join(dir,'contexto','link'));
      expect(()=>writeSessionContextFile(dir,'link/out.md','x')).toThrow();
      expect(()=>writeSessionContextFile(dir,'../original.txt','x')).toThrow();
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('materializa apenas as skills selecionadas e o estado descartável',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-skills-'));
    try{
      const prompt=skillContext(selectSkills({...base,text:'Gerar narração'}),dir).join('\n');
      expect(prompt).toContain('locucao');
      expect(prompt).not.toContain('direcao-artistica');
      expect(fs.readdirSync(path.join(dir,'contexto','skills-nivoo')).sort()).toEqual(['execucao-enxuta','locucao']);
      const old=[{number:11,status:'FALHA',error:'erro real'},{number:12,status:'EXECUTANDO'}];
      expect(previousSessions(old).map(a=>a.number)).toEqual([11]);
      const stage={key:'render',title:'Render',status:'EXECUTANDO',dependsOn:['arte']};
      const text=stageCard(stage,[stage,{key:'arte',title:'Arte',status:'CONCLUIDO',dependsOn:[]}],old,{seq:4,label:'arte pronta',gitCommit:'abc'});
      writeStageCard(dir,text);
      expect(text).toContain('arte=CONCLUIDO');
      expect(text).toContain('#11 FALHA');
      expect(text).not.toContain('#12');
      expect(fs.readFileSync(path.join(dir,'contexto','estado-etapa.md'),'utf8')).toContain('commit abc');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
