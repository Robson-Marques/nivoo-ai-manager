import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from './exec';

const DOCX_TO_TEXT = `
import re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    xml = z.read('word/document.xml').decode('utf8')
xml = re.sub(r'</w:p>', '\\n', xml)
xml = re.sub(r'<w:tab/>', '\\t', xml)
txt = re.sub(r'<[^>]+>', '', xml)
for a, b in (('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'), ('&apos;', "'"), ('&amp;', '&')):
    txt = txt.replace(a, b)
sys.stdout.write(txt)
`;

/** Tipos que viram texto: PDF (pdftotext), Word .docx e arquivos de texto. */
export function canExtractText(name: string): boolean {
  return /\.(pdf|docx|txt|md|csv|json|html?|xml|ya?ml)$/i.test(name);
}

/**
 * Converte um documento em texto puro (para colar nas regras de um modelo/projeto ou para a IA ler).
 * Usa o pdftotext do sistema (pacote poppler-utils) e python3 para .docx; nada sai do servidor.
 */
export async function extractText(name: string, content: Buffer): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  if (!['.pdf', '.docx'].includes(ext)) {
    if (!canExtractText(name)) throw new BadRequestException('Formato não suportado: envie PDF, Word (.docx) ou arquivo de texto');
    return content.toString('utf8');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-texto-'));
  try {
    const file = path.join(dir, `arquivo${ext}`);
    fs.writeFileSync(file, content);
    const r =
      ext === '.pdf'
        ? await runProcess('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { cwd: dir, env: minimalEnv(), timeoutMs: 60_000 })
        : await runProcess('python3', ['-I', '-c', DOCX_TO_TEXT, file], { cwd: dir, env: minimalEnv(), timeoutMs: 60_000 });
    if (r.spawnError) throw new BadRequestException(ext === '.pdf' ? 'Leitor de PDF ausente no servidor (instale poppler-utils)' : 'python3 ausente no servidor');
    if (r.exitCode !== 0) throw new BadRequestException(`Não foi possível ler o arquivo: ${r.stderr.trim().slice(0, 200)}`);
    return r.stdout.replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
