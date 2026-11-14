/**
 * GitHub e GitLab conectados AO MESMO TEMPO: escolher um repositório da conta, criar um repositório novo
 * (no usuário ou num grupo) já com o projeto enviado e o envio automático ligado, e mudar um projeto do
 * GitHub para o GitLab com todo o histórico. Os servidores são simulados por uma API HTTP local
 * (GitHub Enterprise /api/v3 e GitLab /api/v4) que cria repositórios bare locais.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll } from '../support/harness';

interface Chamada {
  servidor: string;
  metodo: string;
  rota: string;
  token: string;
  corpo: any;
}

describe('Git: duas contas, escolher e criar repositório, mudar de servidor', () => {
  let h: Harness;
  let base: string;
  let servidor: http.Server;
  let host: string;
  const chamadas: Chamada[] = [];
  const repos: Record<string, Array<{ nome: string; caminho: string; privado: boolean }>> = { github: [], gitlab: [] };
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd }).toString().trim();

  beforeAll(async () => {
    process.env.NIVOO_GIT_PERMITIR_LOCAL = '1';
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'git-api-'));
    const novoRepo = (srv: 'github' | 'gitlab', nome: string, privado: boolean) => {
      if (repos[srv].some((r) => r.nome === nome)) return null;
      const caminho = path.join(base, srv, `${nome}.git`);
      fs.mkdirSync(path.dirname(caminho), { recursive: true });
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', caminho]);
      const r = { nome, caminho, privado };
      repos[srv].push(r);
      return r;
    };
    novoRepo('github', 'robson/antigo', true);
    servidor = http.createServer((req, res) => {
      let dados = '';
      req.on('data', (c) => (dados += c));
      req.on('end', () => {
        const u = new URL(req.url!, 'http://x');
        const srv = u.pathname.startsWith('/api/v3') ? 'github' : 'gitlab';
        const token = String(req.headers.authorization ?? '').replace('Bearer ', '') || String(req.headers['private-token'] ?? '');
        const corpo = dados ? JSON.parse(dados) : null;
        chamadas.push({ servidor: srv, metodo: req.method!, rota: u.pathname + u.search, token, corpo });
        const json = (st: number, b: unknown) => {
          res.writeHead(st, { 'content-type': 'application/json' });
          res.end(JSON.stringify(b));
        };
        if (token !== (srv === 'github' ? 'ghp_TESTE_123456' : 'glpat-TESTE-123456')) return json(401, { message: 'Bad credentials' });
        const rota = u.pathname.replace(/^\/api\/v[34]/, '');
        if (srv === 'github') {
          if (rota === '/user') return json(200, { login: 'robson' });
          if (rota === '/user/orgs') return json(200, [{ login: 'flowspec' }]);
          if (rota === '/user/repos' && req.method === 'GET') return json(200, repos.github.map((r) => ({ full_name: r.nome, clone_url: r.caminho, default_branch: 'main', private: r.privado })));
          const org = /^\/orgs\/([^/]+)\/repos$/.exec(rota);
          if ((rota === '/user/repos' || org) && req.method === 'POST') {
            const r = novoRepo('github', `${org ? org[1] : 'robson'}/${corpo.name}`, corpo.private);
            return r ? json(201, { full_name: r.nome, clone_url: r.caminho, private: r.privado }) : json(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] });
          }
        } else {
          if (rota === '/user') return json(200, { username: 'robson' });
          if (rota === '/namespaces') return json(200, [{ id: 1, full_path: 'robson', kind: 'user' }, { id: 7, full_path: 'empresa/sistemas', kind: 'group' }]);
          if (rota === '/projects' && req.method === 'GET') {
            const b = u.searchParams.get('search') ?? '';
            return json(200, repos.gitlab.filter((r) => r.nome.includes(b)).map((r) => ({ path_with_namespace: r.nome, http_url_to_repo: r.caminho, default_branch: 'main', visibility: r.privado ? 'private' : 'public' })));
          }
          if (rota === '/projects' && req.method === 'POST') {
            const ns = corpo.namespace_id === 7 ? 'empresa/sistemas' : 'robson';
            const r = novoRepo('gitlab', `${ns}/${corpo.path}`, corpo.visibility === 'private');
            return r ? json(201, { path_with_namespace: r.nome, http_url_to_repo: r.caminho, visibility: corpo.visibility }) : json(400, { message: { name: ['has already been taken'] } });
          }
        }
        json(404, { message: 'Not Found' });
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    host = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    h = await createHarness();
    await truncateAll(h.prisma);
  });
  afterAll(async () => {
    for (const c of (await h.http().get('/api/git/accounts')).body) await h.http().delete(`/api/git/accounts/${c.id}`);
    await h.close();
    servidor.close();
    delete process.env.NIVOO_GIT_PERMITIR_LOCAL;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('GitHub e GitLab juntos: escolher repositório, criar novo (usuário e grupo), mudar do GitHub para o GitLab', async () => {
    // As duas contas ao mesmo tempo; o token é conferido no servidor de cada uma.
    const gh = (await h.http().post('/api/git/accounts').send({ tipo: 'github', host, token: 'ghp_TESTE_123456', nome: 'GitHub' }).expect(201)).body;
    const gl = (await h.http().post('/api/git/accounts').send({ tipo: 'gitlab', host, token: 'glpat-TESTE-123456', nome: 'GitLab da empresa' }).expect(201)).body;
    await h.http().post('/api/git/accounts').send({ tipo: 'gitlab', host, token: 'glpat-ERRADO-0000' }).expect(400);
    expect((await h.http().get('/api/git/accounts')).body.map((c: any) => c.nome)).toEqual(['GitHub', 'GitLab da empresa']);
    // Trocar o token (ex.: o anterior expirou): conferido antes de salvar; a conta continua a mesma.
    await h.http().patch(`/api/git/accounts/${gl.id}`).send({ token: 'glpat-NOVO-ERRADO-00' }).expect(400);
    expect((await h.http().patch(`/api/git/accounts/${gl.id}`).send({ token: 'glpat-TESTE-123456', nome: 'GitLab da empresa' }).expect(200)).body.id).toBe(gl.id);
    expect((await h.http().post(`/api/git/accounts/${gl.id}/testar`).expect(201)).body).toEqual({ ok: true, usuario: 'robson' });

    // Escolher entre os repositórios da conta, sem digitar o endereço.
    const lista = (await h.http().get(`/api/git/accounts/${gh.id}/repos`).expect(200)).body;
    expect(lista).toEqual([{ nome: 'robson/antigo', url: repos.github[0].caminho, branch: 'main', privado: true }]);
    expect((await h.http().get(`/api/git/accounts/${gh.id}/namespaces`)).body).toEqual([
      { id: 'robson', nome: 'robson', tipo: 'usuario' },
      { id: 'flowspec', nome: 'flowspec', tipo: 'grupo' },
    ]);
    expect((await h.http().get(`/api/git/accounts/${gl.id}/namespaces`)).body.map((n: any) => n.nome)).toEqual(['robson', 'empresa/sistemas']);

    // Projeto do zero → "Criar repositório novo" no GitHub (organização): criado vazio, enviado, envio automático ligado.
    const p = (await h.http().post('/api/projects').send({ name: 'Painel de Vendas', description: 'Painel comercial' }).expect(201)).body;
    const c1 = (await h.http().post(`/api/projects/${p.id}/git/create`).send({ accountId: gh.id, namespace: 'flowspec', tipoNamespace: 'grupo', nome: 'Painel de Vendas' }).expect(201)).body;
    expect(c1.criado.nome).toBe('flowspec/Painel-de-Vendas');
    expect(c1.ligado).toBe(true);
    expect(c1.autoEnvio).toBe(true);
    expect(c1.enviar).toBe(0);
    const criadoGh = chamadas.find((x) => x.metodo === 'POST' && x.rota === '/api/v3/orgs/flowspec/repos')!;
    expect(criadoGh.corpo).toMatchObject({ name: 'Painel-de-Vendas', private: true, auto_init: false });
    const remotoGh = repos.github.find((r) => r.nome === 'flowspec/Painel-de-Vendas')!.caminho;
    const mainProjeto = git(path.join(p.workspacePath, 'repo'), 'rev-parse', 'main');
    expect(git(remotoGh, 'rev-parse', 'main')).toBe(mainProjeto);
    // Mesmo nome de novo → aviso claro.
    const p2 = (await h.http().post('/api/projects').send({ name: 'Outro' }).expect(201)).body;
    const dup = await h.http().post(`/api/projects/${p2.id}/git/create`).send({ accountId: gh.id, namespace: 'flowspec', tipoNamespace: 'grupo', nome: 'Painel de Vendas' }).expect(409);
    expect(dup.body.message).toMatch(/Já existe um repositório com esse nome/);

    // Mudar do GitHub para o GitLab (grupo da empresa): histórico inteiro no novo; o antigo fica como estava.
    const c2 = (await h.http().post(`/api/projects/${p.id}/git/create`).send({ accountId: gl.id, namespace: '7', tipoNamespace: 'grupo', nome: 'painel-vendas', autoEnvio: false }).expect(201)).body;
    expect(c2.criado.nome).toBe('empresa/sistemas/painel-vendas');
    expect(c2.conta.nome).toBe('GitLab da empresa');
    expect(c2.autoEnvio).toBe(true); // continua como estava
    const criadoGl = chamadas.find((x) => x.metodo === 'POST' && x.servidor === 'gitlab')!;
    expect(criadoGl.corpo).toMatchObject({ path: 'painel-vendas', namespace_id: 7, visibility: 'private', initialize_with_readme: false });
    const remotoGl = repos.gitlab[0].caminho;
    expect(git(remotoGl, 'rev-parse', 'main')).toBe(mainProjeto);
    expect(git(remotoGh, 'rev-parse', 'main')).toBe(mainProjeto);
    // Busca no GitLab.
    expect((await h.http().get(`/api/git/accounts/${gl.id}/repos`).query({ busca: 'painel' })).body.map((r: any) => r.nome)).toEqual(['empresa/sistemas/painel-vendas']);
    // O token nunca aparece nas respostas.
    expect(JSON.stringify([c1, c2, lista])).not.toMatch(/ghp_|glpat-/);
  });
});
