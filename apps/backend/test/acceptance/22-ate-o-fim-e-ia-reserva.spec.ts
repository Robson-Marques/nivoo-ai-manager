/**
 * Trabalho que vai até o fim: trabalho aprovado na conversa não tem limite de sessões nem de tempo; a
 * conferência que usa um programa inexistente no servidor para na hora, com o motivo (em vez de gastar
 * sessões); e a IA reserva assume sozinha quando a IA do projeto fica sem limite — no trabalho e na conversa.
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

describe('Até o fim: sem limite de sessões, conferência impossível e IA reserva', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    for (const c of (await h.http().get('/api/accounts')).body) await h.http().delete(`/api/accounts/${c.id}`);
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
  });
  const fim = (pid: string, jid: string) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${jid}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 40_000);
  const resposta = (pid: string, cid: string, n: number) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body;
      const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
      return r.length >= n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
    });

  it('plano aprovado na conversa: sem limite de sessões nem de tempo (o plano da IA não impõe limites)', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Sem limites', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl(
      'resposta.txt',
      '```json\n' +
        JSON.stringify({
          tipo: 'plano', texto: 'ok',
          job: { title: 'longo', objective: 'x', limits: { maxSessionsPerStep: 2, maxDurationSec: 60 }, steps: [{ key: 's', instructions: 'x', verifyCommand: 'true' }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] },
          memoria: [],
        }) + '\n```',
    );
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'faça' }).expect(201);
    const plano = await resposta(p.id, c.id, 1);
    const aprovado = (await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson', start: false }).expect(201)).body;
    const job = await h.prisma.job.findUniqueOrThrow({ where: { id: aprovado.messages.find((m: any) => m.id === plano.id).jobId } });
    expect([job.maxSessionsPerStep, job.maxDurationSec, job.maxAttemptsPerStep]).toEqual([0, 0, 10]);
    ctl('mode', null);
  });

  it('conferência com programa inexistente: para na 1ª tentativa e diz qual programa falta', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Sem rg', provider: 'claude-code-cli' }).expect(201)).body;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'auditoria', objective: 'x', defaultProvider: 'claude-code-cli', conferencia: false,
        steps: [{ key: 'doc', instructions: 'escreva', verifyCommand: 'programa-que-nao-existe-xyz docs/' }],
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const r = await fim(p.id, j.id);
    expect(r.status).toBe('BLOQUEADO');
    expect(r.blockedReason).toBe('VERIFICACAO_IMPOSSIVEL');
    expect(r.statusDetail).toMatch(/usa "programa-que-nao-existe-xyz", que não existe no servidor/);
    expect(r.attempts).toHaveLength(1);
  });

  it('IA reserva: sem limite na conta do Claude, o trabalho continua sozinho com a reserva (Claude API)', async () => {
    await h.http().post('/api/accounts').send({ tipo: 'claude-api', nome: 'Claude API reserva' }).expect(201);
    await h.http().post('/api/accounts/claude-api/key').send({ key: 'sk-ant-api03-CHAVE-RESERVA-0123456789' }).expect(201);
    const p = (await h.http().post('/api/projects').send({ name: 'Com reserva', provider: 'claude-code-cli' }).expect(201)).body;
    await h.http().patch(`/api/projects/${p.id}`).send({ reserva: ['nao-existe'] }).expect(400);
    expect((await h.http().patch(`/api/projects/${p.id}`).send({ reserva: ['claude-api'] }).expect(200)).body.aiReserva).toEqual(['claude-api']);
    ctl('mode', 'limit_conta');
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'continua', objective: 'x', defaultProvider: 'claude-code-cli', conferencia: false,
        steps: [{ key: 's', instructions: 'faça', verifyCommand: 'true' }],
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const r = await fim(p.id, j.id);
    expect(r.status).toBe('CONCLUIDO');
    expect(r.attempts.map((a: any) => [a.provider, a.status])).toEqual([
      ['claude-code-cli', 'RECURSO_INDISPONIVEL'],
      ['claude-api', 'SUCESSO'],
    ]);
    expect((await h.http().get(`/api/projects/${p.id}`)).body.provider).toBe('claude-api');
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logs).toMatch(/Claude \(conta\) ficou indisponível .* O trabalho continua com Claude API reserva/);

    // Na conversa: a conta do Claude sem limite no meio da resposta → a reserva responde, e a conversa avisa.
    await h.http().patch(`/api/projects/${p.id}`).send({ provider: 'claude-code-cli', reserva: ['claude-api'] }).expect(200);
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'oi' }).expect(201);
    const m = await resposta(p.id, c.id, 1);
    expect(m.status).toBe('PRONTA');
    expect(m.content).toBe('feito'); // respondida pela reserva (o stub da API responde "feito")
    const todas = (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
    expect(todas.find((x: any) => x.kind === 'sistema').content).toMatch(/^Claude \(conta\) ficou indisponível .*Quem responde agora é Claude API reserva/);
    expect((await h.http().get(`/api/projects/${p.id}`)).body.provider).toBe('claude-api');
    ctl('logged_in', null);
    ctl('mode', null);
  });
});
