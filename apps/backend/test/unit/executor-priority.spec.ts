import { aplicarPrioridadeDosExecutores } from '../../src/jobs/executor-priority';
describe('Prioridade obrigatória dos executores', () => {
  const opts = {
    cenas: ['midia/saida/aprovado.mp4'],
    arquivo: 'midia/saida/final.mp4',
    narracao: { arquivo: 'midia/entrada/voz.mp3' },
    trilha: { arquivo: 'midia/entrada/trilha.mp3' },
    sincronizarVideoComNarracao: true,
  };
  it('substitui o método inventado pela IA pelo executor interno', () => {
    const [step] = aplicarPrioridadeDosExecutores([
      { key: 'montar', provider: 'local-shell', instructions: 'python3 out/montar.py video',
        verifyCommand: 'test -s out/resultado.mp4', providerOptions: opts },
    ], 'local-shell') as any[];
    expect(step.provider).toBe('juntar-videos');
    expect(step.providerOptions).toEqual(opts);
    expect(step.verifyCommand).toBeUndefined();
  });
  it('bloqueia montagem por Python sem contrato de mídia', () => {
    expect(() => aplicarPrioridadeDosExecutores([
      { key: 'montar', provider: 'local-shell', instructions: 'python3 out/montar-black-quinta.py video' },
    ], 'local-shell')).toThrow(/estrutura interna tem prioridade/);
  });
  it('bloqueia FFmpeg de mixagem improvisada', () => {
    expect(() => aplicarPrioridadeDosExecutores([
      { key: 'mixar', provider: 'local-shell', instructions: 'ffmpeg -i video.mp4 -i voz.mp3 -filter_complex amix -c:v copy midia/saida/final.mp4' },
    ], 'local-shell')).toThrow(/juntar-videos/);
  });
  it('permite renderização de motion, análise e ferramentas oficiais', () => {
    const steps = [
      { key:'motion',provider:'local-shell',instructions:'nivoo-renderizar-motion motion/capa --saida midia/saida/capa.mp4' },
      { key:'analisar',provider:'local-shell',instructions:'nivoo-analisar-video midia/saida/capa.mp4 --pasta out/analise' },
      { key:'quadros',provider:'local-shell',instructions:'nivoo-extrair-quadros midia/saida/capa.mp4 --pasta out/quadros' },
    ];
    expect(aplicarPrioridadeDosExecutores(steps,'local-shell')).toEqual(steps);
  });
  it('não interfere no executor interno já selecionado', () => {
    const steps = [{ key:'juntar',provider:'juntar-videos',providerOptions:opts }];
    expect(aplicarPrioridadeDosExecutores(steps,'local-shell')).toEqual(steps);
  });
});
