import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkGeneratedImageOutputs, requiredRasterOutputs } from '../../src/worker/image-output-guard';

describe('preflight de imagem gerada', () => {
  let workspace: string;
  beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-asset-test-')); });
  afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

  const step = {
    title: 'Criar fotos novas dos dois sabores',
    instructions: 'Gerar duas fotos inéditas de pizzas.',
    verifyCommand: 'test -s motion/pizza-lombo.png && test -s motion/pizza-peru-amora.png && ! cmp -s motion/pizza-lombo.png motion/pizza-peru-amora.png',
  };

  it('reconhece nomes de imagens que a etapa realmente verifica', () => {
    expect(requiredRasterOutputs(step.verifyCommand)).toEqual(['motion/pizza-lombo.png', 'motion/pizza-peru-amora.png']);
  });
  it('bloqueia antes de gastar tokens quando o skill não entrega PNG local', () => {
    expect(checkGeneratedImageOutputs(step, 'codex-cli--450809da', workspace)).toContain('Faltam: motion/pizza-lombo.png');
  });
  it('permite a geração nativa contratada antes de o PNG existir',()=>{
    const native={...step,verifyCommand:'test -s motion/pizza-lombo.png',providerOptions:{visualAsset:{arquivo:'motion/pizza-lombo.png',transparente:true}}};
    expect(checkGeneratedImageOutputs(native,'codex-cli--450809da',workspace)).toBeNull();
    expect(checkGeneratedImageOutputs(native,'claude-code-cli',workspace)).not.toBeNull();
    expect(checkGeneratedImageOutputs({...native,verifyCommand:step.verifyCommand},'codex-cli--450809da',workspace)).toContain('motion/pizza-peru-amora.png');
  });
  it('não bloqueia quando todos os PNGs já estão no workspace', () => {
    fs.mkdirSync(path.join(workspace, 'motion'));
    fs.writeFileSync(path.join(workspace, 'motion/pizza-lombo.png'), Buffer.from([137,80,78,71]));
    fs.writeFileSync(path.join(workspace, 'motion/pizza-peru-amora.png'), Buffer.from([137,80,78,71,1]));
    expect(checkGeneratedImageOutputs(step, 'codex-cli', workspace)).toBeNull();
  });
  it('não bloqueia revisão e edição de imagens existentes', () => {
    expect(checkGeneratedImageOutputs({...step,title:'Corrigir fotos',instructions:'Ajustar o CSS das imagens existentes'},'codex-cli',workspace)).toBeNull();
  });
  it('ignora verificação que não exige imagem binária', () => {
    expect(checkGeneratedImageOutputs({...step,verifyCommand:'test -s motion/index.html'},'codex-cli',workspace)).toBeNull();
  });
});
