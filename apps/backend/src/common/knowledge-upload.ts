import { BadRequestException } from '@nestjs/common';
import { extractText } from './text-extract';

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
  res.type(/\.(md|txt|csv|json|py|ts|tsx|js|jsx|html|css|svg|yml|yaml|sql|sh)$/i.test(rel) ? 'text/plain; charset=utf-8' : 'application/octet-stream');
  res.send(content);
}

/**
 * PDF e Word ganham uma cópia em texto ao lado (ex.: manual.pdf → manual.pdf.txt), para que qualquer IA
 * consiga ler o conteúdo. Se a conversão falhar, o arquivo original entra mesmo assim.
 */
export async function withTextCopies(files: Array<{ path: string; content: Buffer }>): Promise<Array<{ path: string; content: Buffer }>> {
  const out = [...files];
  for (const f of files) {
    if (!/\.(pdf|docx)$/i.test(f.path)) continue;
    try {
      const text = await extractText(f.path, f.content);
      if (text) out.push({ path: `${f.path}.txt`, content: Buffer.from(text, 'utf8') });
    } catch {
      /* sem cópia em texto; o original continua disponível */
    }
  }
  return out;
}
