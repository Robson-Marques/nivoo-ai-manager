import { BadRequestException } from '@nestjs/common';
import { extractText, isDocument, isLegacyDocument } from './text-extract';

export const MAX_KNOWLEDGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 3000;
const IGNORED_DIRS = /(^|\/)(node_modules|\.git|__pycache__|\.venv)(\/|$)/;
const IGNORED_FILES = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

/** Caminho relativo seguro dentro de uma pasta de conhecimento. */
export function knowledgePath(rel: unknown): string {
  const p = String(rel ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.includes('..') || p.split('/').some((x) => x === '.git' || x === '')) throw new BadRequestException('Caminho inválido');
  if (p.length > 300) throw new BadRequestException('Caminho muito longo');
  return p;
}

/**
 * Lê um envio de arquivos/pasta `{ files: [{ path, contentBase64 }] }` (base ou conhecimento do projeto).
 * Ignora pastas de sistema (node_modules, .git...) e arquivos maiores que 10 MB, que voltam em `ignorados`.
 */
export function parseKnowledgeUpload(body: any): { files: Array<{ path: string; content: Buffer }>; ignorados: string[] } {
  const lista = Array.isArray(body?.files) ? body.files : null;
  if (!lista || !lista.length) throw new BadRequestException('Envie files: [{path, contentBase64}]');
  if (lista.length > MAX_FILES_PER_UPLOAD) throw new BadRequestException(`Máximo de ${MAX_FILES_PER_UPLOAD} arquivos por envio`);
  const files: Array<{ path: string; content: Buffer }> = [];
  const ignorados: string[] = [];
  for (const f of lista) {
    const bruto = String(f?.path ?? '').replace(/\\/g, '/');
    if (IGNORED_DIRS.test(bruto) || IGNORED_FILES.test(bruto)) {
      ignorados.push(bruto);
      continue;
    }
    const rel = knowledgePath(bruto);
    if (typeof f?.contentBase64 !== 'string') throw new BadRequestException(`Arquivo sem conteúdo: ${rel}`);
    const content = Buffer.from(f.contentBase64, 'base64');
    if (content.length > MAX_KNOWLEDGE_FILE_BYTES) {
      ignorados.push(`${rel} (maior que 10 MB)`);
      continue;
    }
    files.push({ path: rel, content });
  }
  if (!files.length) throw new BadRequestException('Nenhum arquivo válido para importar');
  return { files, ignorados };
}

/** Entrega um arquivo de conhecimento ao navegador sem permitir que ele execute nada (sandbox). */
export function sendKnowledgeFile(res: { setHeader(k: string, v: string): void; type(t: string): void; send(b: Buffer): void }, rel: string, content: Buffer): void {
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const midia: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav' };
  const ext = (/\.([a-z0-9]+)$/i.exec(rel)?.[1] ?? '').toLowerCase();
  res.type(/^(md|txt|csv|json|py|ts|tsx|js|jsx|html|css|svg|yml|yaml|sql|sh)$/.test(ext) ? 'text/plain; charset=utf-8' : midia[ext] ?? 'application/octet-stream');
  res.send(content);
}

/**
 * Tudo que entra como material ou conhecimento fica guardado como TEXTO, que qualquer IA lê bem:
 * PDF (inclusive escaneado, por OCR), Word, Excel, PowerPoint e LibreOffice viram `<nome>.txt` e o
 * original NÃO é guardado. Se a conversão falhar, o arquivo não entra e o motivo volta em `recusados`.
 * Arquivos de texto, código e imagens entram como estão.
 */
export async function toTextFiles(
  files: Array<{ path: string; content: Buffer }>,
): Promise<{ files: Array<{ path: string; content: Buffer }>; convertidos: Array<{ de: string; para: string }>; recusados: string[] }> {
  const out: Array<{ path: string; content: Buffer }> = [];
  const convertidos: Array<{ de: string; para: string }> = [];
  const recusados: string[] = [];
  const usados = new Set(files.filter((f) => !isDocument(f.path) && !isLegacyDocument(f.path)).map((f) => f.path.toLowerCase()));
  for (const f of files) {
    if (!isDocument(f.path) && !isLegacyDocument(f.path)) {
      out.push(f);
      continue;
    }
    try {
      const texto = await extractText(f.path, f.content);
      if (!texto.trim()) {
        recusados.push(`${f.path} (sem texto legível)`);
        continue;
      }
      const para = textName(f.path, usados);
      usados.add(para.toLowerCase());
      out.push({ path: para, content: Buffer.from(`${texto}\n`, 'utf8') });
      convertidos.push({ de: f.path, para });
    } catch (e: any) {
      recusados.push(`${f.path} (${e?.message ?? 'não foi possível ler'})`);
    }
  }
  return { files: out, convertidos, recusados };
}

/** manual.pdf → manual.txt; se já existir manual.txt no envio, manual.pdf.txt. */
export function textName(rel: string, usados: Set<string>): string {
  const semExt = rel.replace(/\.[^./]+$/, '');
  const simples = `${semExt}.txt`;
  return usados.has(simples.toLowerCase()) ? `${rel}.txt` : simples;
}

/**
 * Converte em texto os documentos já guardados numa pasta de materiais/conhecimento (de antes desta
 * regra): grava `<nome>.txt`, remove o original (e a antiga cópia `<nome>.pdf.txt`) num único commit.
 * O original continua no histórico do git. Documento que não converte fica como está.
 */
export async function convertStoredDocuments(
  dir: string,
  ws: { listKnowledge(d: string): Array<{ path: string }>; readKnowledge(d: string, rel: string): Buffer | null; writeKnowledge(d: string, f: Array<{ path: string; content: Buffer | null }>, a: string, m: string): Promise<string | null> },
): Promise<{ convertidos: number; falhas: string[] }> {
  const todos = ws.listKnowledge(dir).map((f) => f.path);
  const docs = todos.filter((p) => isDocument(p));
  if (!docs.length) return { convertidos: 0, falhas: [] };
  const usados = new Set(todos.filter((p) => !isDocument(p)).map((p) => p.toLowerCase()));
  const mudancas: Array<{ path: string; content: Buffer | null }> = [];
  const falhas: string[] = [];
  for (const rel of docs) {
    const content = ws.readKnowledge(dir, rel);
    if (!content) continue;
    try {
      const texto = await extractText(rel, content);
      if (!texto.trim()) throw new Error('sem texto legível');
      const copiaAntiga = `${rel}.txt`;
      const simples = `${rel.replace(/\.[^./]+$/, '')}.txt`;
      // A cópia antiga ao lado (manual.pdf.txt) dá lugar ao nome simples, se ele estiver livre.
      if (usados.has(copiaAntiga.toLowerCase()) && !usados.has(simples.toLowerCase())) {
        usados.delete(copiaAntiga.toLowerCase());
        mudancas.push({ path: copiaAntiga, content: null });
      }
      const para = textName(rel, usados);
      usados.add(para.toLowerCase());
      mudancas.push({ path: para, content: Buffer.from(`${texto}\n`, 'utf8') }, { path: rel, content: null });
    } catch (e: any) {
      falhas.push(`${rel}: ${e?.message ?? e}`);
    }
  }
  const convertidos = mudancas.filter((m) => m.content === null && docs.includes(m.path)).length;
  if (convertidos) await ws.writeKnowledge(dir, mudancas, 'nivoo', `converte ${convertidos} documento(s) em texto`);
  return { convertidos, falhas };
}
