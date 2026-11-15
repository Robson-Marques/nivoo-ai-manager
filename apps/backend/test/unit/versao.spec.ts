import { calcularVersao, maiorEtiqueta, textoDaVersao } from '../../src/git/versao';

describe('versão do projeto × etiqueta do Git', () => {
  it('ConnectChat: arquivos em 0.11.95 (nunca publicada), Git já em v0.12.1 → próxima é 0.12.2, nunca abaixo', () => {
    const tags = ['v0.11.94', 'v0.12.0', 'v0.12.1'];
    const i = calcularVersao({ versao: [0, 11, 95], arquivo: 'package.json' }, maiorEtiqueta(tags), tags);
    expect(i.proxima).toEqual([0, 12, 2]);
    expect(i.declaradaPendente).toBe(false);
    expect(textoDaVersao(i).join('\n')).toMatch(/0\.11\.95 \(em package\.json\)[\s\S]*v0\.12\.1[\s\S]*0\.12\.2/);
  });
  it('arquivo já subiu e ainda não foi publicado (0.4.0 > v0.3.0): é a próxima, não sobe de novo', () => {
    const tags = ['v0.3.0'];
    const i = calcularVersao({ versao: [0, 4, 0], arquivo: 'package.json' }, maiorEtiqueta(tags), tags);
    expect(i.proxima).toEqual([0, 4, 0]);
    expect(i.declaradaPendente).toBe(true);
  });
  it('arquivo igual à última etiqueta: próxima correção; sem nada, 0.1.0', () => {
    const tags = ['v1.2.3'];
    expect(calcularVersao({ versao: [1, 2, 3], arquivo: 'package.json' }, maiorEtiqueta(tags), tags).proxima).toEqual([1, 2, 4]);
    expect(calcularVersao(null, null, []).proxima).toEqual([0, 1, 0]);
  });
});

describe('padrão de versão do usuário (cada casa de 0 a 99)', () => {
  const { proximaNoPadrao } = require('../../src/git/versao');
  it('soma na última casa; depois de 99 vira a de cima', () => {
    expect(proximaNoPadrao([0, 17, 38])).toEqual([0, 17, 39]);
    expect(proximaNoPadrao([0, 11, 98])).toEqual([0, 11, 99]);
    expect(proximaNoPadrao([0, 11, 99])).toEqual([0, 12, 0]);
    expect(proximaNoPadrao([0, 99, 99])).toEqual([1, 0, 0]);
  });
  it('a próxima versão segue o padrão a partir da maior entre arquivo e etiqueta', () => {
    const tags = ['v0.12.99'];
    expect(calcularVersao({ versao: [0, 11, 95], arquivo: 'package.json' }, maiorEtiqueta(tags), tags).proxima).toEqual([0, 13, 0]);
  });
});
