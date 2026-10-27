/**
 * Critério V1: recuperação após reinício do worker.
 * Usa processos worker REAIS (dist/worker.js) e os mata com SIGKILL no meio da execução.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, killHard, spawnNode, truncateAll, waitFor } from '../support/harness';
import { resumableCounter } from '../support/scripts';

describe('Recuperação após reinício do worker', () => {
  let h: Harness;
  const children: any[] = [];
  beforeAll(async () => {
    h = await createHarness(); // API em processo; nenhum worker em processo
    await truncateAll(h.prisma);
  });
  afterAll(async () => {
    for (const c of children) await killHard(c);
    await h.close();
  });

  it('worker morto (SIGKILL) durante a etapa: novo worker recupera pelo lease e conclui sem perder progresso', async () => {
    const p = await createProject(h, 'Reinício');
    const job = (
      await h
        .http()
        .post(`/api/projects/${p.id}/jobs`)
        .send({
          title: 'longo',
          objective: 'Processar 15 blocos mesmo com quedas do worker.',
          steps: [{ key: 'processar', instructions: resumableCounter(15) }],
          criteria: [{ key: 'final', description: 'todos os blocos', kind: 'COMMAND', config: { command: 'grep -q total=15 out/final.txt' } }],
        })
        .expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);

    const workerA = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-A', NIVOO_LEASE_MS: '3000' });
    children.push(workerA);
    const wt = path.join(p.workspacePath, 'worktrees', job.id);
    const progress = () => Number(fs.readFileSync(path.join(wt, 'out', 'progress.txt'), 'utf8'));
    await waitFor(async () => fs.existsSync(path.join(wt, 'out', 'progress.txt')) && progress() >= 3, 30000, 100);
    const attemptA = await waitFor(() => h.prisma.attempt.findFirst({ where: { jobId: job.id, pid: { not: null } } }));

    await killHard(workerA);
    const killedAt = progress();
    // Estado no banco permanece "em execução" — ninguém o limpou.
    const stale = await h.prisma.attempt.findUniqueOrThrow({ where: { id: attemptA.id } });
    expect(stale.status).toBe('EXECUTANDO');
    expect(stale.workerId).toBe('worker-A');

    const workerB = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-B', NIVOO_LEASE_MS: '3000' });
    children.push(workerB);
    const done = await waitFor(async () => {
      const j = await h.prisma.job.findUnique({ where: { id: job.id } });
      return j && ['CONCLUIDO', 'FALHOU', 'BLOQUEADO'].includes(j.status) ? j : null;
    }, 60000, 300);
    expect(done.status).toBe('CONCLUIDO');

    const attempts = await h.prisma.attempt.findMany({ where: { jobId: job.id }, orderBy: { number: 'asc' } });
    expect(attempts.map((a) => [a.workerId, a.status])).toEqual([
      ['worker-A', 'INTERROMPIDA'],
      ['worker-B', 'SUCESSO'],
    ]);
    expect(attempts[0].error).toMatch(/worker perdido \(worker-A\)/);
    // O processo órfão foi encerrado; a nova tentativa partiu do progresso salvo.
    expect(attempts[1].output).toMatch(/inicio em (\d+)/);
    const resumedFrom = Number(/inicio em (\d+)/.exec(attempts[1].output!)![1]);
    expect(resumedFrom).toBeGreaterThanOrEqual(killedAt);
    expect(resumedFrom).toBeLessThan(15);
    const logs = await h.prisma.logEntry.findMany({ where: { jobId: job.id }, orderBy: { id: 'asc' } });
    const text = logs.map((l) => l.message).join('\n');
    expect(text).toMatch(/recuperada por worker-B/);
    expect(text).toMatch(/Recuperação: 1 tentativa\(s\) órfã\(s\) de worker-A/);
    const task = await h.prisma.queueTask.findFirst({ where: { jobId: job.id, type: 'RUN_STEP' } });
    expect(task!.claims).toBe(2);
  });
});
