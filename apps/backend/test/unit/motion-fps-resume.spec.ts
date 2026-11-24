import { fpsOnlyResume,resumeRenderCommand } from '../../src/jobs/motion/fps-resume';
import { readMotionInvocation,readMotionMode } from '../../src/jobs/motion/command';
import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
describe('Retomada de FPS',()=>{
  const id='d32757d6-4321-4ff1-a157-198a65e6f652';
  const old='nivoo-renderizar-motion motion/c/index.html --motor hybrid --saida midia/saida/c.mp4 --segundos 25 --tamanho 1080x1920';
  it('reconhece pedido explícito de correção técnica',()=>{
    expect(fpsOnlyResume('Retome o trabalho anterior. Preserve toda a composição, as imagens e as animações já produzidas. Corrija somente a renderização para 30 FPS e conclua a entrega.')).toBe(30);
    expect(fpsOnlyResume('Retome e refaça toda a composição a 30 FPS')).toBeUndefined();
  });
  it('preserva modo e duração e não aceita script arbitrário',()=>{
    const command=resumeRenderCommand(old,id,30,'midia/saida/c-30fps.mp4')!;
    expect(readMotionInvocation(command)).toMatchObject({source:'motion/retomada-d32757d6/c/index.html',fps:30,seconds:25,width:1080,height:1920});
    expect(readMotionMode(command)).toBe('hybrid');
    expect(resumeRenderCommand(old+'; echo x',id,30,'midia/saida/c-30fps.mp4')).toBeNull();
    expect(resumeRenderCommand(old,id,30,'midia/saida/c.mp4')).toBeNull();
  });
  it('não encaminha comando Motion real para junção de cenas',()=>{
    const command=resumeRenderCommand(old,id,30,'midia/saida/c-30fps.mp4')!;
    const steps=compileWorkflowPlan([{key:'exportar_30fps',title:'Exportar 30 FPS',provider:'juntar-videos',instructions:command,providerOptions:{motionSourceJobId:id}}],'codex-cli','Preservar a composição a 30 FPS',{template:'design-video'}) as any[];
    expect(steps[0].provider).toBe('local-shell');
    expect(steps[0].instructions).toBe(command);
  });
});
