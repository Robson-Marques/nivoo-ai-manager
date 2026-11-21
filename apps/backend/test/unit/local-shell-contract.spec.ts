import { erroDeComandoLocal } from '../../src/jobs/executor-priority';

describe('Contrato de comandos do executor local', () => {
  it.each([
    'Retome o trabalho existente e capture a prévia',
    'Capture a composição atualizada',
    'Confira a prévia antes de renderizar',
    'retome',
    'capturar',
    'execute',
  ])('recusa uma instrução em linguagem natural (%s)', value => {
    expect(erroDeComandoLocal(value)).toMatch(/texto em vez de comando Bash/);
  });
  it.each([
    'nivoo-conferir-arte motion/black --saida out/qualidade/qa --segundos 25 --tamanho 1080x1920',
    'nivoo-renderizar-motion motion/black --saida midia/saida/black.mp4',
    'test -s out/qualidade/qa/quadro.png',
    'python3 -c "print(1)"',
    'set -e\\nffprobe -v error input.mp4',
    'bash script.sh',
    './scripts/render.sh video',
  ])('aceita um comando shell real (%s)', value => {
    expect(erroDeComandoLocal(value)).toBeNull();
  });
});
