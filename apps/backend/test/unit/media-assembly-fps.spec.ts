import { assemblyFrameRate,preserveClipWithoutEncoding } from '../../src/providers/assembly-frame-rate';
import { opcoesDeJuncao } from '../../src/jobs/workflow/media-options';
import { mediaDeliveries } from '../../src/specialties/media/delivery';
import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
import { isComposer } from '../../src/jobs/motion/authoring';

describe('Preservação audiovisual',()=>{
  const opts={cenas:['midia/entrada/original.mp4'],arquivo:'midia/saida/final.mp4'};
  it('preserva taxa racional sem forçar 24 ou arredondar',()=>{
    expect(assemblyFrameRate('30000/1001').filter).toBe('30000/1001');
    expect(assemblyFrameRate('30/1').value).toBe(30);
    expect(assemblyFrameRate('25/1',30).filter).toBe('30');
    expect(()=>assemblyFrameRate('0/0')).toThrow();
    expect(preserveClipWithoutEncoding(true,null,30,'25/1')).toBe(false);
    expect(preserveClipWithoutEncoding(true,null,30,'30/1')).toBe(true);
  });
  it('mantém contrato de FPS e sincronização na montagem',()=>{
    const valid=opcoesDeJuncao('montar',{...opts,fps:30,sincronizarVideoComNarracao:false});
    expect(valid.fps).toBe(30);
    expect(valid.sincronizarVideoComNarracao).toBe(false);
    expect(mediaDeliveries('juntar-videos','',valid as unknown as Record<string,unknown>)[0].fps).toBe(30);
    expect(()=>opcoesDeJuncao('montar',{...opts,fps:0})).toThrow();
    const plan=compileWorkflowPlan([{key:'montar',provider:'juntar-videos',providerOptions:opts}],'codex-cli','Vídeo final a 30 FPS',{template:'design-video'}) as any[];
    expect(plan[0].providerOptions.fps).toBe(30);
  });
  it('não confunde relatório ou imagem estática com autoria Motion',()=>{
    expect(isComposer({key:'criar-arte',verifyCommand:'test -s out/arte.png'})).toBe(false);
    expect(isComposer({key:'criar-relatorio',verifyCommand:'test -s out/relatorio.md'})).toBe(false);
    expect(isComposer({key:'compor',instructions:'Crie motion/c/index.html',verifyCommand:'test -s out/relatorio.md'})).toBe(true);
  });
});
