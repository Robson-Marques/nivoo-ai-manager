import { unirTrechosContinuos } from '../../src/providers/kokoro-tts.service';

describe('Kokoro: continuidade prosódica por oração', () => {
  it.each([
    ['E você,', 'vai ficar de fora dessa?'],
    ['E você', 'Vai ficar de fora dessa?'],
    ['E você…', 'vai ficar de fora dessa?'],
    ['E você.', 'Vai ficar de fora dessa?'],
  ])('gera a pergunta completa em uma chamada a partir de %s', (primeiro, segundo) => {
    const falas = unirTrechosContinuos([
      { texto: primeiro, intencao: 'natural', velocidade: 0.95, pausaAposMs: 350 },
      { texto: segundo, intencao: 'pergunta', velocidade: 0.93 },
    ]);
    expect(falas).toHaveLength(1);
    expect(falas[0]).toMatchObject({
      texto: 'E você, vai ficar de fora dessa?',
      intencao: 'pergunta',
      velocidade: 0.93,
    });
    expect(falas[0].pausaAposMs).toBeUndefined();
  });

  it('não junta frases completas nem perde pausas entre frases', () => {
    const falas = unirTrechosContinuos([
      { texto: 'É hoje!', intencao: 'chamada', pausaAposMs: 250 },
      { texto: 'Black na sua quinta-feira!', intencao: 'destaque', pausaAposMs: 200 },
      { texto: 'E você, vai ficar de fora dessa?', intencao: 'pergunta' },
    ]);
    expect(falas).toHaveLength(3);
    expect(falas[0].pausaAposMs).toBe(250);
    expect(falas[1].pausaAposMs).toBe(200);
  });
});
