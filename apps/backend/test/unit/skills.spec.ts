import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { selectSkills,skillContext } from '../../src/specialties/skills';
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
