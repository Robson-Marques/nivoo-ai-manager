import { conferenciaTecnicaDeVideo } from '../../src/jobs/video-step-verification';

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
    )).toContain('ffprobe');
  });

  it('complementa teste de existência do render com ffprobe sem renderizar novamente', () => {
    const cmd = conferenciaTecnicaDeVideo('local-shell',
      'nivoo-renderizar-motion motion/pizza --saida midia/saida/pizza.mp4',
      {}, 'test -s midia/saida/pizza.mp4');
    expect(cmd).toContain('ffprobe');
    expect(cmd).not.toContain('nivoo-renderizar-motion');
  });

  it('exige a duração e a resolução anunciadas pelo renderizador', () => {
    const cmd = conferenciaTecnicaDeVideo('local-shell',
      'nivoo-renderizar-motion motion/pizza --saida midia/saida/pizza.mp4 --segundos 25 --tamanho 1080x1920',
      {}, 'true');
    expect(cmd).toContain('stream=width,height');
    expect(cmd).toContain("'1080x1920'");
    expect(cmd).toContain('format=duration');
    expect(cmd).toContain('-v target=25');
  });

  it('não cria conferência de vídeo para etapas que não renderizam', () => {
    expect(conferenciaTecnicaDeVideo('local-shell', 'echo pronto', {}, 'true')).toBe('true');
  });
});
