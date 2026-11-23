import {
  assinaturaErroDaEtapa, assinaturasDasFalhas, historicoDeFalhas, MARCADOR_RECUPERACAO,
  MAX_OCORRENCIAS_MESMA_FALHA, recorrenciasDasFalhas, repeticoesDoMesmoErro,
} from '../../src/jobs/recovery-signature';

const falhaComando = (saida: string) => ({
  key: 'regra-e-historico',
  kind: 'COMMAND',
  evidence: {
    comando: 'npm --prefix financas-api test -- --runInBand && nivoo-conferir-telas',
    exitCode: 1,
    timeout: false,
    stdout: saida,
    stderr: '',
  },
});
const revisar = (texto: string) => assinaturasDasFalhas([
  { key: 'conferencia-regras', kind: 'COMMAND', evidence: { exitCode: 1 } },
], [texto])[0];
const correcao = (n: number, hashes: string[]) => ({
  key: 'correcao-criterios-' + n,
  instructions: MARCADOR_RECUPERACAO + hashes.join(',') + '\nCorrigir as falhas identificadas.',
});

describe('recuperação progressiva: três ocorrências do MESMO defeito', () => {
  it('corrige sem teto global uma sequência de erros diferentes', () => {
    const anteriores: ReturnType<typeof correcao>[] = [];
    for (let n = 1; n <= 12; n++) {
      const falha = assinaturasDasFalhas([falhaComando('AssertionError: falha distinta na regra ' + n)]);
      expect(recorrenciasDasFalhas(anteriores, falha)[0].ocorrencias).toBe(1);
      anteriores.push(correcao(n, falha.map((f) => f.hash)));
    }
    expect(anteriores).toHaveLength(12);
  });

  it('na terceira ocorrência idêntica bloqueia novas correções', () => {
    const assinatura = assinaturasDasFalhas([falhaComando('AssertionError: esperado 400, recebido 201')]);
    const anteriores = [correcao(1, assinatura.map((f) => f.hash)), correcao(2, assinatura.map((f) => f.hash))];
    const atual = recorrenciasDasFalhas(anteriores, assinatura)[0];
    expect(atual.ocorrencias).toBe(MAX_OCORRENCIAS_MESMA_FALHA);
  });

  it('mesmo critério que falha por outra causa não herda as duas tentativas anteriores', () => {
    const a = assinaturasDasFalhas([falhaComando('AssertionError: data 31 de novembro aceita')])[0];
    const b = assinaturasDasFalhas([falhaComando('AssertionError: captura Este mês ausente')])[0];
    expect(a.hash).not.toBe(b.hash);
    expect(recorrenciasDasFalhas([correcao(1, [a.hash]), correcao(2, [a.hash])], [b])[0].ocorrencias).toBe(1);
  });

  it('violações diferentes da revisão são problemas diferentes', () => {
    const a = revisar('Falta captura da tela Este mês no celular');
    const b = revisar('O campo de data ignora resposta atrasada da API');
    expect(a.hash).not.toBe(b.hash);
    expect(recorrenciasDasFalhas([correcao(1, [a.hash]), correcao(2, [a.hash])], [b])[0].ocorrencias).toBe(1);
  });

  it('alternar erros sem progresso não burla a trava na terceira ocorrência do primeiro', () => {
    const a = revisar('O cálculo da competência está errado');
    const b = revisar('O formulário não recupera da falha de rede');
    const anteriores = [correcao(1, [a.hash]), correcao(2, [b.hash]), correcao(3, [a.hash]), correcao(4, [b.hash])];
    expect(recorrenciasDasFalhas(anteriores, [a])[0].ocorrencias).toBe(3);
    expect(recorrenciasDasFalhas(anteriores, [b])[0].ocorrencias).toBe(3);
  });

  it('avisos incidentais de versão e cores ANSI não criam um erro novo', () => {
    const a = assinaturasDasFalhas([falhaComando('AssertionError: vencimento incorreto\n[Nest] WARN [VersionHelper] git describe falhou: spawn /bin/sh ENOENT')])[0];
    const b = assinaturasDasFalhas([falhaComando('\u001b[31mAssertionError: vencimento incorreto\u001b[39m\n[Nest] WARN [VersionHelper] git tag --list falhou: spawn /bin/sh ENOENT')])[0];
    expect(a.hash).toBe(b.hash);
  });

  it('etapa de IA não para por ter corrigido erros diferentes em várias sessões', () => {
    const anteriores = Array.from({ length: 10 }, (_, n) => 'verificação da etapa falhou: problema diferente ' + n);
    const atual = 'verificação da etapa falhou: problema completamente novo';
    expect(repeticoesDoMesmoErro([...anteriores, atual], atual, 'npm test')).toBe(1);
  });

  it('mesma falha com caminho temporário e número de tentativa diferentes conta como igual', () => {
    const a = 'Montagem falhou /tmp/nivoo-juntar-a3X9/final.mp4: áudio ausente (tentativa #1)';
    const b = 'Montagem falhou /tmp/nivoo-juntar-kL812/final.mp4: áudio ausente (tentativa #2)';
    const c = 'Montagem falhou /tmp/nivoo-juntar-aaa13/final.mp4: áudio ausente (tentativa #3)';
    expect(assinaturaErroDaEtapa(a)).toBe(assinaturaErroDaEtapa(b));
    expect(repeticoesDoMesmoErro([a, b, c], c)).toBe(3);
  });

  it('etapa de IA para na terceira ocorrência do mesmo erro, inclusive intercalada', () => {
    const a = 'verificação da etapa falhou: AssertionError: resposta inválida 201';
    const b = 'verificação da etapa falhou: AssertionError: foto não gerada';
    expect(assinaturaErroDaEtapa(a)).not.toBe(assinaturaErroDaEtapa(b));
    expect(repeticoesDoMesmoErro([a, b, a], a, 'npm test')).toBe(2);
    expect(repeticoesDoMesmoErro([a, b, a, a], a, 'npm test')).toBe(3);
  });

  it('fluxo de vídeo: erros diferentes de legendas, transições e render não são o mesmo erro', () => {
    const legendas = revisar('Legendas do vídeo sobrepõem a marca');
    const transicoes = revisar('Transições 3D não seguem o roteiro visual');
    const montagem = revisar('Renderização do MP4 falhou por saída inválida');
    const anteriores = [
      correcao(1, [legendas.hash]),
      correcao(2, [transicoes.hash]),
    ];
    expect(recorrenciasDasFalhas(anteriores, [montagem])[0].ocorrencias).toBe(1);
    expect(recorrenciasDasFalhas([...anteriores, correcao(3, [montagem.hash])], [legendas])[0].ocorrencias).toBe(2);
  });

  it('etapas antigas não são tratadas como a mesma falha sem evidência', () => {
    const a = revisar('Falta uma captura de Cartões');
    expect(historicoDeFalhas([{ key: 'correcao-criterios-1', instructions: 'Revisar critério conferencia-regras' }]).size).toBe(0);
    expect(recorrenciasDasFalhas([
      { key: 'correcao-criterios-1', instructions: 'Revisar critério conferencia-regras' },
    ], [a])[0].ocorrencias).toBe(1);
  });

  it('uma etapa contendo várias falhas só registra uma ocorrência por assinatura', () => {
    const a = revisar('Erro A');
    const b = revisar('Erro B');
    const anteriores = [correcao(1, [a.hash, b.hash, a.hash])];
    expect(historicoDeFalhas(anteriores).get(a.hash)).toBe(1);
    expect(recorrenciasDasFalhas(anteriores, [a, b]).map((f) => f.ocorrencias)).toEqual([2, 2]);
  });
});
