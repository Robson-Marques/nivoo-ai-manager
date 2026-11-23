import * as path from 'node:path';

/**
 * Resolução conservadora de trilhas. Um arquivo diferente NÃO pode ser
 * substituído apenas porque é o último MP3 do projeto.
 * Fontes vêm de midia/entrada (nomes originais) e do catálogo de artefatos
 * do MESMO projeto. Sem acesso a diretórios de terceiros.
 */
export interface FonteTrilha {
  nome: string;
  arquivo: string;
  origem: 'midia-projeto' | 'artefato';
  sha256?: string | null;
}
export interface ResultadoTrilha {
  caminho?: string;
  nome?: string;
  origem?: string;
  motivo: 'exata' | 'basename' | 'similar-unica' | 'ambiguo' | 'inexistente';
  alternativas: string[];
}
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const NEGADO = /(?:^|[-_. ])(narracao|narração|locucao|locução|voz|voice|speech|tts|dialogo|diálogo|dublado|falado)(?:[-_. ]|$)/i;
const COMUNS = new Set(['de','da','do','dos','das','a','o','os','as','e','na','no','para','por','sua','seu','audio','áudio',
  'musica','música','trilha','instrumental','bgm','background','som','fundo','versao','versão','final','original','mix','master','faixa',
  'mp3','wav','m4a','aac','ogg','flac']);
function tokens(nome: string): string[] {
  const stem = path.posix.basename(nome.replace(/\\/g, '/')).replace(AUDIO, '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [...new Set(stem.split(/[^a-z0-9]+/).filter(t => t.length > 1 && !COMUNS.has(t) && !/^v\d+$/.test(t)))];
}
function nomeLimpo(nome: string): string {
  return path.posix.basename(nome.replace(/\\/g, '/')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function dedup(fontes: FonteTrilha[]): FonteTrilha[] {
  return [...new Map(fontes.map(f => [f.sha256 || f.arquivo, f])).values()];
}
function nomes(fontes: FonteTrilha[]): string[] {
  return [...new Set(fontes.map(f => f.nome))].sort((a,b) => a.localeCompare(b, 'pt-BR')).slice(0, 18);
}

export function escolherTrilha(procurado: string, fontes: FonteTrilha[]): ResultadoTrilha {
  // Artefatos são armazenados por hash SEM EXTENSÃO no disco; o nome
  // catalogado (não storagePath) informa o formato. Restringir pelo arquivo
  // físico excluiria justamente as trilhas de trabalhos anteriores.
  const validas = fontes.filter(f => AUDIO.test(f.nome) && !NEGADO.test(f.nome));
  const alternativas = nomes(validas);
  if (!AUDIO.test(procurado) || NEGADO.test(procurado)) return { motivo: 'inexistente', alternativas };

  // Preferir o caminho exato, quando veio explícito do plano.
  const igualCaminho = dedup(validas.filter(f => f.nome === procurado || f.arquivo === procurado));
  if (igualCaminho.length === 1) return { caminho: igualCaminho[0].arquivo, nome: igualCaminho[0].nome,
    origem: igualCaminho[0].origem, motivo: 'exata', alternativas };
  if (igualCaminho.length > 1) return { motivo: 'ambiguo', alternativas: nomes(igualCaminho) };

  const basename = nomeLimpo(procurado);
  const mesmoNome = dedup(validas.filter(f => nomeLimpo(f.nome) === basename));
  if (mesmoNome.length === 1) return { caminho: mesmoNome[0].arquivo, nome: mesmoNome[0].nome,
    origem: mesmoNome[0].origem, motivo: 'basename', alternativas };
  if (mesmoNome.length > 1) return { motivo: 'ambiguo', alternativas: nomes(mesmoNome) };

  // Só fazer correspondência aproximada quando há pelo menos DUAS palavras
  // distintivas do briefing, e todas aparecem no candidato. Ex.: "black
  // quinta". Nunca inferir que qualquer "trilha.mp3" é a música correta.
  const alvo = tokens(procurado);
  if (alvo.length < 2) return { motivo: 'inexistente', alternativas };
  const similares = dedup(validas.filter(f => {
    const t = tokens(f.nome);
    return alvo.every(k => t.includes(k)) && t.length <= alvo.length + 2;
  }));
  if (similares.length === 1) return { caminho: similares[0].arquivo, nome: similares[0].nome,
    origem: similares[0].origem, motivo: 'similar-unica', alternativas };
  if (similares.length > 1) return { motivo: 'ambiguo', alternativas: nomes(similares) };
  return { motivo: 'inexistente', alternativas };
}
