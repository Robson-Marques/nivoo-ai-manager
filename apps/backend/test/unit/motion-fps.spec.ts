import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
import { normalizeMotionFps,readMotionInvocation,motionFpsFromText } from '../../src/jobs/motion/command';
import { mediaDeliveries } from '../../src/specialties/media/delivery';
describe('Contrato FPS Motion',()=>{
  const command='nivoo-renderizar-motion motion/c --saida midia/saida/c.mp4 --segundos 25 --tamanho 1080x1920';
  it('preserva o FPS explícito e insere o solicitado quando omitido',()=>{
    const out=normalizeMotionFps(command,30);
    expect(out.invalid).toBe(false);
    expect(readMotionInvocation(out.command)?.fps).toBe(30);
    expect(normalizeMotionFps(out.command,30).command).toBe(out.command);
    expect(normalizeMotionFps(command+' --fps 24',30).command).toBe(command+' --fps 24');
    expect(normalizeMotionFps(command+' --fps 0',30).invalid).toBe(true);
    expect(motionFpsFromText('25 segundos a 30 fps')).toBe(30);
  });
  it('transmite o FPS do objetivo ao render e à inspeção técnica',()=>{
    const steps=compileWorkflowPlan([{key:'renderizar',provider:'local-shell',instructions:command}],'codex-cli','Vídeo de 25 segundos a 30 fps',{template:'design-video'}) as any[];
    expect(readMotionInvocation(steps[0].instructions)?.fps).toBe(30);
    expect(mediaDeliveries('local-shell',steps[0].instructions,{})[0].fps).toBe(30);
    expect(compileWorkflowPlan(steps,'codex-cli','Vídeo de 25 segundos a 30 fps',{template:'design-video'})).toEqual(steps);
  });
});
