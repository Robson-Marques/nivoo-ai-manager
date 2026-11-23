import { BadRequestException } from '@nestjs/common';
import { corrigirPlanoRenderizacaoMotion, dependenciasDeMontagemPorArquivo, etapaPedeRenderizacaoMotion } from '../../src/jobs/executor-priority';

describe('Planejamento de renderização motion: execução real, sem aceitar MP4 antigo', () => {
  const alvo = 'midia/saida/black-na-sua-quinta-3d-v3-final.mp4';

  it('detecta o plano defeituoso que chamaria NVIDIA para renderizar', () => {
    const step = {
      key: 'render_3d',
      title: 'Renderizar composição 3D v3 existente',
      provider: 'nvidia-api',
      instructions: 'Renderize a composição 3D v3 existente e entregue o vídeo.',
      verifyCommand: `test -s ${alvo}`,
    };
    expect(etapaPedeRenderizacaoMotion(step)).toBe(true);
    expect(() => corrigirPlanoRenderizacaoMotion([step], 'nvidia-api',
      'Renderizar a composição 3D v3 e montar com trilha.')).toThrow(BadRequestException);
  });

  it('direciona ao executor local quando fonte, nome, duração e tamanho são explícitos', () => {
    const step = {
      key: 'render_3d',
      title: 'Renderizar composição 3D existente',
      instructions: 'Renderizar motion/black-na-sua-quinta-3d-v3 para vídeo novo.',
      verifyCommand: `test -s ${alvo}`,
    };
    const [normalizado] = corrigirPlanoRenderizacaoMotion([step], 'nvidia-api',
      'Composição existente, 25 segundos, 1080x1920.') as Array<Record<string, unknown>>;
    expect(normalizado.provider).toBe('local-shell');
    expect(normalizado.instructions).toBe(
      `nivoo-renderizar-motion motion/black-na-sua-quinta-3d-v3 --saida ${alvo} --segundos 25 --tamanho 1080x1920`);
  });

  it('preserva etapas de criação de HTML e provedores que realmente geram vídeo', () => {
    const stages = [
      { key: 'criar-composicao', title: 'Criar composição 3D', instructions: 'Escreva motion/v3/index.html', verifyCommand: 'test -s motion/v3/index.html' },
      { key: 'render', title: 'Renderizar vídeo 3D', provider: 'gemini-video', instructions: 'Cena de pizza', verifyCommand: `test -s ${alvo}` },
    ];
    const done = corrigirPlanoRenderizacaoMotion(stages, 'nvidia-api', 'Cena de vídeo') as typeof stages;
    expect(done).toEqual(stages);
  });

  it('recusa etapa local-shell que só verifica MP4 antigo sem chamar renderizador', () => {
    const step = {
      key: 'render_3d', title: 'Renderizar composição 3D',
      provider: 'local-shell', instructions: 'true',
      verifyCommand: `test -s ${alvo}`,
    };
    expect(() => corrigirPlanoRenderizacaoMotion([step], 'nvidia-api')).toThrow(/não executa nivoo-renderizar-motion/);
  });

  it('juntar-videos depende automaticamente do MP4 produzido pelo render no mesmo trabalho', () => {
    const stages = [
      {
        key: 'render_mudo', provider: 'local-shell',
        instructions: 'nivoo-renderizar-motion motion/v3 --saida midia/saida/novo-mudo.mp4 --segundos 25 --tamanho 1080x1920',
      },
      {
        key: 'montar_trilha', provider: 'juntar-videos',
        instructions: 'Montar trilha existente', providerOptions: {
          cenas: ['midia/saida/novo-mudo.mp4'],
          arquivo: 'midia/saida/novo-final.mp4',
          trilha: { arquivo: 'musica.mp3' },
        },
      },
    ];
    const resolved = dependenciasDeMontagemPorArquivo(stages, 'nvidia-api') as Array<{ key: string; dependsOn?: string[] }>;
    expect(resolved.find(s => s.key === 'montar_trilha')?.dependsOn).toEqual(['render_mudo']);
    expect(resolved.find(s => s.key === 'render_mudo')?.dependsOn).toBeUndefined();
  });

  it('preserva dependências anteriores e aceita cenas externas sem produtor no job', () => {
    const stages = [
      { key: 'preparar', provider: 'local-shell', instructions: 'echo pronto' },
      { key: 'render_mudo', provider: 'local-shell', instructions: 'nivoo-renderizar-motion motion/v3 --saida midia/saida/mudo.mp4 --segundos 25 --tamanho 1080x1920' },
      { key: 'montagem', provider: 'juntar-videos',
        dependsOn: ['preparar'], providerOptions: { cenas: ['midia/saida/mudo.mp4', 'midia/saida/outra.mp4'], arquivo: 'midia/saida/final.mp4' } },
    ];
    const once = dependenciasDeMontagemPorArquivo(stages, 'nvidia-api') as typeof stages;
    const twice = dependenciasDeMontagemPorArquivo(once, 'nvidia-api') as typeof stages;
    expect(once[2].dependsOn).toEqual(['preparar', 'render_mudo']);
    expect(twice).toEqual(once);
  });

  it('rejeita dois renders que tentam sobrescrever o mesmo MP4', () => {
    const stages = ['render1', 'render2'].map(key => ({
      key, provider: 'local-shell',
      instructions: 'nivoo-renderizar-motion motion/v3 --saida midia/saida/mesmo.mp4 --segundos 25 --tamanho 1080x1920',
    }));
    expect(() => dependenciasDeMontagemPorArquivo(stages, 'nvidia-api')).toThrow(/mesmo MP4/);
  });

  it('não aceita um nome de MP4 como suposta fonte de composição', () => {
    const step = {
      key: 'render_3d', title: 'Renderizar composição 3D', provider: 'nvidia-api',
      instructions: 'Entregar vídeo em midia/saida/final.mp4, 25s, 1080x1920',
      verifyCommand: 'test -s midia/saida/final.mp4',
    };
    expect(() => corrigirPlanoRenderizacaoMotion([step], 'nvidia-api')).toThrow(/fonte REAL/);
  });
});
