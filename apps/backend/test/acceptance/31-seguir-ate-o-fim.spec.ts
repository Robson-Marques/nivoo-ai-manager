/**
 * Seguir até o fim: depois que o usuário aprova um pedido, a entrega que ainda tem parte do pedido por fazer traz o
 * plano do que falta e ele COMEÇA SOZINHO (sem o "Fazer"). Pedido novo continua esperando a aprovação; com "seguir
 * sozinho" desligado no projeto, tudo espera. A IA é orientada a conferir com os testes e o build reais do projeto
 * (quem roda é o sistema) e a não pedir ao usuário o que o sistema faz.
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
const parte = (letra: string) => ({
  title: `Parte ${letra}`,
  objective: `fazer a parte ${letra}`,
  // A conferência "instala dependências" (como um npm ci): node_modules e cache somem na limpeza do fim do trabalho.
  steps: [{ key: `p${letra}`, title: `Parte ${letra}`, instructions: `echo ${letra} > parte-${letra}.txt`, verifyCommand: `test -f parte-${letra}.txt && mkdir -p node_modules/pacote lib/.pytest_cache && echo x > node_modules/pacote/i.js && echo y > lib/.pytest_cache/c` }],
  criteria: [{ key: letra, description: letra, kind: 'FILE_EXISTS', config: { path: `parte-${letra}.txt` } }],
});

describe('Seguir até o fim', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const f of ['mode', 'resposta.txt']) ctl(f, null);
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
  });

  const mensagens = async (pid: string, cid: string) => (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body.messages;

  it('a entrega com parte do pedido por fazer emenda o próximo plano e ele começa sozinho até concluir tudo', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Até o fim', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', json({ tipo: 'plano', texto: 'Começo pela parte A.', continuacao: false, job: parte('A'), memoria: [] }));
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'faça as partes A e B' }).expect(201);
    const plano = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.kind === 'plano' && m.status === 'PRONTA') ?? null);
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toMatch(/TESTES e o BUILD reais do projeto/);
    expect(prompt).toMatch(/Nunca peça ao usuário para fazer o que o sistema faz/);
    expect(prompt).not.toMatch(/NUNCA rg, jq, python, node, npm/);
    expect(plano.approvedAt).toBeNull(); // pedido novo: espera o "Fazer"
    // A entrega da parte A traz o plano da parte B (continuação): começa sozinha.
    ctl('resposta.txt', json({ tipo: 'plano', texto: 'Parte A pronta. Sigo com a parte B.', continuacao: true, job: parte('B'), memoria: [] }));
    ctl('mode', 'bash');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson' }).expect(201);
    const planoB = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.kind === 'plano' && m.id !== plano.id && m.jobId) ?? null, 60_000);
    expect(planoB.approvedBy).toBe('Nivoo (seguindo o seu pedido)');
    // Entrega da parte B: pedido completo, só o resumo.
    ctl('resposta.txt', json({ tipo: 'resposta', texto: 'Partes A e B prontas.', memoria: [] }));
    const fimB = await waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${p.id}/jobs/${planoB.jobId}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(j.status) ? j : null;
    }, 60_000);
    expect(fimB.status).toBe('CONCLUIDO');
    const final = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.kind === 'entrega' && m.jobId === planoB.jobId && m.status === 'PRONTA') ?? null, 60_000);
    ctl('mode', null);
    expect(final.content).toContain('Partes A e B prontas.');
    const ms = await mensagens(p.id, c.id);
    expect(ms.filter((m: any) => m.kind === 'plano')).toHaveLength(2); // nenhum plano a mais depois do fim
    const jobA = ms.find((m: any) => m.id === plano.id).jobId;
    expect(ms.find((m: any) => m.kind === 'entrega' && m.jobId === jobA)?.content).toContain('Parte A pronta. Sigo com a parte B.');
    const repo = path.join(p.workspacePath, 'repo');
    expect(fs.readFileSync(path.join(repo, 'parte-A.txt'), 'utf8')).toBe('A\n');
    expect(fs.readFileSync(path.join(repo, 'parte-B.txt'), 'utf8')).toBe('B\n');
    // Limpeza do fim do trabalho: dependências e caches fora da pasta do trabalho; nada disso entrou no projeto.
    const wtB = path.join(p.workspacePath, 'worktrees', planoB.jobId);
    expect(fs.existsSync(path.join(wtB, 'parte-B.txt'))).toBe(true);
    expect(fs.existsSync(path.join(wtB, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(wtB, 'lib', '.pytest_cache'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'node_modules'))).toBe(false);
    const logsB = (await h.http().get(`/api/projects/${p.id}/jobs/${planoB.jobId}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logsB).toMatch(/Limpeza: .*node_modules.*apagado/);
  });

  it('com "seguir sozinho" desligado, a continuação espera o "Fazer"', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Espera', provider: 'claude-code-cli' }).expect(201)).body;
    await h.http().patch(`/api/projects/${p.id}`).send({ seguirSozinho: false }).expect(200);
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', json({ tipo: 'plano', texto: 'Parte A.', continuacao: false, job: parte('A'), memoria: [] }));
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'faça A e B' }).expect(201);
    const plano = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.kind === 'plano' && m.status === 'PRONTA') ?? null);
    ctl('resposta.txt', json({ tipo: 'plano', texto: 'Sigo com a B.', continuacao: true, job: parte('B'), memoria: [] }));
    ctl('mode', 'bash');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson' }).expect(201);
    const planoB = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.kind === 'plano' && m.id !== plano.id) ?? null, 60_000);
    ctl('mode', null);
    await new Promise((r) => setTimeout(r, 1500));
    const agora = (await mensagens(p.id, c.id)).find((m: any) => m.id === planoB.id);
    expect(agora.jobId).toBeNull();
    expect(agora.approvedAt).toBeNull();
  });
  it('a IA pergunta com opções de clicar: perguntas validadas (1 a 4, 2 a 4 opções), sem opção sozinha', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Perguntas', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', json({
      tipo: 'resposta', texto: 'Preciso de uma decisão sua.', memoria: [],
      perguntas: [
        { pergunta: 'Qual versão publicar agora?', opcoes: [{ rotulo: '0.12.0 (recomendado)', descricao: 'segue o padrão' }, { rotulo: '0.11.96', descricao: 'continua a antiga' }] },
        { pergunta: 'Pergunta sem opções suficientes', opcoes: ['só uma'] },
        { pergunta: 'Onde publicar?', opcoes: ['GitLab', 'GitHub', 'Os dois'], multipla: true },
      ],
    }));
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'publica' }).expect(201);
    const r = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.role === 'ASSISTENTE' && m.status === 'PRONTA') ?? null);
    ctl('mode', null);
    expect(r.content).toBe('Preciso de uma decisão sua.');
    expect(r.perguntas).toEqual([
      { pergunta: 'Qual versão publicar agora?', opcoes: [{ rotulo: '0.12.0 (recomendado)', descricao: 'segue o padrão' }, { rotulo: '0.11.96', descricao: 'continua a antiga' }], multipla: false },
      { pergunta: 'Onde publicar?', opcoes: [{ rotulo: 'GitLab', descricao: '' }, { rotulo: 'GitHub', descricao: '' }, { rotulo: 'Os dois', descricao: '' }], multipla: true },
    ]);
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toMatch(/PERGUNTAS COM OPÇÕES[\s\S]*"perguntas"/);
  });
  it('perguntas e plano juntos: só as perguntas aparecem; o plano espera as respostas (nada começa sozinho)', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Espera respostas', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', json({
      tipo: 'plano', texto: 'Posso apagar o Caddy.', continuacao: true, job: parte('A'), memoria: [],
      perguntas: [{ pergunta: 'Algum servidor usa o Caddy?', opcoes: ['Nenhum usa, pode apagar', 'Vou conferir'] }],
    }));
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'limpe' }).expect(201);
    const r = await waitFor(async () => (await mensagens(p.id, c.id)).find((m: any) => m.role === 'ASSISTENTE' && m.status === 'PRONTA') ?? null);
    ctl('mode', null);
    expect(r.kind).toBe('resposta');
    expect(r.plan).toBeNull();
    expect(r.perguntas).toHaveLength(1);
    expect(r.content).toMatch(/Depois das suas respostas, eu mando o plano\./);
    expect((await h.http().get(`/api/projects/${p.id}/jobs`)).body).toHaveLength(0);
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toMatch(/NUNCA mande "perguntas" e plano na mesma resposta/);
  });
});
