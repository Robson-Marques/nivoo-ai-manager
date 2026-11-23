import { escolherTrilha, FonteTrilha } from '../../src/providers/audio-asset-recovery';

function fonte(nome: string, arquivo = '/midia/projeto/entrada/' + nome, sha256?: string): FonteTrilha {
  return { nome, arquivo, sha256, origem: 'midia-projeto' };
}
function artefato(nome: string, hash = 'hash-unico-1'): FonteTrilha {
  // A store armazena mídias por SHA, SEM extensão no storagePath.
  return { nome, arquivo: '/artifacts/projeto/ab/' + hash, sha256: hash, origem: 'artefato' };
}

describe('Recuperar trilha de vídeo sem recriar projeto ou trocar música', () => {
  const pedido = 'black-na-sua-quinta-trilha-instrumental.mp3';

  it('recupera trilha por nome ORIGINAL do upload, apesar de nome físico UUID', () => {
    const r = escolherTrilha(pedido, [fonte(pedido, '/midia/entrada/550e8400-e29b-41d4-a716.mp3')]);
    expect(r).toMatchObject({ motivo: 'exata', caminho: '/midia/entrada/550e8400-e29b-41d4-a716.mp3' });
  });

  it('recupera artefato antigo armazenado por SHA sem extensão física', () => {
    const r = escolherTrilha(pedido, [artefato('out/trilha-black-quinta-instrumental.mp3')]);
    expect(r.motivo).toBe('similar-unica');
    expect(r.caminho).toMatch(/hash-unico-1$/);
    expect(r.origem).toBe('artefato');
  });

  it('aceita mudança de extensão quando a identidade é inequívoca', () => {
    const r = escolherTrilha(pedido, [fonte('Black na sua Quinta Trilha Instrumental.wav')]);
    expect(r.motivo).toBe('similar-unica');
  });

  it('não escolhe música de Finanças para vídeo Black na sua Quinta', () => {
    const r = escolherTrilha(pedido, [fonte('reel-financas-trilha.mp3')]);
    expect(r.motivo).toBe('inexistente');
    expect(r.caminho).toBeUndefined();
    expect(r.alternativas).toContain('reel-financas-trilha.mp3');
  });

  it('não converte voz/narração em trilha', () => {
    const r = escolherTrilha(pedido, [fonte('black-quinta-narracao.mp3')]);
    expect(r.motivo).toBe('inexistente');
    expect(r.caminho).toBeUndefined();
  });

  it('se duas músicas diferentes servem, para com ambiguidade em vez de escolher a última', () => {
    const r = escolherTrilha(pedido, [
      fonte('trilha-black-quinta-original.mp3', '/audios/1.mp3', 'hash1'),
      fonte('musica-black-quinta-acustica.mp3', '/audios/2.mp3', 'hash2'),
    ]);
    expect(r.motivo).toBe('ambiguo');
    expect(r.caminho).toBeUndefined();
    expect(r.alternativas).toHaveLength(2);
  });

  it('mídia idêntica em upload e catálogo não é considerada duas versões', () => {
    const r = escolherTrilha(pedido, [
      fonte('trilha-black-quinta.mp3', '/midia/upload/uuid.mp3', 'mesmohash'),
      artefato('out/trilha-black-quinta.mp3', 'mesmohash'),
    ]);
    expect(r.motivo).toBe('similar-unica');
    expect(r.caminho).toBeDefined();
  });

  it('um MP3 genérico sozinho não pode ser tratado como a música aprovada', () => {
    const r = escolherTrilha(pedido, [fonte('trilha-instrumental.mp3')]);
    expect(r.motivo).toBe('inexistente');
  });

  it('não usa um arquivo não áudio ou um caminho mencionado apenas no texto', () => {
    expect(escolherTrilha(pedido, [fonte('black-quinta-cartaz.png')]).caminho).toBeUndefined();
    expect(escolherTrilha(pedido, []).alternativas).toEqual([]);
  });
});
