import { quadrosRequeridos } from '../../src/jobs/video-frame-extraction';

describe('Quadros exigidos para conferir vídeo', () => {
  it('identifica os cinco quadros diretamente em out/ (regressão do Black na sua Quinta)', () => {
    const command = [
      'test -s out/quadro-08.png',
      'test -s out/quadro-30.png',
      'test -s out/quadro-58.png',
      'test -s out/quadro-85.png',
      'test -s out/quadro-final.png',
      'grep -Eq \'"resultado"[[:space:]]*:[[:space:]]*"passou"\' out/qualidade/black-quinta-final.json',
    ].join(' && ');
    expect(quadrosRequeridos(command)).toEqual([
      { destino: 'out/quadro-08.png', momento: '08' },
      { destino: 'out/quadro-30.png', momento: '30' },
      { destino: 'out/quadro-58.png', momento: '58' },
      { destino: 'out/quadro-85.png', momento: '85' },
      { destino: 'out/quadro-final.png', momento: 'final' },
    ]);
  });

  it('continua identificando quadros em subpastas', () => {
    expect(quadrosRequeridos('test -s out/qualidade/quadro-08.png && test -s out/qualidade/quadro-30.png && test -s out/qualidade/quadro-final.png'))
      .toHaveLength(3);
  });

  it('não intercepta caminhos com travessia ou conferências com poucos quadros', () => {
    expect(quadrosRequeridos('test -s out/../quadro-08.png && test -s out/quadro-30.png && test -s out/quadro-final.png'))
      .toEqual([]);
  });
});
