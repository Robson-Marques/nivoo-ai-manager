import { comPreflightVisual } from '../../src/jobs/jobs.service';

describe('Motion: QA da linha do tempo antes do MP4', () => {
  const plano = () => comPreflightVisual([
    { key: 'desenhar', title: 'Compor vídeo', provider: 'claude-code-cli', instructions: 'Criar animação 3D' },
    {
      key: 'renderizar', title: 'Render', provider: 'local-shell',
      instructions: 'nivoo-renderizar-motion motion/black-quinta --saida midia/saida/black-quinta.mp4 --segundos 25 --tamanho 1080x1920',
      dependsOn: ['desenhar'], verifyCommand: 'true',
    },
  ], 'claude-code-cli') as Array<{ key: string; provider: string; instructions: string; verifyCommand?: string; dependsOn?: string[] }>;

  it('gera captura real antes do render, exigindo quatro ou mais instantes e nenhum erro JS/WebGL', () => {
    const itens = plano();
    expect(itens).toHaveLength(4);
    const cap = itens.find(s => s.key === 'qa-visual-renderizar')!;
    expect(cap.instructions).toContain('nivoo-conferir-arte motion/black-quinta');
    expect(cap.verifyCommand).toContain("len(q)>=4");
    expect(cap.verifyCommand).toContain("not d.get('errosJavascript')");
    expect(cap.instructions).toContain('--segundos 25 --tamanho 1080x1920');
  });

  it('inspeciona megafone, neon, moldura A partir de e movimento em TODOS os quadros', () => {
    const itens = plano();
    const revista = itens.find(s => s.key === 'direcao-arte-renderizar')!;
    expect(revista.instructions).toMatch(/megafone/i);
    expect(revista.instructions).toMatch(/neon/i);
    expect(revista.instructions).toMatch(/A partir de/i);
    expect(revista.instructions).toContain('quadrosInspecionados');
    expect(revista.verifyCommand).toContain("d.get('movimentoConforme') is True");
    expect(revista.verifyCommand).toContain("all(x['arquivo'] in vistos for x in q)");
    expect(itens.at(-1)?.dependsOn).toContain(revista.key);
  });

  it('não cria segunda inspeção quando o plano já está normalizado', () => {
    const umaVez = plano();
    const duasVezes = comPreflightVisual(umaVez, 'claude-code-cli') as Array<{ key: string }>;
    expect(duasVezes.map(s => s.key)).toEqual(umaVez.map(s => s.key));
  });
});
