import { tipoMidia } from '../../src/storage/media-kind';

describe('Classificação única dos arquivos de mídia', () => {
  it('identifica vídeos pela extensão e não pelo nome promocional', () => {
    expect(tipoMidia('black-na-sua-quinta.mp4')).toBe('video');
  });
  it('separa locução de trilha', () => {
    expect(tipoMidia('previa-locucao-b.mp3')).toBe('locucao');
    expect(tipoMidia('black-na-sua-quinta-trilha-instrumental.mp3')).toBe('trilha');
  });
  it('considera extensão do caminho durável em uploads renomeados', () => {
    expect(tipoMidia('Promoção de quinta', 'midia/entrada/arquivo.mp4')).toBe('video');
  });
  it('não inventa aprovação para arquivo sem papel definido', () => {
    expect(tipoMidia('audio-2026.mp3')).toBe('audio');
  });
});
