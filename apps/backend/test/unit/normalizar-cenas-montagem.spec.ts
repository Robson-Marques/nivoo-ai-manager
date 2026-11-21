import { normalizarCenasDeMontagem, opcoesDeJuncao } from '../../src/jobs/jobs.service';

describe('Montagem de uma cena: normalização no núcleo', () => {
  const origem = 'midia/saida/black-na-sua-quinta-refinamento-final.mp4';
  const saida = 'midia/saida/black-na-sua-quinta-definitivo.mp4';
  it('aceita uma única cena como string, sem obrigar array no prompt', () => {
    expect(opcoesDeJuncao('montagem-final', { cenas: origem, arquivo: saida }).cenas).toEqual([origem]);
  });
  it.each(['video', 'videoOriginal', 'videoEntrada', 'cena'])('aceita o campo de entrada %s', campo => {
    expect(opcoesDeJuncao('montagem-final', { [campo]: origem, arquivo: saida }).cenas).toEqual([origem]);
  });
  it('não confunde saída com entrada quando o caminho é desconhecido', () => {
    expect(normalizarCenasDeMontagem({ arquivo: saida })).toEqual([]);
    expect(() => opcoesDeJuncao('montagem-final', { arquivo: saida })).toThrow(/cenas/);
  });
});
