/**
 * Uma classificação única para exibição de mídias no Nivoo.
 * Não é evidência de aprovação: só o ID do artefato selecionado é autoritativo.
 */
export type TipoMidia = 'video' | 'locucao' | 'trilha' | 'audio';

export function tipoMidia(nome: string, caminho?: string): TipoMidia {
  const arquivo = String(caminho || nome).toLowerCase();
  if (/\.(mp4|mov|webm)$/i.test(arquivo)) return 'video';
  const nomeVisivel = String(nome).toLowerCase();
  if (/trilha|instrumental|m[uú]sica|soundtrack/i.test(nomeVisivel)) return 'trilha';
  if (/locu[cç][aã]o|narr[aã]c[aã]o|voz|fala|tts/i.test(nomeVisivel)) return 'locucao';
  return 'audio';
}
