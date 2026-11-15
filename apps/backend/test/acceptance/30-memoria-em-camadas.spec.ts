/**
 * Memória em camadas: a do PROJETO (o que o usuário vê) tem uma entrada por assunto — o mesmo assunto atualiza o
 * item, a versão anterior fica no histórico; as notas das sessões da IA, as lições e o registro de trabalhos vão
 * para a memória INTERNA do processo (a IA usa, o painel não mistura). O arquivo memoria/MEMORIA.md na pasta do
 * projeto é regravado a cada mudança.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```';

describe('Memória em camadas', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    ctl('mode', null);
    ctl('resposta.txt', null);
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
  });

  const responder = async (pid: string, cid: string, texto: string, n: number) => {
    await h.http().post(`/api/projects/${pid}/conversations/${cid}/messages`).send({ content: texto }).expect(201);
    return waitFor(async () => {
      const ms = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
      return ms.length >= n && ms[n - 1].status !== 'PENDENTE' ? ms[n - 1] : null;
    });
  };

  it('um item por assunto: mudar atualiza (histórico guardado), repetir não duplica; MEMORIA.md acompanha', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Memória', provider: 'claude-code-cli', description: 'Loja de pizzas do bairro.' }).expect(201)).body;
    const arq = path.join(p.workspacePath, 'memoria', 'MEMORIA.md');
    expect(fs.readFileSync(arq, 'utf8')).toMatch(/## Sobre o projeto[\s\S]*Loja de pizzas do bairro\./);
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', json({ tipo: 'resposta', texto: 'Anotado.', memoria: [{ tipo: 'DECISAO', titulo: 'Banco de dados', conteudo: 'Usar SQLite.' }, { tipo: 'PREFERENCIA', titulo: 'Tom das peças', conteudo: 'Alegre.' }] }));
    await responder(p.id, c.id, 'use sqlite e tom alegre', 1);
    // O usuário muda de ideia: mesmo assunto, conteúdo novo; e a IA repete o tom igual (não pode duplicar).
    ctl('resposta.txt', json({ tipo: 'resposta', texto: 'Trocado.', memoria: [{ tipo: 'DECISAO', titulo: 'Banco de dados', conteudo: 'Usar PostgreSQL (trocado do SQLite).' }, { tipo: 'PREFERENCIA', titulo: 'tom das peças', conteudo: 'Alegre.' }] }));
    await responder(p.id, c.id, 'na verdade use postgres', 2);
    ctl('mode', null);
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`).expect(200)).body;
    const banco = mem.filter((m: any) => m.title === 'Banco de dados');
    expect(banco).toHaveLength(1);
    expect(banco[0]).toMatchObject({ content: 'Usar PostgreSQL (trocado do SQLite).', version: 2, camada: 'PROJETO', chave: 'banco-de-dados' });
    expect(mem.filter((m: any) => /tom das pe/i.test(m.title))).toHaveLength(1);
    const historico = (await h.http().get(`/api/projects/${p.id}/memory?all=1`).expect(200)).body.filter((m: any) => m.chave === 'banco-de-dados');
    expect(historico.map((m: any) => m.content).sort()).toEqual(['Usar PostgreSQL (trocado do SQLite).', 'Usar SQLite.']);
    const md = fs.readFileSync(arq, 'utf8');
    expect(md).toMatch(/## Decisões\n\n### Banco de dados\n\nUsar PostgreSQL \(trocado do SQLite\)\./);
    expect(md).not.toContain('Usar SQLite.');
    expect(md).toMatch(/## Preferências e regras[\s\S]*### Tom das peças/);
  });

  it('notas das sessões, lições e registro de trabalho vão para a memória interna, fora do painel e do MEMORIA.md', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Interna', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const nota = (t: string, c: string) => JSON.stringify({ tipo: t, titulo: c, conteudo: c }).replace(/"/g, '\\"');
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'Relatório', objective: 'relatório', defaultProvider: 'claude-code-cli', conferencia: false,
        steps: [{ key: 'r', instructions: `mkdir -p .nivoo && echo "${nota('PROGRESSO', 'li 40 arquivos')}" >> .nivoo/notas.jsonl && echo "${nota('PENDENCIA', 'falta ver os testes')}" >> .nivoo/notas.jsonl && echo ok > relatorio.md`, verifyCommand: 'test -f relatorio.md' }],
        criteria: [{ key: 'r', description: 'r', kind: 'FILE_EXISTS', config: { path: 'relatorio.md' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await waitFor(async () => {
      const y = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(y.status) ? y : null;
    }, 30_000);
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    expect((await h.http().get(`/api/projects/${p.id}/memory`).expect(200)).body).toEqual([]); // o painel não vira pilha
    const interna = (await h.http().get(`/api/projects/${p.id}/memory?camada=INTERNA`).expect(200)).body;
    expect(interna.map((m: any) => m.title)).toEqual(expect.arrayContaining(['li 40 arquivos', 'falta ver os testes', 'Resultado do trabalho "Relatório"']));
    expect(interna.every((m: any) => m.camada === 'INTERNA')).toBe(true);
    expect(fs.readFileSync(path.join(p.workspacePath, 'memoria', 'MEMORIA.md'), 'utf8')).not.toContain('li 40 arquivos');
    expect(fs.readFileSync(path.join(p.workspacePath, 'memoria', 'interna.md'), 'utf8')).toContain('li 40 arquivos');
    // Pela API, título repetido também atualiza em vez de empilhar.
    await h.http().post(`/api/projects/${p.id}/memory`).send({ category: 'DECISAO_APROVADA', title: 'Hospedagem', content: 'Servidor próprio.' }).expect(201);
    await h.http().post(`/api/projects/${p.id}/memory`).send({ category: 'DECISAO_APROVADA', title: 'Hospedagem', content: 'Servidor próprio, Debian 13.' }).expect(201);
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`).expect(200)).body;
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ title: 'Hospedagem', content: 'Servidor próprio, Debian 13.', version: 2 });
  });
});
