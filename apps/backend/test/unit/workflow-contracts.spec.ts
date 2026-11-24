import { rewriteMotionSource,readMotionInvocation,normalizeMotionOutputs } from '../../src/jobs/motion/command';
import { compileWorkflowDefinition,compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
import { dependenciasDeMontagemPorArquivo } from '../../src/jobs/workflow/media-dependencies';
import { validarSaidaMotion } from '../../src/jobs/workflow/media-paths';
import { assertAcyclic } from '../../src/jobs/workflow/graph';

describe('Contratos do workflow',()=>{
  const area={template:'design-video'};
  const render={key:'render',title:'Renderizar animação',provider:'local-shell',
    instructions:'nivoo-renderizar-motion motion/a --saida midia/saida/a.mp4 --segundos 12 --tamanho 1080x1920',
    verifyCommand:'test -s midia/saida/a.mp4'};
  const author={key:'compor',title:'Criar composição',provider:'codex-cli',
    instructions:'Crie motion/a/index.html com fotos',verifyCommand:'test -s motion/a/index.html'};
  it('reescreve apenas a invocação real, preservando exemplos e flags de outros comandos',()=>{
    const prefix="echo 'exemplo; nivoo-renderizar-motion motion/falso --motor scene'; ";
    const original=prefix+render.instructions+'; echo --motor scene';
    const next=rewriteMotionSource(original,'motion/a/index.html','hybrid');
    expect(next.startsWith(prefix)).toBe(true);
    expect(next.endsWith('; echo --motor scene')).toBe(true);
    expect(next).toContain('motion/a/index.html --motor hybrid');
    expect(rewriteMotionSource(next,'motion/a/index.html','hybrid')).toBe(next);
  });
  it('aceita aspas e continuação de linha, normaliza destino antigo e rejeita destino inválido',()=>{
    const cmd="set -e\nnivoo-renderizar-motion 'motion/a' \\\n --saida 'out/old.mp4' --segundos 12";
    const result=normalizeMotionOutputs(cmd);
    expect(result.invalid).toBe(false);
    expect(result.command).toContain("'midia/saida/old.mp4'");
    expect(readMotionInvocation(result.command)?.seconds).toBe(12);
    expect(()=>validarSaidaMotion('nivoo-renderizar-motion motion/a --saida /tmp/a.mp4','etapa')).toThrow();
    const quoted="echo 'nivoo-renderizar-motion motion/a --saida /tmp/a.mp4'";
    expect(validarSaidaMotion(quoted,'etapa')).toBe(quoted);
  });
  it.each([
    ['Animação sem geometria 3D','scene',"test -s 'motion/a/scene.json'"],
    ['Vídeo 3D com logo','hybrid',"test -s 'motion/a/index.html' && test -s 'motion/a/overlays.json'"],
    ['Elementos gráficos premium','html',"test -s 'motion/a/index.html'"],
  ])('alinha autoria e render: %s',(objective,mode,check)=>{
    const plan=compileWorkflowPlan([author,render],'codex-cli',objective,area) as any[];
    expect(plan[0].verifyCommand).toBe(check);
    expect(plan[1].instructions).toContain('--motor '+mode);
    expect(plan[1].dependsOn).toContain('compor');
    expect(compileWorkflowPlan(plan,'codex-cli',objective,area)).toEqual(plan);
  });
  it('preserva verificações personalizadas',()=>{
    const custom='test -s motion/a/index.html && grep -q __motionFim motion/a/index.html && test -s out/report.md';
    const plan=compileWorkflowPlan([{...author,verifyCommand:custom},render],'codex-cli','Vídeo 3D com logo',area) as any[];
    expect(plan[0].verifyCommand).toBe(custom);
  });
  it('propaga o mesmo destino para produtor, consumidor, verificação e critérios',()=>{
    const raw=[{...render,instructions:render.instructions.replace('midia/saida/a.mp4','out/a.mp4'),verifyCommand:'test -s out/a.mp4'},
      {key:'mount',provider:'juntar-videos',instructions:'Montar',providerOptions:{cenas:['out/a.mp4'],arquivo:'midia/saida/final.mp4'}}];
    const criteria=[{kind:'FILE_EXISTS',config:{path:'out/a.mp4'}},{kind:'COMMAND',config:{command:'test -s out/a.mp4'}}];
    const d=compileWorkflowDefinition(raw,criteria,'codex-cli','Renderizar composição existente',area);
    const steps=d.steps as any[],checks=d.criteria as any[];
    expect(steps[0].instructions).toContain('midia/saida/a.mp4');
    expect(steps[0].verifyCommand).toBe('test -s midia/saida/a.mp4');
    expect(steps[1].providerOptions.cenas).toEqual(['midia/saida/a.mp4']);
    expect(steps[1].dependsOn).toEqual(['render']);
    expect(checks[0].config.path).toBe('midia/saida/a.mp4');
    expect(checks[1].config.command).toBe('test -s midia/saida/a.mp4');
    expect(compileWorkflowDefinition(d.steps,d.criteria,'codex-cli','Renderizar composição existente',area)).toEqual(d);
  });
  it('liga locução, cenas e montagens encadeadas por caminhos exatos',()=>{
    const raw=[
      {key:'g',provider:'gemini-video',providerOptions:{arquivo:'videos/cena.mp4'}},
      {key:'n',provider:'gerar-narracao',providerOptions:{arquivo:'out/voz.mp3'}},
      {key:'m1',provider:'juntar-videos',providerOptions:{cenas:['videos/cena.mp4'],narracao:{arquivo:'out/voz.mp3'},arquivo:'videos/montagem.mp4'}},
      {key:'m2',provider:'juntar-videos',providerOptions:{cenas:['videos/montagem.mp4'],arquivo:'videos/final.mp4'}},
    ];
    const steps=dependenciasDeMontagemPorArquivo(raw,'codex-cli') as any[];
    expect(steps[2].dependsOn).toEqual(['g','n']);
    expect(steps[3].dependsOn).toEqual(['m1']);
    expect(dependenciasDeMontagemPorArquivo(steps,'codex-cli')).toEqual(steps);
  });
  it('rejeita saídas duplicadas entre conectores e dependências cíclicas',()=>{
    expect(()=>dependenciasDeMontagemPorArquivo([render,{...render,key:'g',provider:'gemini-video',providerOptions:{arquivo:'midia/saida/a.mp4'}}],'codex-cli')).toThrow(/mesmo MP4/);
    expect(()=>assertAcyclic([{key:'a',dependsOn:['b']},{key:'b',dependsOn:['a']}])).toThrow(/cíclica/);
    expect(()=>assertAcyclic([{key:'a',dependsOn:[]},{key:'b',dependsOn:['a']}])).not.toThrow();
  });
  it('não transforma comandos de software em operações de mídia',()=>{
    const raw=[{key:'dev',provider:'local-shell',instructions:'ffmpeg -i fixtures/a.mp4 -c:v libx264 out/sample.mp4'}];
    expect(compileWorkflowPlan(raw,'codex-cli','Test encoder',{template:'software'})).toEqual(raw);
  });
});
