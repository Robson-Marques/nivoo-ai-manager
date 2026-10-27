/**
 * SIMULADO (stub TEST-ONLY do CLI, test/support/stubs/claude-stub.sh) — NÃO comprova integração real.
 * Cobre no CI os caminhos de classificação que não podem ser provocados de forma confiável com o
 * provedor real: LIMITE DO PROVEDOR (usage limit) e sessões sem progresso. As provas reais estão
 * em test/integration/real-01..03.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};

describe('Classificação de término (SIMULADO com stub TEST-ONLY)', () => {
  let h: Harness;
  let pid: string;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    pid = (await createProject(h, 'stub sessoes')).id;
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
  });

  const body = (title: string) => ({
    title,
    objective: 'o',
    defaultProvider: 'claude-code-cli',
    limits: { maxSessionsPerStep: 3, repetitionWindow: 2 },
    steps: [{ key: 'a', instructions: 'x', verifyCommand: 'test -f out/feito.txt' }],
    criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'out/feito.txt' } }],
  });

  it('etapa de IA sem verificação determinística é recusada', async () => {
    const r = await h.http().post(`/api/projects/${pid}/jobs`).send({ ...body('sem verify'), steps: [{ key: 'a', instructions: 'x' }] }).expect(400);
    expect(r.body.message).toMatch(/exige verifyCommand/);
  });

  it('limite do provedor → AGUARDANDO_RECURSO (reagendado), não falha', async () => {
    ctl('mode', 'limit');
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send(body('limite')).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/start`).expect(201);
    const j = await waitFor(async () => {
      const x = await h.prisma.job.findUnique({ where: { id: job.id }, include: { attempts: true, tasks: true } });
      return x?.status === 'AGUARDANDO_RECURSO' ? x : null;
    });
    expect(j.attempts[0].status).toBe('RECURSO_INDISPONIVEL');
    expect(j.tasks.some((t: any) => t.status === 'QUEUED' && t.runAt > new Date())).toBe(true);
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/interrupt`).expect(201);
    ctl('mode', null);
  });

  it('sessões que terminam sem progresso → REPETICAO_IMPRODUTIVA; nunca CONCLUIDO', async () => {
    ctl('mode', 'max_turns');
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send(body('sem progresso')).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/start`).expect(201);
    const j = await waitFor(async () => {
      const x = await h.prisma.job.findUnique({ where: { id: job.id }, include: { attempts: true } });
      return x && ['BLOQUEADO', 'FALHOU', 'CONCLUIDO'].includes(x.status) ? x : null;
    });
    expect(j.status).toBe('BLOQUEADO');
    expect(j.blockedReason).toBe('REPETICAO_IMPRODUTIVA');
    expect(j.attempts.map((a: any) => a.status)).toEqual(['SESSAO_ENCERRADA', 'SESSAO_ENCERRADA']);
    expect(j.attempts.every((a: any) => a.sessionId === 'stub-sessao' && a.stopReason === 'max_turns')).toBe(true);
    ctl('mode', null);
  });
});
