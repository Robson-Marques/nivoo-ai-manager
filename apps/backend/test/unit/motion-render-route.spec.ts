import { BadRequestException } from '@nestjs/common';
import { corrigirPlanoRenderizacaoMotion, etapaPedeRenderizacaoMotion } from '../../src/jobs/executor-priority';

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

  it('não aceita um nome de MP4 como suposta fonte de composição', () => {
    const step = {
      key: 'render_3d', title: 'Renderizar composição 3D', provider: 'nvidia-api',
      instructions: 'Entregar vídeo em midia/saida/final.mp4, 25s, 1080x1920',
      verifyCommand: 'test -s midia/saida/final.mp4',
    };
    expect(() => corrigirPlanoRenderizacaoMotion([step], 'nvidia-api')).toThrow(/fonte REAL/);
  });
});
