/**
 * Servidores SSH: o Nivoo gera a chave (a privada nunca sai), e a IA só roda um comando num servidor depois que o
 * usuário PERMITE aquele comando. Conversa de verdade com a ferramenta MCP "servidores-ssh" (stdio).
 */
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mcpDoProjeto } from '../../src/mcp/mcp';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const dados = () => path.dirname(process.env.NIVOO_WORKSPACES_ROOT!);

/** Cliente MCP mínimo por stdio (pede e espera a resposta do mesmo id). */
function cliente(p: ChildProcessWithoutNullStreams) {
  let buf = '';
  const espera = new Map<number, (m: any) => void>();
  p.stdout.on('data', (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      espera.get(m.id)?.(m);
    }
  });
  let n = 0;
  return (method: string, params: any = {}) =>
    new Promise<any>((ok) => {
      const id = ++n;
      espera.set(id, ok);
      p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
}

describe('Servidores SSH com permissão a cada comando', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_SSH_BIN = path.join(__dirname, '..', 'support', 'stubs', 'ssh-stub.sh');
    h = await createHarness();
    await truncateAll(h.prisma);
    fs.rmSync(path.join(dados(), 'ssh.json'), { force: true });
  });
  afterAll(async () => {
    for (const s of (await h.http().get('/api/ssh/servidores')).body) await h.http().delete(`/api/ssh/servidores/${s.id}`);
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    await h.close();
    delete process.env.NIVOO_SSH_BIN;
  });

  it('chave gerada pelo Nivoo; teste do usuário; a IA pede, o usuário permite ou recusa; só os projetos escolhidos', async () => {
    const p1 = (await h.http().post('/api/projects').send({ name: 'Com servidor' }).expect(201)).body;
    const p2 = (await h.http().post('/api/projects').send({ name: 'Sem servidor' }).expect(201)).body;
    await h.http().post('/api/ssh/servidores').send({ nome: 'x', host: 'host; rm -rf /', usuario: 'root' }).expect(400);
    await h.http().post('/api/ssh/servidores').send({ nome: 'x', host: 'servidor.teste', usuario: 'root -o ProxyCommand=x' }).expect(400);
    const s = (await h.http().post('/api/ssh/servidores').send({ nome: 'Produção', host: 'servidor.teste', usuario: 'deploy', projetos: [p1.id] }).expect(201)).body;
    expect(s.chavePublica).toMatch(/^ssh-ed25519 \S+ nivoo-Producao$/);
    const segredos = fs.readFileSync(path.join(dados(), 'segredos.json'), 'utf8');
    expect(segredos).toContain('OPENSSH PRIVATE KEY');
    expect(JSON.stringify((await h.http().get('/api/ssh/servidores')).body)).not.toContain('PRIVATE KEY');
    expect((fs.statSync(path.join(dados(), 'ssh.json')).mode & 0o777).toString(8)).toBe('600');

    // Testar (ação do próprio usuário): login com a chave do Nivoo, sem prompt.
    const t = (await h.http().post(`/api/ssh/servidores/${s.id}/testar`).expect(201)).body;
    expect(t.ok).toBe(true);
    expect(t.saida).toMatch(/^nivoo-ok /);
    const args = fs.readFileSync(path.join(os.tmpdir(), 'ssh-stub-args.txt'), 'utf8');
    expect(args).toMatch(/-p 22 .*BatchMode=yes .*StrictHostKeyChecking=accept-new .*deploy@servidor\.teste --/);

    // Só o projeto escolhido recebe a ferramenta.
    expect(mcpDoProjeto(p1.id, { jobId: 'j' }).map((m) => m.nome)).toEqual(['servidores-ssh']);
    expect(mcpDoProjeto(p2.id)).toEqual([]);
    const ferramenta = mcpDoProjeto(p1.id, { jobId: 'job-1' })[0];
    expect(JSON.stringify(ferramenta)).not.toContain('PRIVATE KEY'); // a ferramenta da IA não tem a chave

    // A ferramenta da IA, de verdade (stdio).
    const proc = spawn(ferramenta.comando!, ferramenta.args!, { env: { ...process.env, ...ferramenta.env, NIVOO_SSH_INTERVALO_MS: '200' } });
    const pedir = cliente(proc);
    expect((await pedir('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('nivoo-servidores-ssh');
    expect((await pedir('tools/list')).result.tools.map((x: any) => x.name)).toEqual(['listar_servidores', 'executar_no_servidor']);
    expect((await pedir('tools/call', { name: 'listar_servidores', arguments: {} })).result.content[0].text).toBe('- Produção: deploy@servidor.teste');

    // 1) Pede: nada roda até permitir; aparece pendente para o usuário.
    const resposta1 = pedir('tools/call', { name: 'executar_no_servidor', arguments: { servidor: 'Produção', comando: 'echo ola-do-servidor', motivo: 'ver se responde' } });
    const pendente = await waitFor(async () => (await h.http().get(`/api/projects/${p1.id}/ssh/pedidos?status=PENDENTE`)).body[0] ?? null, 15_000);
    expect(pendente).toMatchObject({ servidorNome: 'Produção', comando: 'echo ola-do-servidor', motivo: 'ver se responde', jobId: 'job-1', status: 'PENDENTE' });
    await h.http().post(`/api/projects/${p1.id}/ssh/pedidos/${pendente.id}/decidir`).send({ permitir: true, por: 'Robson' }).expect(201);
    await h.http().post(`/api/projects/${p1.id}/ssh/pedidos/${pendente.id}/decidir`).send({ permitir: false }).expect(409); // só uma vez
    const r1 = (await resposta1).result;
    expect(r1.isError).toBeFalsy();
    expect(r1.content[0].text).toMatch(/Permitido por Robson e executado em Produção \(deploy@servidor\.teste\)\. Código de saída: 0\.\s+ola-do-servidor/);

    // 2) Recusado: a IA é avisada e o comando nunca roda.
    const marca = path.join(os.tmpdir(), `nao-rodou-${Date.now()}`);
    const resposta2 = pedir('tools/call', { name: 'executar_no_servidor', arguments: { servidor: 'Produção', comando: `touch ${marca}`, motivo: 'x' } });
    const p2d = await waitFor(async () => (await h.http().get(`/api/projects/${p1.id}/ssh/pedidos?status=PENDENTE`)).body[0] ?? null, 15_000);
    await h.http().post(`/api/projects/${p1.id}/ssh/pedidos/${p2d.id}/decidir`).send({ permitir: false, por: 'Robson' }).expect(201);
    const r2 = (await resposta2).result;
    expect(r2.isError).toBe(true);
    expect(r2.content[0].text).toMatch(/RECUSOU/);
    expect(fs.existsSync(marca)).toBe(false);

    // 3) Servidor não liberado.
    const r3 = (await pedir('tools/call', { name: 'executar_no_servidor', arguments: { servidor: 'Outro', comando: 'ls', motivo: 'x' } })).result;
    expect(r3.content[0].text).toMatch(/não está liberado para este projeto/);
    proc.kill();

    // 4) Ninguém responde a tempo: expira.
    const f2 = mcpDoProjeto(p1.id, { mensagemId: 'msg-1' })[0];
    const proc2 = spawn(f2.comando!, f2.args!, { env: { ...process.env, ...f2.env, NIVOO_SSH_ESPERA_SEG: '2', NIVOO_SSH_INTERVALO_MS: '200' } });
    const pedir2 = cliente(proc2);
    await pedir2('initialize');
    const r4 = (await pedir2('tools/call', { name: 'executar_no_servidor', arguments: { servidor: 'Produção', comando: 'uptime', motivo: 'x' } })).result;
    expect(r4.content[0].text).toMatch(/expirado/);
    proc2.kill();
    const todos = (await h.http().get(`/api/projects/${p1.id}/ssh/pedidos`)).body.map((x: any) => x.status);
    expect(todos).toEqual(['EXPIRADO', 'RECUSADO', 'EXECUTADO']);

    // Excluir o servidor apaga a chave.
    await h.http().delete(`/api/ssh/servidores/${s.id}`).expect(200);
    expect(fs.readFileSync(path.join(dados(), 'segredos.json'), 'utf8')).not.toContain('OPENSSH PRIVATE KEY');
  });
});
