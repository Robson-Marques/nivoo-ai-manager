/**
 * Ferramentas MCP: cadastro (segredo guardado à parte, nunca devolvido), teste de conexão (initialize +
 * tools/list de verdade, por stdio) e entrega às IAs só nos projetos escolhidos, no formato de cada uma.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { argsCodex, serversGemini } from '../../src/mcp/para-ia';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const STUB = path.join(__dirname, '..', 'support', 'stubs', 'mcp-stub.cjs');
const dados = path.dirname(process.env.NIVOO_WORKSPACES_ROOT!);

describe('Ferramentas MCP', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    for (const m of (await h.http().get('/api/mcp')).body.ferramentas) await h.http().delete(`/api/mcp/${m.id}`);
    await h.close();
    fs.rmSync(path.join(CTL, 'mode'), { force: true });
  });

  it('cadastra com segredo guardado à parte, testa de verdade e entrega à IA só nos projetos escolhidos', async () => {
    const p1 = (await h.http().post('/api/projects').send({ name: 'Com MCP', provider: 'claude-code-cli' }).expect(201)).body;
    const p2 = (await h.http().post('/api/projects').send({ name: 'Sem MCP', provider: 'claude-code-cli' }).expect(201)).body;
    const lista = (await h.http().get('/api/mcp').expect(200)).body;
    expect(lista.prontos.map((x: any) => x.chave)).toEqual(['context7', 'github', '21st']);
    expect(lista.prontos.find((x: any) => x.chave === '21st')).toMatchObject({tipo:'http',url:'https://21st.dev/api/mcp',cabecalhos:['x-api-key'],somenteProjetosEscolhidos:true});

    // Inválidos: comando com espaços/argumentos no lugar errado; token dentro do endereço.
    await h.http().post('/api/mcp').send({ nome: 'x', tipo: 'comando', comando: 'rm -rf /' }).expect(400);
    await h.http().post('/api/mcp').send({ nome: 'x', tipo: 'http', url: 'https://user:token@exemplo.com/mcp' }).expect(400);

    const saida = path.join(CTL, 'mcp-env.json');
    fs.mkdirSync(CTL, { recursive: true });
    const m = (
      await h.http().post('/api/mcp').send({ nome: 'Eco Teste', tipo: 'comando', comando: 'node', args: [STUB, saida], variaveis: { MODO: 'leitura' }, segredos: { TOKEN_X: 'segredo-123' }, projetos: [p1.id] }).expect(201)
    ).body;
    expect(m).toMatchObject({ nome: 'Eco Teste', nomeTecnico: 'eco-teste', segredos: [{ nome: 'TOKEN_X', definido: true }], projetos: [p1.id] });
    expect(JSON.stringify((await h.http().get('/api/mcp')).body)).not.toContain('segredo-123');
    expect(fs.readFileSync(path.join(dados, 'mcp.json'), 'utf8')).not.toContain('segredo-123');
    expect((fs.statSync(path.join(dados, 'mcp.json')).mode & 0o777).toString(8)).toBe('600');

    // Testar: liga a ferramenta, faz o aperto de mão e lista as ferramentas; o segredo chegou ao programa.
    const t = (await h.http().post(`/api/mcp/${m.id}/testar`).expect(201)).body;
    expect(t).toEqual({ ok: true, ferramentas: [{ nome: 'eco', descricao: 'Devolve o texto recebido' }] });
    expect(JSON.parse(fs.readFileSync(saida, 'utf8'))).toEqual({ TOKEN_X: 'segredo-123', MODO: 'leitura' });

    // Sessão de IA no projeto escolhido: recebe a ferramenta (com o segredo só no arquivo da sessão) e o aviso.
    fs.writeFileSync(path.join(CTL, 'mode'), 'bash');
    const rodar = async (pid: string) => {
      const j = (await h.http().post(`/api/projects/${pid}/jobs`).send({ title: 'x', objective: 'x', defaultProvider: 'claude-code-cli', conferencia: false, steps: [{ key: 's', instructions: 'true', verifyCommand: 'true' }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(201)).body;
      await h.http().post(`/api/projects/${pid}/jobs/${j.id}/start`).expect(201);
      return waitFor(async () => {
        const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
        return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
      }, 30_000);
    };
    expect((await rodar(p1.id)).status).toBe('CONCLUIDO');
    const cfg = JSON.parse(fs.readFileSync(path.join(CTL, 'mcp.json'), 'utf8'));
    expect(cfg).toEqual({ mcpServers: { 'eco-teste': { command: 'node', args: [STUB, saida], env: { MODO: 'leitura', TOKEN_X: 'segredo-123' } } } });
    expect(fs.readFileSync(path.join(CTL, 'args.txt'), 'utf8')).toMatch(/--allowedTools .*mcp__eco-teste/);
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toContain('Ferramentas MCP liberadas para este projeto: eco-teste');
    expect(prompt).not.toContain('segredo-123');
    // Projeto não escolhido: nada.
    expect((await rodar(p2.id)).status).toBe('CONCLUIDO');
    expect(fs.existsSync(path.join(CTL, 'mcp.json'))).toBe(false);
    expect(fs.readFileSync(path.join(CTL, 'args.txt'), 'utf8')).not.toContain('--mcp-config');

    // Desligar: some de todos; excluir: o segredo sai junto.
    await h.http().patch(`/api/mcp/${m.id}`).send({ ativo: false }).expect(200);
    expect((await rodar(p1.id)).status).toBe('CONCLUIDO');
    expect(fs.existsSync(path.join(CTL, 'mcp.json'))).toBe(false);
    await h.http().delete(`/api/mcp/${m.id}`).expect(200);
    const segredos = path.join(dados, 'segredos.json');
    if (fs.existsSync(segredos)) expect(fs.readFileSync(segredos, 'utf8')).not.toContain('segredo-123');
    fs.rmSync(path.join(CTL, 'mode'), { force: true });
  });

  it('registra 21st sem expor chave e respeita escopo do projeto', async () => {
    const {mcpDoProjeto}=await import('../../src/mcp/mcp');
    const p=(await h.http().post('/api/projects').send({name:'Design 21st',provider:'claude-code-cli'}).expect(201)).body;
    const other=(await h.http().post('/api/projects').send({name:'Sem 21st',provider:'claude-code-cli'}).expect(201)).body;
    const m=(await h.http().post('/api/mcp').send({nome:'21st.dev',tipo:'http',url:'https://21st.dev/api/mcp',cabecalhos:{'x-api-key':'dummy-test-only'},projetos:[p.id]}).expect(201)).body;
    try{
      expect(m.segredos).toEqual([{nome:'x-api-key',definido:true}]);
      expect(JSON.stringify((await h.http().get('/api/mcp')).body)).not.toContain('dummy-test-only');
      expect(mcpDoProjeto(p.id).find(x=>x.nome==='21st-dev')).toMatchObject({tipo:'http',url:'https://21st.dev/api/mcp',headers:{'x-api-key':'dummy-test-only'}});
      expect(mcpDoProjeto(other.id).some(x=>x.nome==='21st-dev')).toBe(false);
      await h.http().patch(`/api/mcp/${m.id}`).send({ativo:false}).expect(200);
      expect(mcpDoProjeto(p.id).some(x=>x.nome==='21st-dev')).toBe(false);
    }finally{await h.http().delete(`/api/mcp/${m.id}`).expect(200);}
  });

  it('formatos do ChatGPT (Codex) e do Gemini', () => {
    const mcp = [
      { nome: 'nav', tipo: 'comando' as const, comando: 'npx', args: ['-y', '@playwright/mcp@latest'], env: { A: 'x"y' } },
      { nome: 'docs', tipo: 'http' as const, url: 'https://mcp.exemplo.com/mcp', headers: { Authorization: 'Bearer t' } },
    ];
    expect(argsCodex(mcp)).toEqual([
      '-c', 'mcp_servers.nav.command="npx"',
      '-c', 'mcp_servers.nav.args=["-y","@playwright/mcp@latest"]',
      '-c', 'mcp_servers.nav.env={"A"="x\\"y"}',
      '-c', 'mcp_servers.docs.url="https://mcp.exemplo.com/mcp"',
      '-c', 'mcp_servers.docs.http_headers={"Authorization"="Bearer t"}',
    ]);
    expect(serversGemini(mcp)).toEqual({
      nav: { command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: { A: 'x"y' }, trust: true },
      docs: { httpUrl: 'https://mcp.exemplo.com/mcp', headers: { Authorization: 'Bearer t' }, trust: true },
    });
  });
});
