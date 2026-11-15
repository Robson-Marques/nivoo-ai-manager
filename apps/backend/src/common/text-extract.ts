import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from './exec';

/**
 * Documentos de escritório (Office e LibreOffice) lidos direto do pacote zip/XML, sem programas extras:
 * Word (.docx), PowerPoint (.pptx), Excel (.xlsx), Writer (.odt), Impress (.odp), Calc (.ods).
 */
const OFFICE_TO_TEXT = String.raw`
import re, sys, zipfile
import xml.etree.ElementTree as ET
arq, ext = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(arq)
_fromstring = ET.fromstring
def _tolerante(b):
    # XML fora do padrão (prefixo sem declaração, comum em arquivos gerados por outros programas):
    # declara os prefixos usados e tenta de novo.
    try:
        return _fromstring(b)
    except ET.ParseError:
        t = b.decode('utf8', 'replace') if isinstance(b, bytes) else b
        prefixos = sorted(set(re.findall(r'<\/?([A-Za-z_][\w.-]*):', t)) - set(re.findall(r'xmlns:([\w.-]+)=', t)))
        decl = ''.join(' xmlns:%s="urn:x-%s"' % (p, p) for p in prefixos)
        return _fromstring(re.sub(r'^(\s*(?:<\?xml[^>]*\?>\s*)?<[\w:.-]+)', lambda m: m.group(1) + decl, t, count=1))
ET.fromstring = _tolerante
def local(t): return t.rsplit('}', 1)[-1]
def textos(el, para, tab=None, quebra=()):
    linhas, atual = [], []
    def anda(e):
        n = local(e.tag)
        if n in quebra: atual.append('\n')
        if tab and n == tab: atual.append('\t')
        if e.text and n in ('t', 'p', 'span', 'h', 's', 'a'): atual.append(e.text)
        for f in e: anda(f)
        if n == para:
            linhas.append(''.join(atual)); atual.clear()
        elif e.tail and n in ('span', 'a', 's', 'tab', 'line-break'): atual.append(e.tail)
    anda(el)
    if atual: linhas.append(''.join(atual))
    return '\n'.join(linhas)
def num(nome): return int(re.findall(r'(\d+)', nome)[-1])
saida = []
if ext == '.docx':
    for parte in ['word/document.xml'] + sorted(n for n in z.namelist() if re.match(r'word/(footnotes|endnotes)\.xml$', n)):
        if parte in z.namelist():
            saida.append(textos(ET.fromstring(z.read(parte)), 'p', tab='tab', quebra=('br',)))
elif ext == '.pptx':
    slides = sorted((n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)), key=num)
    for i, s in enumerate(slides, 1):
        saida.append('--- Slide %d ---\n' % i + textos(ET.fromstring(z.read(s)), 'p'))
elif ext == '.xlsx':
    comp = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
            comp.append(''.join(t.text or '' for t in si.iter() if local(t.tag) == 't'))
    nomes = []
    if 'xl/workbook.xml' in z.namelist():
        nomes = [s.get('name') for s in ET.fromstring(z.read('xl/workbook.xml')).iter() if local(s.tag) == 'sheet']
    planilhas = sorted((n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n)), key=num)
    for i, p in enumerate(planilhas):
        linhas = []
        for row in ET.fromstring(z.read(p)).iter():
            if local(row.tag) != 'row': continue
            cels = []
            for c in row:
                if local(c.tag) != 'c': continue
                v = ''
                for f in c.iter():
                    if local(f.tag) == 'v': v = f.text or ''
                    elif local(f.tag) == 't' and c.get('t') == 'inlineStr': v += f.text or ''
                if c.get('t') == 's' and v.isdigit() and int(v) < len(comp): v = comp[int(v)]
                cels.append(v)
            if any(x.strip() for x in cels): linhas.append('\t'.join(cels))
        titulo = nomes[i] if i < len(nomes) else 'Planilha %d' % (i + 1)
        saida.append('--- %s ---\n' % titulo + '\n'.join(linhas))
else:
    raiz = ET.fromstring(z.read('content.xml'))
    if ext == '.ods':
        for tab in raiz.iter():
            if local(tab.tag) != 'table': continue
            linhas = []
            for row in tab.iter():
                if local(row.tag) != 'table-row': continue
                cels = ['\n'.join(textos(c, 'p').splitlines()) for c in row if local(c.tag) == 'table-cell']
                if any(x.strip() for x in cels): linhas.append('\t'.join(cels))
            saida.append('--- %s ---\n' % tab.get('{urn:oasis:names:tc:opendocument:xmlns:table:1.0}name', '') + '\n'.join(linhas))
    else:
        saida.append(textos(raiz, 'p', tab='tab', quebra=('line-break',)))
sys.stdout.write('\n\n'.join(saida))
`;

