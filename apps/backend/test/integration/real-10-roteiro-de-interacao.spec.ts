/**
 * REAL (opt-in: NIVOO_RUN_CLI_INTEGRATION=1; IA em NIVOO_ENSAIO_IA): formulário com o campo que perde o foco a cada letra.
 * Pedido pelo chat para corrigir e comprovar → a IA planeja a conferência com roteiro de interação (nivoo-roteiro) →
 * corrige → no fim, um roteiro digitando no campo passa na pasta principal.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import { REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
const IA = process.env.NIVOO_ENSAIO_IA ?? 'claude-code-cli';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'R', GIT_AUTHOR_EMAIL: 'r@x', GIT_COMMITTER_NAME: 'R', GIT_COMMITTER_EMAIL: 'r@x' } }).toString();

d(`REAL: roteiro de interação comprova a correção (${IA})`, () => {
  let h: Harness;
  beforeAll(async () => {
    delete process.env.NIVOO_CLAUDE_BIN;
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, IA);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
  });

  it('campo que perde o foco é corrigido e comprovado por roteiro', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Padaria', provider: IA, description: 'Site de uma padaria.' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    fs.writeFileSync(path.join(repo, 'index.html'), [
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Encomendas</title></head>',
      '<body><h1>Encomenda de bolo</h1><form id="f"><label>Seu nome <input id="nome" name="nome"></label><button>Enviar</button></form><p id="msg"></p>',
      '<script src="app.js"></script></body></html>',
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'app.js'), [
      '// Atualiza o formulário a cada letra (recria o campo).',
      "document.getElementById('f').addEventListener('input', (e) => { const n = e.target.cloneNode(); n.value = e.target.value; e.target.replaceWith(n); });",
      "document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('msg').textContent = 'Recebido, ' + document.getElementById('nome').value; });",
    ].join('\n'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'site');
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const msgs = async () => (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({
      content: 'No formulário de encomenda, o campo do nome perde o foco a cada letra que a pessoa digita. Corrija e comprove que dá para digitar o nome inteiro e enviar (a mensagem "Recebido, <nome>" aparece).',
    }).expect(201);
    const plano = await waitFor(async () => (await msgs()).find((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE' && m.kind !== 'sistema') ?? null, 900_000);
    console.log('PLANO:', plano.kind, plano.content, JSON.stringify(plano.plan?.steps?.map((s: any) => s.verifyCommand)));
    expect(plano.kind).toBe('plano');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Ensaio' }).expect(201);
    let quieto = 0;
    const inicio = Date.now();
    while (Date.now() - inicio < 40 * 60_000) {
      await new Promise((r) => setTimeout(r, 15_000));
      const jobs = (await h.http().get(`/api/projects/${p.id}/jobs`)).body;
      const ativo = jobs.some((j: any) => ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO'].includes(j.status)) || (await msgs()).some((m: any) => m.status === 'PENDENTE');
      quieto = ativo ? 0 : quieto + 1;
      if (quieto >= 3) break;
    }
    const jobs = (await h.http().get(`/api/projects/${p.id}/jobs`)).body;
    for (const j of jobs) {
      const full = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      console.log(`TRABALHO ${full.title}: ${full.status} ${full.statusDetail ?? ''}`);
      for (const s of full.steps) console.log(`  etapa ${s.key} [${s.status}] verify: ${s.verifyCommand}`);
      for (const a of full.attempts) console.log(`  tentativa ${a.number} ${a.status} ${(a.error ?? '').slice(-400)}`);
    }
    console.log('ENTREGA:', (await msgs()).filter((m: any) => m.kind === 'entrega').map((m: any) => m.content).join('\n---\n'));
    expect(jobs.every((j: any) => j.status === 'CONCLUIDO')).toBe(true);
    const verificacoes = (await Promise.all(jobs.map(async (j: any) => (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body.steps.map((s: any) => s.verifyCommand ?? '')))).flat().join('\n');
    expect(verificacoes).toMatch(/nivoo-roteiro/); // a IA planejou a conferência com roteiro de interação
    // Confere a pasta principal com as fotos: sem problemas no computador e no celular.
    const servidor = require('node:http').createServer((q: any, r: any) => {
      const arq = path.join(repo, q.url === '/' ? 'index.html' : q.url);
      if (!arq.startsWith(repo) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) return void ((r.statusCode = 404), r.end());
      r.end(fs.readFileSync(arq));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const porta = servidor.address().port;
    const pasta = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'roteiro-'));
    const roteiro = path.join(pasta, 'r.json');
    fs.writeFileSync(roteiro, JSON.stringify({ nome: 'encomenda', tamanho: 'ambos', passos: [{ ir: '/' }, { digitar: '#nome', valor: 'Maria Souza' }, { tecla: 'Enter' }, { esperarTexto: 'Recebido, Maria Souza' }] }));
    try {
      const { stdout } = await require('node:util').promisify(require('node:child_process').execFile)(path.join(__dirname, '..', '..', 'bin', 'nivoo-roteiro'), [`http://127.0.0.1:${porta}`, roteiro, '--pasta', pasta], { encoding: 'utf8' });
      console.log(stdout);
    } finally {
      servidor.close();
    }
  }, 50 * 60_000);
});
