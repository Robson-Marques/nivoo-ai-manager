import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { capturasMotionDesatualizadas } from '../../src/jobs/completion.service';

describe('Evidência visual precisa corresponder à versão atual', () => {
  let dir: string;
  const step = { key: 'capturar_final', provider: 'local-shell', status: 'CONCLUIDO', instructions: 'nivoo-conferir-arte motion/black --saida out/qualidade/quadro-final --segundos 25 --tamanho 1080x1920' };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-motion-test-'));
    fs.mkdirSync(path.join(dir, 'motion/black/assets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'out/qualidade/quadro-final'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'motion/black/index.html'), '<html></html>');
    fs.writeFileSync(path.join(dir, 'out/qualidade/quadro-final/quadro.png'), 'PNG');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('detecta HTML editado depois da captura', () => {
    const anterior = new Date(Date.now() - 30000);
    fs.utimesSync(path.join(dir, 'out/qualidade/quadro-final/quadro.png'), anterior, anterior);
    expect(capturasMotionDesatualizadas(dir, [step])).toEqual(['capturar_final']);
  });
  it('detecta nova imagem ou JS nos assets', () => {
    const anterior = new Date(Date.now() - 30000);
    fs.utimesSync(path.join(dir, 'out/qualidade/quadro-final/quadro.png'), anterior, anterior);
    fs.writeFileSync(path.join(dir, 'motion/black/assets/logo.js'), 'const logo=true;');
    expect(capturasMotionDesatualizadas(dir, [step])).toEqual(['capturar_final']);
  });
  it('não solicita recaptura de um quadro mais novo que a fonte', () => {
    const anterior = new Date(Date.now() - 30000);
    fs.utimesSync(path.join(dir, 'motion/black/index.html'), anterior, anterior);
    expect(capturasMotionDesatualizadas(dir, [step])).toEqual([]);
  });
});