const OFFICE = ['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods'];
/** Documentos que são convertidos em texto ao entrar no sistema (o original não é guardado). */
const DOCUMENT_EXT = ['.pdf', ...OFFICE];
/** Formatos antigos sem leitor confiável: pedimos para salvar no formato novo ou em PDF. */
const LEGACY = ['.doc', '.ppt', '.xls', '.rtf', '.pages', '.key', '.numbers'];
const PLAIN = /\.(txt|md|markdown|csv|tsv|json|html?|xml|ya?ml|ini|toml|log|sql|py|ts|tsx|js|jsx|css|sh)$/i;
const MAX_OCR_PAGES = 200;

export function isDocument(name: string): boolean {
  return DOCUMENT_EXT.includes(path.extname(name).toLowerCase());
}

export function isLegacyDocument(name: string): boolean {
  return LEGACY.includes(path.extname(name).toLowerCase());
}

/** Tipos que viram texto: PDF, Office/LibreOffice e arquivos de texto. */
export function canExtractText(name: string): boolean {
  return isDocument(name) || PLAIN.test(name);
}

const limpar = (t: string) =>
  t.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** PDF digitalizado (só imagem): lê as páginas com OCR (tesseract, português + inglês). */
async function ocrPdf(file: string, dir: string): Promise<string> {
  const img = await runProcess('pdftoppm', ['-r', '200', '-gray', '-png', '-l', String(MAX_OCR_PAGES), file, path.join(dir, 'pag')], {
    cwd: dir,
    env: minimalEnv(),
    timeoutMs: 600_000,
  });
  if (img.spawnError || img.exitCode !== 0) return '';
  const paginas = fs.readdirSync(dir).filter((f) => /^pag-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const partes: string[] = [];
  for (const p of paginas) {
    const r = await runProcess('tesseract', [path.join(dir, p), '-', '-l', 'por+eng'], { cwd: dir, env: minimalEnv(), timeoutMs: 120_000 });
    if (r.spawnError) throw new BadRequestException('Este PDF é digitalizado (imagem). Para ler o texto, instale o OCR no servidor: apt install tesseract-ocr tesseract-ocr-por');
    if (r.exitCode === 0) partes.push(r.stdout);
  }
  return partes.join('\n\n');
}

/**
 * Converte um documento em texto puro. PDF: pdftotext (poppler-utils); se o PDF for só imagem, OCR
 * (tesseract). Office/LibreOffice: python3 lendo o XML do arquivo. Nada sai do servidor.
 */
export async function extractText(name: string, content: Buffer): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  if (isLegacyDocument(name)) throw new BadRequestException(`Formato antigo (${ext}): salve como PDF ou no formato novo (.docx, .xlsx, .pptx) e envie de novo`);
  if (!isDocument(name)) {
    if (!canExtractText(name)) throw new BadRequestException('Formato não suportado: envie PDF, Word, Excel, PowerPoint, LibreOffice ou arquivo de texto');
    return content.toString('utf8');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-texto-'));
  try {
    const file = path.join(dir, `arquivo${ext}`);
    fs.writeFileSync(file, content);
    if (ext === '.pdf') {
      const r = await runProcess('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { cwd: dir, env: minimalEnv(), timeoutMs: 120_000 });
      if (r.spawnError) throw new BadRequestException('Leitor de PDF ausente no servidor (instale poppler-utils)');
      if (r.exitCode !== 0) throw new BadRequestException(`Não foi possível ler o PDF: ${r.stderr.trim().slice(0, 200)}`);
      const texto = limpar(r.stdout);
      // PDF escaneado (praticamente sem camada de texto): lê por OCR. PDF com texto, mesmo curto, fica com o
      // texto exato do pdftotext — OCR só "adivinha" letras e não pode substituir texto real.
      const paginas = Math.max(1, (r.stdout.match(/\f/g) ?? []).length);
      if (texto.replace(/\s/g, '').length >= 5 * paginas) return texto;
      const ocr = limpar(await ocrPdf(file, dir));
      return ocr.replace(/\s/g, '').length > texto.replace(/\s/g, '').length ? ocr : texto;
    }
    const r = await runProcess('python3', ['-I', '-c', OFFICE_TO_TEXT, file, ext], { cwd: dir, env: minimalEnv(), timeoutMs: 120_000 });
    if (r.spawnError) throw new BadRequestException('python3 ausente no servidor');
    if (r.exitCode !== 0) throw new BadRequestException(`Não foi possível ler o arquivo (está corrompido ou protegido por senha?)`);
    return limpar(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
