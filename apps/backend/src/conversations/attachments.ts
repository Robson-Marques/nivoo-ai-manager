import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { textName } from '../common/knowledge-upload';
import { resolveInside } from '../common/path-guard';
import { extractText, isDocument, isLegacyDocument } from '../common/text-extract';

/**
 * Anexos do chat: imagens (fotos, prints) vão como imagem para a IA ver; documentos (PDF, Office,
 * LibreOffice) viram texto, como no conhecimento; arquivos de texto e código entram como estão.
 * Ficam em <projeto>/anexos/<conversa>/<mensagem>/ (fora do git) e chegam à IA como cópia de leitura em
 * contexto/anexos/<mensagem>/<arquivo>.
 */
export interface Anexo {
  nome: string;
  tipo: 'imagem' | 'texto' | 'audio';
  bytes: number;
  /** Nome original quando o arquivo foi convertido em texto (ex.: contrato.pdf). */
  de?: string;
}

export const MAX_ANEXOS = 10;
export const MAX_ANEXO_BYTES = 10 * 1024 * 1024;
/** Teto do que é copiado para a sessão da IA (anexos mais recentes primeiro). */
const MAX_ANEXOS_SESSAO_BYTES = 60 * 1024 * 1024;

const IMAGEM = /\.(png|jpe?g|gif|webp)$/i;
/** Música ou locução (ex.: a trilha de fundo de um vídeo): guardada como está. */
const AUDIO = /\.(mp3|wav|m4a|aac|ogg)$/i;
const TEXTO = /\.(txt|md|markdown|csv|tsv|json|html?|xml|ya?ml|ini|toml|log|sql|py|ts|tsx|js|jsx|css|scss|sh|java|kt|go|rs|rb|php|cs|c|h|cpp|swift|vue|svelte)$/i;

export const TIPOS_IMAGEM: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export function ehImagem(nome: string): boolean {
  return IMAGEM.test(nome);
}

/** Nome seguro (sem pastas), mantendo a extensão. */
function nomeSeguro(raw: unknown): string {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  if (!base || base === '.' || base === '..' || base.length > 150) throw new BadRequestException('Nome de anexo inválido');
  return base;
}

/** Valida e prepara os anexos enviados: `[{ nome, contentBase64 }]`. */
export async function prepararAnexos(raw: unknown): Promise<Array<Anexo & { conteudo: Buffer }>> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('anexos deve ser uma lista');
  if (raw.length > MAX_ANEXOS) throw new BadRequestException(`No máximo ${MAX_ANEXOS} anexos por mensagem`);
  const out: Array<Anexo & { conteudo: Buffer }> = [];
  const usados = new Set<string>();
  for (const a of raw) {
    const nome = nomeSeguro(a?.nome);
    if (typeof a?.contentBase64 !== 'string') throw new BadRequestException(`Anexo sem conteúdo: ${nome}`);
    const conteudo = Buffer.from(a.contentBase64, 'base64');
    if (!conteudo.length) throw new BadRequestException(`Anexo vazio: ${nome}`);
    if (conteudo.length > MAX_ANEXO_BYTES) throw new BadRequestException(`${nome} passa de 10 MB`);
    let item: Anexo & { conteudo: Buffer };
    if (IMAGEM.test(nome)) item = { nome, tipo: 'imagem', bytes: conteudo.length, conteudo };
    else if (AUDIO.test(nome)) item = { nome, tipo: 'audio', bytes: conteudo.length, conteudo };
    else if (isDocument(nome) || isLegacyDocument(nome)) {
      let texto: string;
      try {
        texto = await extractText(nome, conteudo);
      } catch (e: any) {
        throw new BadRequestException(`${nome}: ${e?.message ?? 'não foi possível ler'}`);
      }
      if (!texto.trim()) throw new BadRequestException(`${nome}: sem texto legível`);
      const txt = Buffer.from(`${texto}\n`, 'utf8');
      item = { nome: textName(nome, usados), tipo: 'texto', bytes: txt.length, de: nome, conteudo: txt };
    } else if (TEXTO.test(nome)) item = { nome, tipo: 'texto', bytes: conteudo.length, conteudo };
    else throw new BadRequestException(`${nome}: tipo de arquivo não suportado. Envie imagem (PNG, JPG, GIF, WEBP), áudio (MP3, WAV, M4A), PDF, Word, Excel, PowerPoint, LibreOffice ou arquivo de texto/código`);
    if (usados.has(item.nome.toLowerCase())) throw new BadRequestException(`Dois anexos com o mesmo nome: ${item.nome}`);
    usados.add(item.nome.toLowerCase());
    out.push(item);
  }
  return out;
}

export function pastaDosAnexos(projectRoot: string, conversationId: string, messageId: string): string {
  return resolveInside(projectRoot, path.join('anexos', conversationId, messageId));
}

export function gravarAnexos(projectRoot: string, conversationId: string, messageId: string, anexos: Array<Anexo & { conteudo: Buffer }>): Anexo[] {
  if (!anexos.length) return [];
  const dir = pastaDosAnexos(projectRoot, conversationId, messageId);
  fs.mkdirSync(dir, { recursive: true });
  return anexos.map(({ conteudo, ...a }) => {
    fs.writeFileSync(path.join(dir, a.nome), conteudo);
    return a;
  });
}

export function lerAnexo(projectRoot: string, conversationId: string, messageId: string, nome: string): Buffer | null {
  const arq = resolveInside(pastaDosAnexos(projectRoot, conversationId, messageId), nomeSeguro(nome));
  return fs.existsSync(arq) ? fs.readFileSync(arq) : null;
}

/** Caminho do anexo como a IA o vê na sessão. */
export function caminhoNaSessao(messageId: string, nome: string): string {
  return `contexto/anexos/${messageId}/${nome}`;
}

/**
 * Copia para `<workdir>/contexto/anexos/` os anexos das mensagens indicadas (mais recentes primeiro, até o
 * teto). Devolve os que entraram, com o caminho na sessão.
 */
export function copiarAnexosParaSessao(
  projectRoot: string,
  workdir: string,
  mensagens: Array<{ id: string; conversationId: string; attachments: unknown }>,
): Array<Anexo & { mensagem: string; caminho: string }> {
  const copiados: Array<Anexo & { mensagem: string; caminho: string }> = [];
  let total = 0;
  for (const m of mensagens) {
    for (const a of (Array.isArray(m.attachments) ? m.attachments : []) as Anexo[]) {
      const origem = path.join(pastaDosAnexos(projectRoot, m.conversationId, m.id), a.nome);
      if (!fs.existsSync(origem) || total + a.bytes > MAX_ANEXOS_SESSAO_BYTES) continue;
      const caminho = caminhoNaSessao(m.id, a.nome);
      const destino = path.join(workdir, caminho);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(origem, destino);
      total += a.bytes;
      copiados.push({ ...a, mensagem: m.id, caminho });
    }
  }
  return copiados;
}

/** "contrato.txt (texto de contrato.pdf)" / "foto.png (imagem)". */
export function descreverAnexo(a: Anexo & { caminho?: string }): string {
  const onde = a.caminho ?? a.nome;
  if (a.tipo === 'audio') return `${onde} (áudio: música ou locução; para usar como trilha de um vídeo, coloque no projeto com "anexosNoProjeto")`;
  return a.tipo === 'imagem' ? `${onde} (imagem: abra o arquivo para ver)` : a.de ? `${onde} (texto extraído de ${a.de})` : `${onde} (texto)`;
}
