/**
 * Áreas (modelos, instruções versionadas, base de conhecimento), pasta principal que acumula o trabalho
 * dos jobs e conversa (IA propõe plano → aprovação → job). Sem IA real: executor local e, para simular
 * a IA da conversa e registrar o prompt recebido, o stub TEST-ONLY. Prova real: test/integration/real-06.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspaceService } from '../../src/storage/workspace.service';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const ok = [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }];

describe('Áreas, pasta principal e conversa', () => {
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

  const area = async (name: string, template: string) => (await h.http().post('/api/areas').send({ name, template }).expect(201)).body;
  const projeto = async (name: string, areaSlug: string) => (await h.http().post('/api/projects').send({ name, area: areaSlug, description: `projeto ${name}` }).expect(201)).body;
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

  it('cria área a partir de modelo, com instruções versionadas e base de conhecimento no git', async () => {
    const modelos = (await h.http().get('/api/areas/templates').expect(200)).body.map((t: any) => t.key);
    expect(modelos).toEqual(expect.arrayContaining(['mercado', 'generica', 'web', 'imagem', 'video']));
    const a = await area('Imagem para pizzaria', 'imagem');
    expect(a.slug).toBe('imagem-para-pizzaria');
    expect(a.kind).toBe('GENERICA');
    expect(a.currentInstruction.version).toBe(1);
    expect(a.currentInstruction.text).toMatch(/diretor de arte/);
    expect(a.baseFiles.map((f: any) => f.path)).toEqual(expect.arrayContaining(['README.md', 'briefing.md', 'identidade-visual.md']));
    await h.http().post('/api/areas').send({ name: 'Imagem para pizzaria', template: 'imagem' }).expect(409);
    await h.http().post('/api/areas').send({ name: 'Outro mercado', template: 'mercado' }).expect(409);

    const v2 = (await h.http().post(`/api/areas/${a.slug}/instructions`).send({ text: 'Especialista em pizzarias napolitanas. Código de rastreio AREA-PZ-77.', reason: 'foco no cliente' }).expect(201)).body;
    expect(v2.instructions.map((i: any) => i.version)).toEqual([1, 2]);
    expect(v2.instructions[0].text).toBe(a.currentInstruction.text); // v1 intacta

    await h.http().put(`/api/areas/${a.slug}/base/file`).send({ path: 'cardapio/sabores.md', content: '# Sabores\n- Margherita\nCódigo BASE-PZ-42', author: 'Robson' }).expect(200);
    const txt = (await h.http().get(`/api/areas/${a.slug}/base/file`).query({ path: 'cardapio/sabores.md' }).expect(200)).text;
    expect(txt).toContain('BASE-PZ-42');
    await h.http().put(`/api/areas/${a.slug}/base/file`).send({ path: '../fora.md', content: 'x' }).expect(400);
    await h.http().put(`/api/areas/${a.slug}/base/file`).send({ path: '.git/config', content: 'x' }).expect(400);
    const depois = (await h.http().get(`/api/areas/${a.slug}`).expect(200)).body;
    expect(depois.baseHistory[0].message).toBe('atualiza cardapio/sabores.md');
    expect(depois.baseHistory[0].author).toBe('Robson');
  });

  it('projetos ficam dentro da pasta da área; recursos de mercado só na área Mercado', async () => {
    const a = await area('Web Estúdio', 'web');
    const p = await projeto('Site da Pizzaria', a.slug);
    expect(p.dirKey).toBe(`areas/${a.slug}/projetos/site-da-pizzaria`);
    expect(p.workspacePath).toContain(path.join('areas', a.slug, 'projetos', 'site-da-pizzaria'));
    await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WIN'] }).expect(400);
    await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'd', assetCode: 'WIN', uri: 'x.csv' }).expect(400);
    const lista = (await h.http().get('/api/projects').query({ area: a.slug }).expect(200)).body;
    expect(lista.map((x: any) => x.id)).toEqual([p.id]);
    const m = await projeto('Pesquisa no mercado', 'mercado');
    await h.http().post(`/api/projects/${m.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WIN'] }).expect(201);
  });

  it('a pasta principal acumula o trabalho: o job seguinte enxerga o que o anterior criou', async () => {
    const a = await area('Continuidade', 'generica');
    const p = await projeto('Estrutura', a.slug);
    const j1 = await job(p.id, {
      title: 'cria estrutura',
      steps: [{ key: 's', instructions: 'mkdir -p estrutura docs && echo "# Estrutura v1" > estrutura/README.md && echo nota > docs/a.md' }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: 'estrutura/README.md' } }],
    });
    const d1 = await ate(p.id, j1.id);
    expect(d1.status).toBe('CONCLUIDO');
    expect(d1.mergeStatus).toBe('INCORPORADO');
    const files = (await h.http().get(`/api/projects/${p.id}/files`).expect(200)).body.arquivos.map((f: any) => f.path);
    expect(files).toEqual(expect.arrayContaining(['estrutura/README.md', 'docs/a.md']));
    const j2 = await job(p.id, {
      title: 'continua a estrutura',
      steps: [{ key: 's', instructions: 'grep -q "Estrutura v1" estrutura/README.md && echo "## v2" >> estrutura/README.md' }],
      criteria: [{ key: 'v2', description: 'v2', kind: 'COMMAND', config: { command: 'grep -q "## v2" estrutura/README.md' } }],
    });
    const d2 = await ate(p.id, j2.id);
    expect(d2.status).toBe('CONCLUIDO');
    const conteudo = (await h.http().get(`/api/projects/${p.id}/files/content`).query({ path: 'estrutura/README.md' }).expect(200)).text;
    expect(conteudo).toBe('# Estrutura v1\n## v2\n');
    await h.http().get(`/api/projects/${p.id}/files/content`).query({ path: '../../etc/passwd' }).expect(404);
  });

  it('conflito ao integrar: o job não é dado como concluído e a pendência fica registrada', async () => {
    const a = await area('Conflitos', 'generica');
    const p = await projeto('Concorrentes', a.slug);
    // A demora 1 s; B começa antes de A ser incorporado e escreve o mesmo arquivo com outro conteúdo.
    const A = await job(p.id, { title: 'A', steps: [{ key: 's', instructions: 'sleep 1; echo A > conflito.txt' }] });
    const B = await job(p.id, { title: 'B', steps: [{ key: 's', instructions: 'echo B > conflito.txt' }] });
    const fa = await ate(p.id, A.id);
    const fb = await ate(p.id, B.id);
    expect(fa.status).toBe('CONCLUIDO');
    expect(fb.status).toBe('BLOQUEADO');
    expect(fb.blockedReason).toBe('CONFLITO_INCORPORACAO');
    expect(fb.mergeStatus).toBe('CONFLITO');
    expect(fb.statusDetail).toContain('conflito.txt');
    const repo = path.join(p.workspacePath, 'repo');
    expect(fs.readFileSync(path.join(repo, 'conflito.txt'), 'utf8')).toBe('A\n');
    const pend = (await h.http().get(`/api/projects/${p.id}/memory?category=PENDENCIA`)).body;
    expect(pend.some((m: any) => m.references?.origem === 'conflito-incorporacao' && m.references.jobId === B.id)).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString()).toBe(''); // pasta principal limpa
  });

  it('cada sessão de IA recebe as instruções e a base da SUA área (e não de outra)', async () => {
    const a = await area('Pizzaria Sessão', 'imagem');
    await h.http().post(`/api/areas/${a.slug}/instructions`).send({ text: 'Diretor de arte de pizzarias. Código AREA-SESSAO-31.', reason: 'teste' }).expect(201);
    await h.http().put(`/api/areas/${a.slug}/base/file`).send({ path: 'marca.md', content: 'Cor principal: vermelho tomate. Código BASE-SESSAO-58.' }).expect(200);
    const outra = await area('Outra Área', 'generica');
    await h.http().put(`/api/areas/${outra.slug}/base/file`).send({ path: 'segredo-da-outra.md', content: 'NAO-DEVE-VAZAR' }).expect(200);
    const p = await projeto('Artes do cardápio', a.slug);
    ctl('mode', null);
    const j = await job(p.id, { title: 'arte', defaultProvider: 'claude-code-cli', steps: [{ key: 's', instructions: 'x', verifyCommand: 'test -f area/marca.md' }] });
    const d = await ate(p.id, j.id);
    expect(d.status).toBe('CONCLUIDO');
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toContain('AREA-SESSAO-31');
    expect(prompt).toContain('area/marca.md');
    expect(prompt).not.toContain('segredo-da-outra');
    const wt = path.join(p.workspacePath, 'worktrees', j.id);
    expect(fs.readFileSync(path.join(wt, 'area', 'marca.md'), 'utf8')).toContain('BASE-SESSAO-58');
    expect(fs.existsSync(path.join(wt, 'area', 'segredo-da-outra.md'))).toBe(false);
    const tracked = execFileSync('git', ['ls-files'], { cwd: path.join(p.workspacePath, 'repo') }).toString();
    expect(tracked).not.toMatch(/^area\//m); // a base da área não é copiada para dentro do projeto no git
  });

  it('conversa: a IA propõe um plano; só com aprovação vira job, que executa e entra na pasta principal', async () => {
    const a = await area('Conversa', 'web');
    const p = await projeto('Landing', a.slug);
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({ title: 'Landing page' }).expect(201)).body;
    const plano = {
      tipo: 'plano',
      texto: 'Vou criar a estrutura da landing.',
      job: {
        title: 'Estrutura da landing',
        objective: 'Criar index.html com o título da pizzaria.',
        defaultProvider: 'local-shell',
        steps: [{ key: 'html', instructions: 'echo "<h1>Pizzaria</h1>" > index.html' }],
        criteria: [{ key: 'arquivo', description: 'index existe', kind: 'FILE_EXISTS', config: { path: 'index.html' } }],
      },
    };
    ctl('mode', 'texto');
    ctl('resposta.txt', `Analisei a pasta.\n\`\`\`json\n${JSON.stringify(plano)}\n\`\`\``);
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'Crie a estrutura da landing' }).expect(201);
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'outra' }).expect(409); // aguarda a resposta
    const c1 = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body;
      return x.messages.some((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE') ? x : null;
    });
    const resp = c1.messages.find((m: any) => m.role === 'ASSISTENTE');
    expect(resp.kind).toBe('plano');
    expect(resp.plan.title).toBe('Estrutura da landing');
    expect(Number(resp.costUsd)).toBeCloseTo(0.02);
    expect(await h.prisma.job.count({ where: { projectId: p.id } })).toBe(0); // nada executa sem aprovação
    expect(fs.existsSync(path.join(p.workspacePath, 'conversas-tmp', resp.id))).toBe(false); // cópia descartada

    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages/${resp.id}/approve`).send({}).expect(400); // quem aprova?
    const c2 = (await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages/${resp.id}/approve`).send({ decidedBy: 'Robson' }).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages/${resp.id}/approve`).send({ decidedBy: 'Robson' }).expect(409);
    const jobId = c2.messages.find((m: any) => m.id === resp.id).jobId;
    const d = await ate(p.id, jobId);
    expect(d.status).toBe('CONCLUIDO');
    expect(fs.readFileSync(path.join(p.workspacePath, 'repo', 'index.html'), 'utf8')).toContain('Pizzaria');

    // Plano inválido (sem critérios) não pode ser aprovado: vira resposta explicando o problema.
    ctl('resposta.txt', '```json\n' + JSON.stringify({ tipo: 'plano', texto: 'x', job: { ...plano.job, criteria: [] } }) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'mais' }).expect(201);
    const c3 = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body;
      const ult = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema').pop();
      return ult && ult.status !== 'PENDENTE' && ult.id !== resp.id ? ult : null;
    });
    expect(c3.kind).toBe('resposta');
    expect(c3.content).toMatch(/não passou na validação/);
    expect(c3.plan).toBeNull();
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('o que é dito na conversa vira memória do projeto (sem duplicar) e pode ser esquecido', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Pizzaria do Zé', tipo: 'imagem', description: 'artes da pizzaria' }).expect(201)).body;
    expect(p.dirKey).toBe('areas/imagem/projetos/pizzaria-do-ze'); // área do tipo criada sozinha
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const resposta = {
      tipo: 'resposta',
      texto: 'Entendido! Vou usar vermelho e a fonte Bebas.',
      memoria: [
        { tipo: 'DECISAO', titulo: 'Cor principal', conteudo: 'A cor principal da marca é vermelho tomate.' },
        { tipo: 'PREFERENCIA', titulo: 'Fonte', conteudo: 'Usar a fonte Bebas Neue nos títulos.' },
        { tipo: 'INVALIDO', titulo: 'x', conteudo: 'y' },
      ],
    };
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify(resposta) + '\n```');
    const espera = async (n: number) =>
      waitFor(async () => {
        const x = (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body;
        const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE');
        return r.length === n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
      });
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'A cor é vermelho tomate e quero a fonte Bebas' }).expect(201);
    const r1 = await espera(1);
    expect(r1.content).toMatch(/Guardei na memória do projeto: Cor principal; Fonte/);
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'repetindo' }).expect(201);
    const r2 = await espera(2);
    expect(r2.content).not.toMatch(/Guardei/); // nada duplicado
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`)).body.filter((m: any) => m.references?.origem === 'conversa');
    expect(mem.map((m: any) => m.category).sort()).toEqual(['ARQUITETURA_RESTRICOES', 'DECISAO_APROVADA']);
    // A memória entra nas próximas conversas e trabalhos: o prompt seguinte já contém a decisão.
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toContain('vermelho tomate');
    const fonte = mem.find((m: any) => m.title === 'Fonte');
    await h.http().delete(`/api/projects/${p.id}/memory/${fonte.id}`).expect(200);
    const depois = (await h.http().get(`/api/projects/${p.id}/memory`)).body;
    expect(depois.some((m: any) => m.title === 'Fonte')).toBe(false);
    expect(depois.some((m: any) => m.title === 'Cor principal')).toBe(true);
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('importa uma pasta de padrões para o modelo (1 commit) e a IA a recebe, com arquivos de agente renomeados', async () => {
    const a = await area('Studio', 'generica');
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    const grande = 'x'.repeat(3 * 1024 * 1024); // > 100 KB: exige o limite de corpo configurado
    const r = (
      await h
        .http()
        .post(`/api/areas/${a.slug}/base/import`)
        .send({
          files: [
            { path: 'README.md', contentBase64: b64('# Studio\nFluxo STUDIO-FLUXO-42') },
            { path: 'padroes/identidade.md', contentBase64: b64('paleta #FF6600') },
            { path: '.claude/agents/arquiteto.md', contentBase64: b64('agente arquiteto') },
            { path: 'CLAUDE.md', contentBase64: b64('regras do studio') },
            { path: 'node_modules/x/a.js', contentBase64: b64('lixo') },
            { path: 'assets/grande.txt', contentBase64: b64(grande) },
          ],
        })
        .expect(201)
    ).body;
    expect(r.importados).toBe(5);
    expect(r.ignorados).toEqual(['node_modules/x/a.js']);
    await h.http().post(`/api/areas/${a.slug}/base/import`).send({ files: [{ path: '../fora.md', contentBase64: b64('x') }] }).expect(400);
    const det = (await h.http().get(`/api/areas/${a.slug}`).expect(200)).body;
    expect(det.baseFiles.map((f: any) => f.path)).toEqual(expect.arrayContaining(['padroes/identidade.md', '.claude/agents/arquiteto.md', 'CLAUDE.md']));
    expect(det.baseHistory[0].message).toMatch(/importa 5 arquivo/);

    // Na conversa a IA recebe a lista da base; arquivos de agente aparecem renomeados (legíveis, inertes).
    const p = await projeto('Site Studio', a.slug);
    const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify({ tipo: 'resposta', texto: 'ok', memoria: [] }) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'oi' }).expect(201);
    await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body;
      return x.messages.some((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE') ? x : null;
    });
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toContain('area/padroes/identidade.md');
    expect(prompt).toContain('area/_claude/agents/arquiteto.md');
    expect(prompt).toContain('area/_CLAUDE.md');
    expect(prompt).not.toContain('node_modules');

    // Na sessão de trabalho, a cópia da base também vem renomeada (o executor não carrega como configuração).
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'sessao-'));
    h.app.get(WorkspaceService).copyAreaBaseInto(a.slug, tmp);
    expect(fs.readFileSync(path.join(tmp, 'area', 'README.md'), 'utf8')).toContain('STUDIO-FLUXO-42');
    expect(fs.existsSync(path.join(tmp, 'area', '_claude', 'agents', 'arquiteto.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'area', '_CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'area', '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'area', 'CLAUDE.md'))).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('conversa com a IA indisponível responde com erro claro, sem travar', async () => {
    const p = await projeto('Sem IA', 'mercado');
    await h.http().patch('/api/providers/claude-code-cli').send({ enabled: false }).expect(200);
    try {
      const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
      await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'oi' }).expect(201);
      const m = await waitFor(async () => {
        const x = (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body;
        const r = x.messages.find((y: any) => y.role === 'ASSISTENTE');
        return r && r.status !== 'PENDENTE' ? r : null;
      });
      expect(m.status).toBe('ERRO');
      expect(m.content).toMatch(/indisponível/);
    } finally {
      await h.http().patch('/api/providers/claude-code-cli').send({ enabled: true }).expect(200);
    }
  });
});
