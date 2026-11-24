import { readMotionInvocation, readMotionInvocations, hasMotionCommand } from '../../src/jobs/motion/command';
import { videoGeradoPorEtapa } from '../../src/jobs/native-video-result';
import { conferenciaTecnicaDeVideo,customMediaVerification } from '../../src/jobs/video-step-verification';
import { dependenciasDeMontagemPorArquivo } from '../../src/jobs/executor-priority';
import { classifyMediaFailure } from '../../src/specialties/media/failure-policy';
import { currentMediaBaseRules, LEGACY_3D_PROFILE_LINE, CURRENT_3D_PROFILE_LINE } from '../../src/specialties/media/runtime-profile';

describe('Contrato operacional de mídia', () => {
  const command="set -e; /usr/local/bin/nivoo-renderizar-motion 'motion/novo/index.html' --saida 'midia/saida/a.mp4' --tamanho 1080x1920 --segundos 12";
  it('compartilha o mesmo destino, duração e resolução no planner e no executor', () => {
    expect(readMotionInvocation(command)).toEqual({source:'motion/novo/index.html',output:'midia/saida/a.mp4',seconds:12,width:1080,height:1920});
    expect(videoGeradoPorEtapa('local-shell',command,{})).toBe('midia/saida/a.mp4');
    const verify=conferenciaTecnicaDeVideo('local-shell',command,{},'true');
    expect(verify).toContain('1080x1920');
    expect(verify).toContain('target=12');
    expect(verify).toContain('midia/saida/a.mp4');
  });
  it('remove somente inspeção gerada e preserva testes personalizados',()=>{
    const path='midia/saida/a.mp4',custom='test -s out/relatorio.md';
    const generated=conferenciaTecnicaDeVideo('local-shell',command,{},custom);
    expect(customMediaVerification('local-shell',command,{},[path],generated)).toBe(custom);
    expect(customMediaVerification('local-shell',command,{},[path],conferenciaTecnicaDeVideo('local-shell',command,{},"test -s '"+path+"'"))).toBeUndefined();
    expect(customMediaVerification('local-shell',command,{},[path],custom)).toBe(custom);
  });
  it('não interpreta texto citado ou comentário como operação de render', () => {
    for(const script of ["echo 'texto; nivoo-renderizar-motion motion/novo --saida midia/saida/a.mp4'","# nivoo-renderizar-motion motion/novo --saida midia/saida/a.mp4"]){
      expect(hasMotionCommand(script)).toBe(false);
      expect(videoGeradoPorEtapa('local-shell',script,{})).toBeNull();
      expect(conferenciaTecnicaDeVideo('local-shell',script,{},'true')).toBe('true');
    }
  });
  it('resolve cada saída literal sem presumir resultado único em múltiplos renders',()=>{
    const multiple=command+'\nnivoo-renderizar-motion motion/b --saida midia/saida/b.mp4 --segundos 12';
    expect(readMotionInvocation(multiple)).toBeNull();
    expect(readMotionInvocations(multiple).map(x=>x.output)).toEqual(['midia/saida/a.mp4','midia/saida/b.mp4']);
    const steps=[{key:'render',provider:'local-shell',instructions:multiple},{key:'montar',provider:'juntar-videos',providerOptions:{cenas:['midia/saida/b.mp4']}}];
    expect((dependenciasDeMontagemPorArquivo(steps,'codex-cli') as any[])[1].dependsOn).toEqual(['render']);
  });
  it('classifica falha do renderizador sem atingir etapas de IA',()=>{
    const errors=['MOTION_MIDIA_AUSENTE: pizza','nivoo-renderizar-motion: falhou: logo.at: número fora do intervalo 0–12','MOTION_CONTRATO: formato inválido'];
    expect(errors.map(error=>classifyMediaFailure('local-shell','FALHA',{error,output:''})?.kind)).toEqual(['asset','scene','contract']);
    expect(classifyMediaFailure('codex-cli','FALHA',{error:errors[0],output:''})).toBeNull();
    expect(classifyMediaFailure('local-shell','SUCESSO',{error:errors[0],output:''})).toBeNull();
  });
  it('resolve apenas o texto padrão antigo do perfil, sem sobrescrever personalizações',()=>{
    const custom='Não use 3D neste projeto.';
    const original=LEGACY_3D_PROFILE_LINE+'\n'+custom;
    expect(currentMediaBaseRules({template:'design-video'},original)).toBe(CURRENT_3D_PROFILE_LINE+'\n'+custom);
    expect(currentMediaBaseRules({template:'software'},original)).toBe(original);
  });
});
