import { comPreflightVisual } from '../../src/jobs/jobs.service';

describe('Motion: fluxo direto sem etapas de IA duplicadas', () => {
  const plano = () => [
    { key: 'desenhar', title: 'Compor vídeo', provider: 'claude-code-cli', instructions: 'Criar animação 3D',
      verifyCommand: 'test -s motion/black-quinta/index.html', dependsOn: [] },
    { key: 'renderizar', title: 'Render', provider: 'local-shell',
      instructions: 'nivoo-renderizar-motion motion/black-quinta --saida midia/saida/black-quinta.mp4 --segundos 25 --tamanho 1080x1920',
      dependsOn: ['desenhar'], verifyCommand: 'true' },
    { key: 'montar', title: 'Montar trilha', provider: 'juntar-videos',
      instructions: 'Juntar trilha ao vídeo', dependsOn: ['renderizar'], verifyCommand: 'true' },
  ];

  it('não injeta captura, revisão visual paga, ou dependências novas antes do vídeo', () => {
    const p = plano();
    const r = comPreflightVisual(p, 'claude-code-cli') as typeof p;
    expect(r).toEqual(p);
    expect(r.map(s => s.key)).toEqual(['desenhar', 'renderizar', 'montar']);
    expect(r[1].dependsOn).toEqual(['desenhar']);
  });

  it('não reescreve plano normalizado, mesmo repetidamente', () => {
    const p = plano();
    const a = comPreflightVisual(p, 'claude-code-cli');
    const b = comPreflightVisual(a, 'claude-code-cli');
    expect(b).toEqual(p);
  });

  it('não cria revisão paga para renderização já descrita no plano', () => {
    const p = plano();
    const r = comPreflightVisual(p, 'claude-code-cli') as typeof p;
    expect(r.filter(s => /qa-visual-|direcao-arte-/.test(s.key))).toHaveLength(0);
  });
});
