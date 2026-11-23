import { conferenciaTecnicaDeVideo } from '../../src/jobs/jobs.service';

describe('Conferência técnica de vídeo do Studio Workflow', () => {
  it('substitui true do renderizador por verificação de MP4 válido', () => {
    const cmd = conferenciaTecnicaDeVideo(
      'local-shell',
      'nivoo-renderizar-motion motion/black --saida midia/saida/black-v3.mp4 --segundos 25 --tamanho 1080x1920',
      {}, 'true',
    );
    expect(cmd).toContain("test -s 'midia/saida/black-v3.mp4'");
    expect(cmd).toContain('ffprobe');
    expect(cmd).toContain('select_streams v:0');
    expect(cmd).not.toBe('true');
  });

  it('exige uma trilha ou narração no MP4 montado quando solicitada', () => {
    const cmd = conferenciaTecnicaDeVideo('juntar-videos', 'juntar', {
      arquivo: 'midia/saida/final.mp4', trilha: { arquivo: 'midia/entrada/trilha.mp3' },
    }, 'true');
    expect(cmd).toContain('select_streams v:0');
    expect(cmd).toContain('select_streams a:0');
  });

  it('não altera conferência própria efetiva', () => {
    expect(conferenciaTecnicaDeVideo('local-shell',
      'nivoo-renderizar-motion motion/black --saida midia/saida/v3.mp4',
      {}, 'test -s out/verificacao.md',
    )).toBe('test -s out/verificacao.md');
  });

  it('não cria conferência de vídeo para etapas que não renderizam', () => {
    expect(conferenciaTecnicaDeVideo('local-shell', 'echo pronto', {}, 'true')).toBe('true');
  });
});
