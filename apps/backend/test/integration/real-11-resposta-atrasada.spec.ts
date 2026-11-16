/**
 * REAL (opt-in: NIVOO_RUN_CLI_INTEGRATION=1; IA em NIVOO_ENSAIO_IA): o caso do ConnectChat — trocar de sessão
 * (Alfa → Beta) enquanto as mensagens da Alfa ainda carregam faz a resposta atrasada da Alfa aparecer na tela da Beta.
 * Pedido pelo chat para corrigir e comprovar → a IA comprova com a conferência do sistema (roteiro com "atrasar" ou
 * script em nivoo-roteiros/) → no fim, um roteiro independente com a rede atrasada passa na pasta principal.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import { REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
const IA = process.env.NIVOO_ENSAIO_IA ?? 'claude-code-cli';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'R', GIT_AUTHOR_EMAIL: 'r@x', GIT_COMMITTER_NAME: 'R', GIT_COMMITTER_EMAIL: 'r@x' } }).toString();

d(`REAL: resposta atrasada na troca de sessão é corrigida e comprovada (${IA})`, () => {
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

  it('troca de sessão com resposta atrasada', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Atendimento', provider: IA, description: 'Painel de atendimento com várias sessões de conversa.' }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'atendimento', version: '0.1.0', private: true, scripts: { start: 'node server.js', test: 'node --test' } }, null, 2));
    fs.writeFileSync(path.join(repo, 'server.js'), [
      "const http = require('http');",
      "const fs = require('fs');",
      "const mensagens = { alfa: ['Mensagem da Alfa: pedido 123'], beta: ['Mensagem da Beta: troca de endereço'] };",
      'http.createServer((q, r) => {',
      "  const u = new URL(q.url, 'http://x');",
      "  if (u.pathname === '/api/mensagens') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(mensagens[u.searchParams.get('sessao')] || [])); }",
      "  if (u.pathname === '/app.js') { r.setHeader('content-type', 'text/javascript; charset=utf-8'); return r.end(fs.readFileSync(__dirname + '/app.js')); }",
      "  r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(__dirname + '/index.html'));",
      "}).listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1');",
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'index.html'), [
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Atendimento</title></head>',
      '<body><nav><button id="sessao-alfa">Alfa</button> <button id="sessao-beta">Beta</button></nav>',
      '<h1 id="titulo">Escolha uma sessão</h1><ul id="lista"></ul><script src="/app.js"></script></body></html>',
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'app.js'), [
      'async function abrir(sessao) {',
      "  document.getElementById('titulo').textContent = 'Sessão ' + sessao;",
      "  document.getElementById('lista').textContent = 'Carregando…';",
      "  const r = await fetch('/api/mensagens?sessao=' + sessao);",
      '  const lista = await r.json();',
      "  document.getElementById('lista').innerHTML = lista.map((t) => '<li>' + t + '</li>').join('');",
      '}',
      "document.getElementById('sessao-alfa').onclick = () => abrir('alfa');",
      "document.getElementById('sessao-beta').onclick = () => abrir('beta');",
    ].join('\n'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'painel');
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const msgs = async () => (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({
      content: 'No painel de atendimento, se eu abro a sessão Alfa e troco para a Beta antes de as mensagens da Alfa terminarem de carregar (rede lenta), as mensagens da Alfa aparecem na tela da Beta. Corrija e comprove, inclusive com a resposta da Alfa chegando atrasada depois da troca.',
    }).expect(201);
    const plano = await waitFor(async () => (await msgs()).find((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE' && m.kind !== 'sistema') ?? null, 900_000);
    console.log('PLANO:', plano.kind, plano.content, JSON.stringify(plano.plan?.steps?.map((s: any) => s.verifyCommand)));
    expect(plano.kind).toBe('plano');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Ensaio' }).expect(201);
    let quieto = 0;
    const inicio = Date.now();
    while (Date.now() - inicio < 50 * 60_000) {
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
      for (const s of full.steps) console.log(`  etapa ${s.key} [${s.status}] (${s.provider ?? ''}) verify: ${s.verifyCommand}`);
      for (const a of full.attempts) console.log(`  tentativa ${a.number} ${a.status} ${(a.error ?? '').slice(-400)}`);
    }
    console.log('ENTREGA:', (await msgs()).filter((m: any) => m.kind === 'entrega').map((m: any) => m.content).join('\n---\n'));
    const roteiros = fs.existsSync(path.join(repo, 'nivoo-roteiros')) ? fs.readdirSync(path.join(repo, 'nivoo-roteiros')) : [];
    console.log('ROTEIROS NA MAIN:', roteiros.join(', '));
    for (const r of roteiros) console.log(`--- ${r}\n${fs.readFileSync(path.join(repo, 'nivoo-roteiros', r), 'utf8').slice(0, 2500)}`);
    expect(jobs.every((j: any) => j.status === 'CONCLUIDO')).toBe(true);
    // A comprovação ficou onde a conferência roda: roteiro com rede atrasada ou script em nivoo-roteiros/.
    const conteudo = roteiros.map((r) => fs.readFileSync(path.join(repo, 'nivoo-roteiros', r), 'utf8')).join('\n');
    expect(roteiros.some((r) => /\.(cjs|mjs)$/.test(r)) || /"atrasar"/.test(conteudo)).toBe(true);
    // Conferência independente na pasta principal: resposta da Alfa atrasada 2,5 s, troca para a Beta, a Alfa não aparece.
    const porta = await new Promise<number>((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const n = (s.address() as net.AddressInfo).port; s.close(() => ok(n)); }); });
    const servidor = spawn('node', ['server.js'], { cwd: repo, env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1' }, stdio: 'ignore' });
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'atrasada-'));
    const roteiro = path.join(pasta, 'r.json');
    fs.writeFileSync(roteiro, JSON.stringify({ nome: 'troca', tamanho: 'ambos', passos: [
      { atrasar: 'sessao=alfa', ms: 2500 }, { ir: '/' }, { clicar: '#sessao-alfa' }, { aguardar: 300 }, { clicar: '#sessao-beta' },
      { esperarTexto: 'Mensagem da Beta' }, { aguardar: 3500 }, { semTexto: 'Mensagem da Alfa' }, { esperarTexto: 'Mensagem da Beta' },
    ] }));
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const saida = await new Promise<string>((ok, falha) => execFile(path.join(__dirname, '..', '..', 'bin', 'nivoo-roteiro'), [`http://127.0.0.1:${porta}`, roteiro, '--pasta', pasta], { encoding: 'utf8' }, (e, so, se) => (e ? falha(new Error(`${so}${se}`)) : ok(so))));
      console.log(saida);
    } finally {
      servidor.kill();
    }
  }, 60 * 60_000);
});
