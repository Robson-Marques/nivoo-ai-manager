/**
 * Tudo que entra como material do modelo ou conhecimento do projeto fica guardado como TEXTO:
 * PDF (inclusive escaneado, por OCR), Word, PowerPoint, Excel e LibreOffice viram `<nome>.txt` e o
 * original não é guardado. Formatos antigos e arquivos ilegíveis são recusados com o motivo.
 * Documentos guardados antes desta regra são convertidos pela atualização (seed).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { convertStoredDocuments } from '../../src/common/knowledge-upload';
import { WorkspaceService } from '../../src/storage/workspace.service';
import { createHarness, createProject, Harness, truncateAll } from '../support/harness';

const temOcr = spawnSync('tesseract', ['--version']).status === 0;

describe('Documentos importados viram texto', () => {
  let h: Harness;
  let docs: string;
  const b64 = (f: string) => fs.readFileSync(path.join(docs, f)).toString('base64');
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    docs = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));
    execFileSync('python3', [path.join(__dirname, '..', 'support', 'documentos.py'), docs]);
  });
  afterAll(async () => {
    await h.close();
    fs.rmSync(docs, { recursive: true, force: true });
  });

  it('conhecimento do projeto: Office e LibreOffice entram só como texto; antigos e quebrados são recusados com motivo', async () => {
    const p = await createProject(h, 'documentos');
    const nomes = ['contrato.docx', 'apresentacao.pptx', 'precos.xlsx', 'ata.odt', 'estoque.ods', 'antigo.doc', 'quebrado.docx'];
    const r = (
      await h.http().post(`/api/projects/${p.id}/knowledge/import`).send({
        files: [...nomes.map((n) => ({ path: `docs/${n}`, contentBase64: b64(n) })), { path: 'docs/contrato.txt', contentBase64: Buffer.from('já existia').toString('base64') }],
      }).expect(201)
    ).body;
    expect(r.convertidos).toEqual([
      { de: 'docs/contrato.docx', para: 'docs/contrato.docx.txt' }, // docs/contrato.txt já vinha no envio: não sobrescreve
      { de: 'docs/apresentacao.pptx', para: 'docs/apresentacao.txt' },
      { de: 'docs/precos.xlsx', para: 'docs/precos.txt' },
      { de: 'docs/ata.odt', para: 'docs/ata.txt' },
      { de: 'docs/estoque.ods', para: 'docs/estoque.txt' },
    ]);
    expect(r.ignorados).toHaveLength(2);
    expect(r.ignorados[0]).toMatch(/^docs\/antigo\.doc \(Formato antigo \(\.doc\): salve como PDF/);
    expect(r.ignorados[1]).toMatch(/^docs\/quebrado\.docx \(Não foi possível ler/);
    const det = (await h.http().get(`/api/projects/${p.id}`)).body;
    expect(det.knowledgeFiles.map((f: any) => f.path)).toEqual([
      'docs/apresentacao.txt', 'docs/ata.txt', 'docs/contrato.docx.txt', 'docs/contrato.txt', 'docs/estoque.txt', 'docs/precos.txt',
    ]);
    const ler = async (f: string) => (await h.http().get(`/api/projects/${p.id}/knowledge/file`).query({ path: f }).expect(200)).text;
    expect(await ler('docs/contrato.docx.txt')).toBe('Cláusula 1\tPrazo DOCX-11\nSegunda linha\n');
    expect(await ler('docs/apresentacao.txt')).toBe('--- Slide 1 ---\nVisão PPTX-21\n\n--- Slide 2 ---\nMeio PPTX-22\n\n--- Slide 3 ---\nFim PPTX-29\n');
    expect(await ler('docs/precos.txt')).toBe('--- Tabela ---\nProduto\tPreço\nMargherita XLSX-31\t45.5\n');
    expect(await ler('docs/ata.txt')).toBe('Ata ODT-41 reunião\n');
    expect(await ler('docs/estoque.txt')).toBe('--- Estoque ---\nFarinha ODS-51\t12\n');
    // Só documentos ilegíveis: nada é gravado, e a resposta explica por quê.
    const nada = (await h.http().post(`/api/projects/${p.id}/knowledge/import`).send({ files: [{ path: 'velho.doc', contentBase64: b64('antigo.doc') }] }).expect(201)).body;
    expect(nada.importados).toBe(0);
    expect(nada.commit).toBeNull();
    expect(nada.ignorados[0]).toMatch(/Formato antigo/);
  });

  (temOcr ? it : it.skip)('PDF escaneado (só imagem) é lido por OCR e guardado como texto', async () => {
    const m = (await h.http().post('/api/areas').send({ name: 'Jurídico', template: 'geral' }).expect(201)).body;
    const r = (await h.http().post(`/api/areas/${m.slug}/base/import`).send({ files: [{ path: 'escaneado.pdf', contentBase64: b64('escaneado.pdf') }] }).expect(201)).body;
    expect(r.convertidos).toEqual([{ de: 'escaneado.pdf', para: 'escaneado.txt' }]);
    const t = (await h.http().get(`/api/areas/${m.slug}/base/file`).query({ path: 'escaneado.txt' }).expect(200)).text;
    expect(t).toContain('CONTRATO ESCANEADO 4321');
    // Também ao importar as regras de um PDF escaneado.
    const x = (await h.http().post('/api/extract-text').send({ name: 'regras.pdf', contentBase64: b64('escaneado.pdf') }).expect(201)).body;
    expect(x.texto).toContain('ESCANEADO 4321');
  });

  it('documentos guardados antes da regra são convertidos na atualização (original some, cópia antiga ".pdf.txt" vira o nome simples)', async () => {
    const ws = h.app.get(WorkspaceService);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conhecimento-antigo-'));
    await ws.writeKnowledge(
      dir,
      [
        { path: 'manual.docx', content: fs.readFileSync(path.join(docs, 'contrato.docx')) },
        { path: 'manual.docx.txt', content: Buffer.from('cópia antiga') },
        { path: 'tabela.xlsx', content: fs.readFileSync(path.join(docs, 'precos.xlsx')) },
        { path: 'quebrado.docx', content: fs.readFileSync(path.join(docs, 'quebrado.docx')) },
        { path: 'notas.md', content: Buffer.from('# notas') },
      ],
      'teste',
      'conteúdo antigo',
    );
    const r = await convertStoredDocuments(dir, ws);
    expect(r.convertidos).toBe(2);
    expect(r.falhas).toHaveLength(1);
    expect(ws.listKnowledge(dir).map((f) => f.path)).toEqual(['manual.txt', 'notas.md', 'quebrado.docx', 'tabela.txt']);
    expect(fs.readFileSync(path.join(dir, 'manual.txt'), 'utf8')).toContain('DOCX-11');
    const log = execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString();
    expect(log.split('\n')[0]).toBe('converte 2 documento(s) em texto');
    // Idempotente: rodar de novo não muda nada além do que não converte.
    expect((await convertStoredDocuments(dir, ws)).convertidos).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
