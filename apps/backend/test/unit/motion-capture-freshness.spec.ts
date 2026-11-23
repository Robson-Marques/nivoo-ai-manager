import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { capturasMotionDesatualizadas } from '../../src/jobs/completion.service';
import { capturasParaRecuperar } from '../../src/jobs/motion-capture-freshness';

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
  it('direção de arte do vídeo 3D recaptura PNG antigo após ajustar HTML, sem reiniciar a composição', () => {
    const anterior = new Date(Date.now() - 30000);
    fs.utimesSync(path.join(dir, 'out/qualidade/quadro-final/quadro.png'), anterior, anterior);
    const revisao = {
      key: 'direcao-arte-renderizar',
      verifyCommand: 'python3 -c "import json;json.load(open(\'out/qualidade/quadro-final/parecer.json\'))"',
    };
    expect(capturasParaRecuperar(dir, revisao, [step])).toEqual(['capturar_final']);
    // Após a captura ser regenerada com base no código novo, não repetir a IA.
    const futuro = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(dir, 'out/qualidade/quadro-final/quadro.png'), futuro, futuro);
    expect(capturasParaRecuperar(dir, revisao, [step])).toEqual([]);
  });

  it('não reabre captura de outro tipo de etapa por uma alteração em motion', () => {
    const anterior = new Date(Date.now() - 30000);
    fs.utimesSync(path.join(dir, 'out/qualidade/quadro-final/quadro.png'), anterior, anterior);
    expect(capturasParaRecuperar(dir, {key:'analisar-planilha',verifyCommand:'true'}, [step])).toEqual([]);
  });

  it('não solicita recaptura de um quadro mais novo que a fonte', () => {
    const anterior = new Date(Date.now() - 30000);
    fs.utimesSync(path.join(dir, 'motion/black/index.html'), anterior, anterior);
    expect(capturasMotionDesatualizadas(dir, [step])).toEqual([]);
  });
});
