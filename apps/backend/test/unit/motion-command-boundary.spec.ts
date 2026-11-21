import { normalizarInstrucaoDeEtapa } from '../../src/jobs/jobs.service';

describe('Fronteira de comandos entre agente e executor', () => {
  it('não interpreta a explicação da IA como execução do renderizador', () => {
    const texto = 'Confira a composição: nivoo-renderizar-motion exige --saida midia/saida/<nome>.mp4 (nunca out/).';
    expect(normalizarInstrucaoDeEtapa(texto, 'codex-cli', 'conferir_previa')).toBe(texto);
  });
  it('permite que o agente descreva um comando que falhou e cite arquivos antigos', () => {
    const texto = 'Não use nivoo-renderizar-motion --saida out/teste.mp4; isso é uma nota de revisão.';
    expect(normalizarInstrucaoDeEtapa(texto, 'codex-cli', 'conferir_previa')).toBe(texto);
  });
  it('continua corrigindo o caminho de saída do comando real do executor', () => {
    const cmd = 'nivoo-renderizar-motion motion/black --saida out/teste.mp4 --segundos 25';
    expect(normalizarInstrucaoDeEtapa(cmd, 'local-shell', 'render')).toContain('--saida midia/saida/teste.mp4');
  });
  it('continua rejeitando comando real com saída inválida', () => {
    expect(() => normalizarInstrucaoDeEtapa(
      'nivoo-renderizar-motion motion/black --saida /tmp/teste.mp4',
      'local-shell', 'render',
    )).toThrow(/exige --saida/);
  });
});
