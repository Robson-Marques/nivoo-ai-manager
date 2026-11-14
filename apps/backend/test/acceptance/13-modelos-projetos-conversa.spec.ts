/**
 * Modelos (regras em texto + materiais), "fine-tune do projeto" (regras próprias, conhecimento, IA escolhida),
 * pasta principal que acumula o trabalho, conferência independente das regras (a trava), conversa com
 * memória automática e contas de IA conectadas pela tela. Sem IA real: executor local e o stub TEST-ONLY
 * do Claude (registra o prompt e os argumentos recebidos). Prova com IA real: test/integration/real-06.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appConfig } from '../../src/config';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const lido = (name: string) => fs.readFileSync(path.join(CTL, name), 'utf8');
const b64 = (t: string | Buffer) => Buffer.from(t).toString('base64');
const ok = [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }];

/** PDF mínimo válido com uma linha de texto (para testar a extração). */
function pdfCom(texto: string): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 14 Tf 10 50 Td (${texto}) Tj ET`.length} >>\nstream\nBT /F1 14 Tf 10 50 Td (${texto}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('Modelos, fine-tune do projeto, conferência das regras, conversa e contas', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
  });

  const modelo = async (name: string, template = 'geral', instructions?: string) =>
    (await h.http().post('/api/areas').send({ name, template, instructions }).expect(201)).body;
  const projeto = async (name: string, base: string, extra: any = {}) =>
    (await h.http().post('/api/projects').send({ name, base, description: `projeto ${name}`, ...extra }).expect(201)).body;
  const job = async (pid: string, body: any) => {
    const j = (await h.http().post(`/api/projects/${pid}/jobs`).send({ objective: 'o', criteria: ok, ...body }).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/start`).expect(201);
    return j;
  };
  const ate = (pid: string, jid: string, estados = ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'], ms = 30000) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${jid}`)).body;
      return estados.includes(x.status) ? x : null;
    }, ms);
  const resposta = (pid: string, cid: string, n: number) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body;
      const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
      return r.length >= n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
    });

  it('modelos: prontos sem Mercado; texto de funcionamento exato e versionado; nome editável', async () => {
    const prontos = (await h.http().get('/api/areas/templates').expect(200)).body.map((t: any) => t.key);
    expect(prontos).toEqual(['geral', 'software', 'atendimento', 'imagem', 'video']);
    expect((await h.http().get('/api/areas').expect(200)).body.map((a: any) => a.slug)).toEqual(['geral']); // padrão
    const texto = 'Você é engenheiro de sistemas ERP. Código de rastreio MOD-ERP-11. Nunca use JSON na interface.';
    const m = await modelo('Sistemas ERP / SaaS', 'software', texto);
    expect(m.slug).toBe('sistemas-erp-saas');
    expect(m.currentInstruction.text).toBe(texto); // o que o usuário escreveu vale exatamente
    expect(m.baseFiles.map((f: any) => f.path)).toEqual(expect.arrayContaining(['README.md', 'padroes-de-codigo.md']));
    await h.http().post('/api/areas').send({ name: 'Sistemas ERP / SaaS' }).expect(409);
    const v2 = (await h.http().post(`/api/areas/${m.slug}/instructions`).send({ text: `${texto}\nTambém: documentação sempre.` }).expect(201)).body;
    expect(v2.instructions.map((i: any) => i.version)).toEqual([1, 2]);
    expect(v2.instructions[0].text).toBe(texto); // v1 intacta
    const renomeado = (await h.http().patch(`/api/areas/${m.slug}`).send({ name: 'ERP e SaaS', description: 'Sistemas de gestão' }).expect(200)).body;
    expect(renomeado.name).toBe('ERP e SaaS');
  });

  it('materiais do modelo: pasta inteira num commit, PDF/Word viram texto, nada fora da pasta', async () => {
    const m = await modelo('Studio');
    const docx = execFileSync('python3', ['-c', `
import io, sys, zipfile
b = io.BytesIO()
with zipfile.ZipFile(b, 'w') as z:
    z.writestr('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Paleta laranja DOCX-77</w:t></w:r></w:p></w:body></w:document>')
sys.stdout.buffer.write(b.getvalue())`]);
    const r = (
      await h.http().post(`/api/areas/${m.slug}/base/import`).send({
        files: [
          { path: 'README.md', contentBase64: b64('# Studio\nFluxo STUDIO-FLUXO-42') },
          { path: '.claude/agents/arquiteto.md', contentBase64: b64('agente arquiteto') },
          { path: 'CLAUDE.md', contentBase64: b64('regras do studio') },
          { path: 'manual.pdf', contentBase64: b64(pdfCom('Manual PDF-55')) },
          { path: 'identidade.docx', contentBase64: b64(docx) },
          { path: 'node_modules/x/a.js', contentBase64: b64('lixo') },
          { path: 'grande.txt', contentBase64: b64('x'.repeat(3 * 1024 * 1024)) }, // > 100 KB: exige o limite de corpo
        ],
      }).expect(201)
    ).body;
    expect(r.importados).toBe(8); // 6 arquivos + 2 cópias em texto
    expect(r.ignorados).toEqual(['node_modules/x/a.js']);
    const det = (await h.http().get(`/api/areas/${m.slug}`)).body;
    expect(det.baseHistory[0].message).toMatch(/importa 8 arquivo/);
    expect((await h.http().get(`/api/areas/${m.slug}/base/file`).query({ path: 'manual.pdf.txt' }).expect(200)).text).toContain('Manual PDF-55');
    expect((await h.http().get(`/api/areas/${m.slug}/base/file`).query({ path: 'identidade.docx.txt' }).expect(200)).text).toContain('DOCX-77');
    await h.http().post(`/api/areas/${m.slug}/base/import`).send({ files: [{ path: '../fora.md', contentBase64: b64('x') }] }).expect(400);
    await h.http().delete(`/api/areas/${m.slug}/base/file`).query({ path: 'grande.txt' }).expect(200);
    expect((await h.http().get(`/api/areas/${m.slug}`)).body.baseFiles.some((f: any) => f.path === 'grande.txt')).toBe(false);
    // Converter um documento em texto (para colar nas regras), sem gravar nada.
    const t = (await h.http().post('/api/extract-text').send({ name: 'regras.pdf', contentBase64: b64(pdfCom('Regra do PDF RX-9')) }).expect(201)).body;
    expect(t.texto).toContain('Regra do PDF RX-9');
    await h.http().post('/api/extract-text').send({ name: 'foto.png', contentBase64: b64('x') }).expect(400);
  });

  it('projeto: modelo, IA escolhida, regras próprias versionadas, conhecimento e limite de gasto', async () => {
    const m = await modelo('Atendimento Pizzaria', 'atendimento');
    const p = await projeto('Pizzaria do Zé', m.slug, { provider: 'claude-code-cli', rules: 'Só fale de pizzas. Código REGRA-PZ-1.' });
    expect(p.dirKey).toBe(`areas/${m.slug}/projetos/pizzaria-do-ze`);
    expect(p.provider).toBe('claude-code-cli');
    expect(p.rules.version).toBe(1);
    expect(p.rules.text).toContain('REGRA-PZ-1');
    await h.http().post('/api/projects').send({ name: 'Outra', provider: 'anthropic-api' }).expect(400); // só agentes que editam arquivos
    await h.http().post('/api/projects').send({ name: 'Mesmo nome', base: 'inexistente' }).expect(404);
    const v2 = (await h.http().post(`/api/projects/${p.id}/rules`).send({ text: 'Só fale de pizzas e bebidas. Código REGRA-PZ-2.' }).expect(201)).body;
    expect(v2.rules.version).toBe(2);
    expect((await h.http().get(`/api/projects/${p.id}/rules/history`)).body.map((r: any) => r.version)).toEqual([2, 1]);
    const k = (await h.http().post(`/api/projects/${p.id}/knowledge/import`).send({ files: [{ path: 'cardapio.pdf', contentBase64: b64(pdfCom('Margherita R 45')) }] }).expect(201)).body;
    expect(k.importados).toBe(2);
    const det = (await h.http().get(`/api/projects/${p.id}`)).body;
    expect(det.knowledgeFiles.map((f: any) => f.path)).toEqual(['cardapio.pdf', 'cardapio.pdf.txt']);
    expect((await h.http().get(`/api/projects/${p.id}/knowledge/file`).query({ path: 'cardapio.pdf.txt' }).expect(200)).text).toContain('Margherita');
    await h.http().delete(`/api/projects/${p.id}/knowledge/file`).query({ path: 'cardapio.pdf' }).expect(200);
    const ajustado = (await h.http().patch(`/api/projects/${p.id}`).send({ provider: 'gemini-cli', maxCostUsd: 7 }).expect(200)).body;
    expect(ajustado.provider).toBe('gemini-cli');
    expect(Number(ajustado.maxCostUsd)).toBe(7);
    await h.http().patch(`/api/projects/${p.id}`).send({ provider: 'local-shell' }).expect(400);
  });

  it('a pasta principal acumula o trabalho: o job seguinte enxerga o que o anterior criou', async () => {
    const p = await projeto('Estrutura', 'geral');
    const j1 = await job(p.id, {
      title: 'cria estrutura',
      steps: [{ key: 's', instructions: 'mkdir -p estrutura docs && echo "# Estrutura v1" > estrutura/README.md && echo nota > docs/a.md' }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: 'estrutura/README.md' } }],
    });
    const d1 = await ate(p.id, j1.id);
    expect(d1.status).toBe('CONCLUIDO');
    expect(d1.mergeStatus).toBe('INCORPORADO');
    expect(d1.steps.map((s: any) => s.key)).toEqual(['s']); // sem IA: sem conferência de regras
    const files = (await h.http().get(`/api/projects/${p.id}/files`).expect(200)).body.arquivos.map((f: any) => f.path);
    expect(files).toEqual(expect.arrayContaining(['estrutura/README.md', 'docs/a.md']));
    const j2 = await job(p.id, {
      title: 'continua a estrutura',
      steps: [{ key: 's', instructions: 'grep -q "Estrutura v1" estrutura/README.md && echo "## v2" >> estrutura/README.md' }],
      criteria: [{ key: 'v2', description: 'v2', kind: 'COMMAND', config: { command: 'grep -q "## v2" estrutura/README.md' } }],
    });
    expect((await ate(p.id, j2.id)).status).toBe('CONCLUIDO');
    const conteudo = (await h.http().get(`/api/projects/${p.id}/files/content`).query({ path: 'estrutura/README.md' }).expect(200)).text;
    expect(conteudo).toBe('# Estrutura v1\n## v2\n');
    await h.http().get(`/api/projects/${p.id}/files/content`).query({ path: '../../etc/passwd' }).expect(404);
  });

  it('conflito ao integrar: o job não é dado como concluído e a pendência fica registrada', async () => {
    const p = await projeto('Concorrentes', 'geral');
    const A = await job(p.id, { title: 'A', steps: [{ key: 's', instructions: 'sleep 1; echo A > conflito.txt' }] });
    const B = await job(p.id, { title: 'B', steps: [{ key: 's', instructions: 'echo B > conflito.txt' }] });
    const fa = await ate(p.id, A.id);
    const fb = await ate(p.id, B.id);
    expect(fa.status).toBe('CONCLUIDO');
    expect(fb.status).toBe('BLOQUEADO');
    expect(fb.blockedReason).toBe('CONFLITO_INCORPORACAO');
    expect(fb.statusDetail).toContain('conflito.txt');
    const repo = path.join(p.workspacePath, 'repo');
    expect(fs.readFileSync(path.join(repo, 'conflito.txt'), 'utf8')).toBe('A\n');
    const pend = (await h.http().get(`/api/projects/${p.id}/memory?category=PENDENCIA`)).body;
    expect(pend.some((m: any) => m.references?.origem === 'conflito-incorporacao' && m.references.jobId === B.id)).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString()).toBe('');
  });

  it('fine-tune do projeto: toda sessão de IA recebe regras do modelo e do projeto, conhecimento e materiais (e nada de outro modelo)', async () => {
    const m = await modelo('Arte de Pizzaria', 'imagem', 'Diretor de arte de pizzarias. Código MOD-SESSAO-31.');
    await h.http().post(`/api/areas/${m.slug}/base/import`).send({ files: [{ path: 'marca.md', contentBase64: b64('Vermelho tomate. BASE-SESSAO-58.') }, { path: 'CLAUDE.md', contentBase64: b64('padrão do estúdio') }] }).expect(201);
    const outro = await modelo('Outro Modelo');
    await h.http().post(`/api/areas/${outro.slug}/base/import`).send({ files: [{ path: 'segredo-do-outro.md', contentBase64: b64('NAO-DEVE-VAZAR') }] }).expect(201);
    const p = await projeto('Cardápio', m.slug, { rules: 'Nunca invente preços. Código REGRA-SESSAO-7.' });
    await h.http().post(`/api/projects/${p.id}/knowledge/import`).send({ files: [{ path: 'precos.md', contentBase64: b64('Margherita: R$ 45. CONH-SESSAO-3.') }] }).expect(201);
    ctl('mode', null);
    const j = await job(p.id, { title: 'arte', defaultProvider: 'claude-code-cli', steps: [{ key: 's', instructions: 'x', verifyCommand: 'test -f contexto/base/marca.md && test -f contexto/conhecimento/precos.md' }] });
    const d = await ate(p.id, j.id);
    expect(d.status).toBe('CONCLUIDO');
    // Trava: a conferência independente foi acrescentada e aprovada.
    expect(d.steps.map((s: any) => s.key)).toEqual(['s', 'conferencia-regras']);
    expect(d.criteria.find((c: any) => c.key === 'conferencia-regras').status).toBe('APROVADO');
    const revisor = lido('prompt-revisor.txt');
    expect(revisor).toContain('Mudanças feitas por este trabalho');
    expect(revisor).toContain('REGRA-SESSAO-7');
    const args = lido('args.txt');
    expect(args).toContain('--append-system-prompt'); // perfil também como instrução de sistema
    expect(args).toContain('REGRA-SESSAO-7');
    for (const codigo of ['MOD-SESSAO-31', 'REGRA-SESSAO-7', 'contexto/base/marca.md', 'contexto/base/_CLAUDE.md', 'contexto/conhecimento/precos.md']) {
      expect(revisor).toContain(codigo);
    }
    expect(revisor).not.toContain('segredo-do-outro');
    const wt = path.join(p.workspacePath, 'worktrees', j.id);
    expect(fs.readFileSync(path.join(wt, 'contexto', 'conhecimento', 'precos.md'), 'utf8')).toContain('CONH-SESSAO-3');
    expect(fs.existsSync(path.join(wt, 'contexto', 'base', '_CLAUDE.md'))).toBe(true); // legível, mas inerte
    expect(fs.existsSync(path.join(wt, 'contexto', 'base', 'CLAUDE.md'))).toBe(false);
    const tracked = execFileSync('git', ['ls-files'], { cwd: path.join(p.workspacePath, 'repo') }).toString();
    expect(tracked).not.toMatch(/^contexto\//m); // cópias de leitura nunca entram na pasta principal
  });

  it('trava: se a conferência apontar violação das regras, o trabalho NÃO fica pronto', async () => {
    const p = await projeto('Regras rígidas', 'geral', { rules: 'Toda página precisa de rodapé.' });
    ctl('mode', null);
    ctl('conforme', 'false');
    try {
      const j = await job(p.id, { title: 'página', defaultProvider: 'claude-code-cli', limits: { maxSessionsPerStep: 2 }, steps: [{ key: 's', instructions: 'x', verifyCommand: 'true' }] });
      const d = await ate(p.id, j.id, ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'], 40000);
      expect(d.status).not.toBe('CONCLUIDO');
      expect(d.steps.find((s: any) => s.key === 'conferencia-regras').status).not.toBe('CONCLUIDO');
      expect(d.mergeStatus).toBeNull(); // nada entrou na pasta principal
    } finally {
      ctl('conforme', null);
    }
    // A etapa de conferência é do sistema: não pode ser criada nem dispensada pela conversa.
    await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 't', objective: 'o', criteria: ok, defaultProvider: 'claude-code-cli', steps: [{ key: 'conferencia-regras', instructions: 'x', verifyCommand: 'true' }] }).expect(400);
  });

  it('conversa: plano com a IA do projeto; aprovação vira trabalho com conferência; recusa fora do escopo está no prompt', async () => {
    const p = await projeto('Landing', 'geral', { rules: 'Escopo: só a landing page. Código ESCOPO-LP-4.' });
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const plano = {
      tipo: 'plano',
      texto: 'Vou criar a página.',
      job: {
        title: 'Landing',
        objective: 'Criar index.html.',
        defaultProvider: 'local-shell', // ignorado: quem trabalha é a IA do projeto
        steps: [{ key: 'html', instructions: 'criar index.html', verifyCommand: 'test -f index.html' }],
        criteria: [{ key: 'arquivo', description: 'index existe', kind: 'FILE_EXISTS', config: { path: 'index.html' } }],
      },
      memoria: [{ tipo: 'PREFERENCIA', titulo: 'Cor', conteudo: 'Vermelho tomate.' }],
    };
    ctl('mode', 'texto');
    ctl('resposta.txt', `Analisei.\n\`\`\`json\n${JSON.stringify(plano)}\n\`\`\``);
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'Crie a landing' }).expect(201);
    const r1 = await resposta(p.id, conv.id, 1);
    expect(r1.kind).toBe('plano');
    expect(r1.plan.defaultProvider).toBe('claude-code-cli');
    expect(r1.content).toMatch(/Guardei na memória do projeto: Cor/);
    const prompt = lido('prompt.txt');
    expect(prompt).toContain('ESCOPO-LP-4');
    expect(prompt).toMatch(/fora do escopo/);
    expect(lido('args.txt')).toContain('--append-system-prompt');
    const c2 = (await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages/${r1.id}/approve`).send({ decidedBy: 'Robson' }).expect(201)).body;
    const jobId = c2.messages.find((m: any) => m.id === r1.id).jobId;
    const j = (await h.http().get(`/api/projects/${p.id}/jobs/${jobId}`)).body;
    expect(j.steps.map((s: any) => s.key)).toEqual(['html', 'conferencia-regras']);
    await h.http().post(`/api/projects/${p.id}/jobs/${jobId}/interrupt`).send({ by: 'teste' });
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('memória da conversa: sem duplicar e pode ser esquecida', async () => {
    const p = await projeto('Memória', 'geral');
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const r = { tipo: 'resposta', texto: 'Anotado.', memoria: [{ tipo: 'DECISAO', titulo: 'Cor principal', conteudo: 'Vermelho tomate.' }, { tipo: 'PREFERENCIA', titulo: 'Fonte', texto: 'Bebas.' }] };
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify(r) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'cor vermelho tomate e fonte Bebas' }).expect(201);
    expect((await resposta(p.id, conv.id, 1)).content).toMatch(/Guardei na memória do projeto: Cor principal; Fonte/);
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'repetindo' }).expect(201);
    expect((await resposta(p.id, conv.id, 2)).content).not.toMatch(/Guardei/);
    expect(lido('prompt.txt')).toContain('Vermelho tomate'); // memória entra na conversa seguinte
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`)).body;
    const fonte = mem.find((m: any) => m.title === 'Fonte');
    await h.http().delete(`/api/projects/${p.id}/memory/${fonte.id}`).expect(200);
    const depois = (await h.http().get(`/api/projects/${p.id}/memory`)).body;
    expect(depois.some((m: any) => m.title === 'Fonte')).toBe(false);
    expect(depois.some((m: any) => m.title === 'Cor principal')).toBe(true);
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('conversa com a IA do projeto desconectada responde com orientação, sem travar', async () => {
    const p = await projeto('Sem IA', 'geral');
    await h.http().patch('/api/providers/claude-code-cli').send({ enabled: false }).expect(200);
    try {
      const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
      await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'oi' }).expect(201);
      const m = await resposta(p.id, conv.id, 1);
      expect(m.status).toBe('ERRO');
      expect(m.content).toMatch(/Contas de IA/);
    } finally {
      await h.http().patch('/api/providers/claude-code-cli').send({ enabled: true }).expect(200);
    }
  });

  it('várias conversas por projeto: título automático, arquivar, excluir; a memória do projeto vale em todas', async () => {
    const p = await projeto('Muitas conversas', 'geral');
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify({ tipo: 'resposta', texto: 'ok', memoria: [{ tipo: 'FATO', titulo: 'Cor', conteudo: 'Azul-marinho CONV-MEM-5.' }] }) + '\n```');
    const c1 = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    expect(c1.title).toBe('Nova conversa');
    await h.http().post(`/api/projects/${p.id}/conversations/${c1.id}/messages`).send({ content: 'A cor da marca é azul-marinho, guarde isso por favor' }).expect(201);
    await resposta(p.id, c1.id, 1);
    expect((await h.http().get(`/api/projects/${p.id}/conversations/${c1.id}`)).body.title).toBe('A cor da marca é azul-marinho, guarde isso por favor');

    // Conversa nova começa limpa, mas a memória do projeto chega nela.
    const c2 = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('resposta.txt', '```json\n' + JSON.stringify({ tipo: 'resposta', texto: 'ok', memoria: [] }) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${c2.id}/messages`).send({ content: 'qual é a cor?' }).expect(201);
    await resposta(p.id, c2.id, 1);
    const prompt = lido('prompt.txt');
    expect(prompt).toContain('CONV-MEM-5'); // memória do projeto
    expect(prompt).not.toContain('guarde isso por favor'); // histórico da outra conversa não vem junto

    // Arquivar: some da lista principal, aparece nas arquivadas, não aceita mensagem até desarquivar.
    await h.http().patch(`/api/projects/${p.id}/conversations/${c1.id}`).send({ archived: true, title: 'Marca' }).expect(200);
    expect((await h.http().get(`/api/projects/${p.id}/conversations`)).body.map((c: any) => c.id)).toEqual([c2.id]);
    const arq = (await h.http().get(`/api/projects/${p.id}/conversations?arquivadas=1`)).body;
    expect(arq.map((c: any) => [c.id, c.title])).toEqual([[c1.id, 'Marca']]);
    await h.http().post(`/api/projects/${p.id}/conversations/${c1.id}/messages`).send({ content: 'oi' }).expect(409);
    await h.http().patch(`/api/projects/${p.id}/conversations/${c1.id}`).send({ archived: false }).expect(200);

    // Excluir: mensagens somem; a memória do projeto continua.
    await h.http().delete(`/api/projects/${p.id}/conversations/${c1.id}`).expect(200);
    await h.http().get(`/api/projects/${p.id}/conversations/${c1.id}`).expect(404);
    expect((await h.http().get(`/api/projects/${p.id}/memory`)).body.some((m: any) => m.content.includes('CONV-MEM-5'))).toBe(true);

    // Projeto arquivado sai da lista principal e volta ao desarquivar.
    await h.http().patch(`/api/projects/${p.id}`).send({ archived: true }).expect(200);
    expect((await h.http().get('/api/projects')).body.some((x: any) => x.id === p.id)).toBe(false);
    expect((await h.http().get('/api/projects?arquivados=1')).body.map((x: any) => x.id)).toContain(p.id);
    await h.http().patch(`/api/projects/${p.id}`).send({ archived: false }).expect(200);
    expect((await h.http().get('/api/projects')).body.some((x: any) => x.id === p.id)).toBe(true);
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('limite de gasto do projeto vale também para a conversa', async () => {
    const p = await projeto('Com limite', 'geral');
    await h.http().patch(`/api/projects/${p.id}`).send({ maxCostUsd: 0 }).expect(200);
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'oi' }).expect(201);
    const m = await resposta(p.id, conv.id, 1);
    expect(m.status).toBe('ERRO');
    expect(m.content).toMatch(/limite de gasto/);
  });

  it('contas de IA: Claude, ChatGPT e Gemini; login pela tela com o fluxo oficial; chave guardada fora do banco', async () => {
    const contas = (await h.http().get('/api/accounts').expect(200)).body;
    expect(contas.map((c: any) => c.nome)).toEqual(['Claude', 'ChatGPT', 'Gemini']);

    // Login do Claude pela tela (CLI simulado: mostra o link, lê o código e devolve o token oficial).
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-')), 'claude');
    fs.writeFileSync(fake, `#!/usr/bin/env bash
if [ "$1" = setup-token ]; then
  printf 'Use the url below to sign in\\n\\033]8;id=1;https://claude.com/cai/oauth/authorize?code=true&state=abc\\007https://claude.com/cai/oauth/auth\\033]8;;\\007\\n'
  read -r code; [ "$code" = "CODIGO-OK" ] || { echo "invalid code"; exit 1; }
  echo "Your token: sk-ant-oat01-TOKENDETESTE1234567890abcdef"; exit 0
fi
exec ${process.env.NIVOO_CLAUDE_BIN} "$@"
`, { mode: 0o755 });
    const original = process.env.NIVOO_CLAUDE_BIN;
    process.env.NIVOO_CLAUDE_BIN = fake;
    try {
      await h.http().post('/api/accounts/claude-code-cli/login').expect(201);
      const s1 = await waitFor(async () => {
        const s = (await h.http().get('/api/accounts/claude-code-cli/login')).body;
        return s.state === 'aguardando_codigo' ? s : null;
      }, 15000);
      expect(s1.url).toBe('https://claude.com/cai/oauth/authorize?code=true&state=abc');
      await h.http().post('/api/accounts/claude-code-cli/login/code').send({ code: 'CODIGO-OK' }).expect(201);
      const s2 = await waitFor(async () => {
        const s = (await h.http().get('/api/accounts/claude-code-cli/login')).body;
        return s.state === 'conectado' ? s : null;
      }, 15000);
      expect(s2.message).toMatch(/conectado/i);
    } finally {
      process.env.NIVOO_CLAUDE_BIN = original;
    }
    const segredos = path.join(path.dirname(appConfig().workspacesRoot), 'segredos.json');
    expect(JSON.parse(fs.readFileSync(segredos, 'utf8')).CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-TOKENDETESTE1234567890abcdef');
    expect(fs.statSync(segredos).mode & 0o777).toBe(0o600);

    // Chave de API do Gemini (alternativa ao login com a conta).
    await h.http().post('/api/accounts/gemini-cli/key').send({ key: 'curta' }).expect(400);
    await h.http().post('/api/accounts/gemini-cli/key').send({ key: 'AIzaSy-chave-de-teste-0123456789' }).expect(201);
    expect(JSON.parse(fs.readFileSync(segredos, 'utf8')).GEMINI_API_KEY).toBe('AIzaSy-chave-de-teste-0123456789');
    await h.http().delete('/api/accounts/gemini-cli').expect(200);
    expect(JSON.parse(fs.readFileSync(segredos, 'utf8')).GEMINI_API_KEY).toBeUndefined();
    await h.http().post('/api/accounts/local-shell/login').expect(400);
  });
});
