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

describe('Kokoro-FastAPI: pausas em uma única geração', () => {
  it('insere tags documentadas entre frases sem concatenação', () => {
    const { roteiroEmUmaFala } = require('../../src/providers/kokoro-tts.service');
    const texto = roteiroEmUmaFala([
      { texto: 'É hoje!', intencao: 'chamada', pausaAposMs: 350 },
      { texto: 'Black na sua quinta-feira!', intencao: 'destaque', pausaAposMs: 400 },
      { texto: 'Das sete às nove da noite, dois sabores em promoção!', pausaAposMs: 450 },
      { texto: 'Peça agora a sua pizza e aproveite!', intencao: 'chamada' },
    ]);
    expect(texto).toBe('É hoje! [pause:0.35s] Black na sua quinta-feira! [pause:0.40s] Das sete às nove da noite, dois sabores em promoção! [pause:0.45s] Peça agora a sua pizza e aproveite!');
  });
  it('não separa a pergunta final nem insere pausa após você', () => {
    const { roteiroEmUmaFala } = require('../../src/providers/kokoro-tts.service');
    const texto = roteiroEmUmaFala([
      { texto: 'E você,', pausaAposMs: 350 },
      { texto: 'Vai ficar de fora dessa?', intencao: 'pergunta' },
    ]);
    expect(texto).toBe('E você, vai ficar de fora dessa?');
  });
});
