/**
 * Critério V1: interrupção e retomada sem perda do estado.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';
import { resumableCounter } from '../support/scripts';

describe('Interrupção e retomada', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(() => h.close());

  it('interrompe etapa em execução, preserva estado e retoma do ponto onde parou', async () => {
    const p = await createProject(h, 'Interrupção');
    const job = (
      await h
        .http()
        .post(`/api/projects/${p.id}/jobs`)
        .send({
          title: 'contagem longa',
          objective: 'Processar 12 blocos de dados sem perder progresso.',
          steps: [
            { key: 'preparar', instructions: 'echo preparado > out/preparo.txt' },
            { key: 'processar', dependsOn: ['preparar'], instructions: resumableCounter(12) },
          ],
          criteria: [
            { key: 'final', description: 'todos os blocos', kind: 'COMMAND', config: { command: 'grep -q total=12 out/final.txt' } },
            { key: 'artefato', description: 'progresso registrado', kind: 'ARTIFACT_PRESENT', config: { name: 'final.txt' } },
          ],
        })
        .expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    const wt = path.join(p.workspacePath, 'worktrees', job.id);
    const progress = () => Number(fs.readFileSync(path.join(wt, 'out', 'progress.txt'), 'utf8'));
    await waitFor(async () => fs.existsSync(path.join(wt, 'out', 'progress.txt')) && progress() >= 3, 20000, 100);

    const interrupted = await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/pause`).send({ by: 'teste' }).expect(201);
    expect(interrupted.body.status).toBe('BLOQUEADO');
    expect(interrupted.body.blockedReason).toBe('PAUSADO');
    expect(interrupted.body.statusDetail).toBe('pausado por teste');

    // Worker detecta a perda do lease, encerra o processo e registra a tentativa como INTERROMPIDA.
    const after = await waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${p.id}/jobs/${job.id}`)).body;
      return j.attempts.some((a: any) => a.status === 'INTERROMPIDA') && j.steps[1].status === 'PENDENTE' ? j : null;
    }, 15000);
    const stopAt = progress();
    expect(stopAt).toBeGreaterThanOrEqual(3);
    expect(stopAt).toBeLessThan(12);
    await new Promise((r) => setTimeout(r, 1500));
    expect(progress()).toBe(stopAt); // processo realmente parou
    expect(after.status).toBe('BLOQUEADO');
    expect(after.steps[0].status).toBe('CONCLUIDO'); // trabalho concluído preservado
    expect(after.objectives).toHaveLength(1);
    expect(after.checkpoints.some((c: any) => /interrompido/.test(c.label))).toBe(true);
    expect(await h.prisma.queueTask.count({ where: { jobId: job.id, status: { in: ['QUEUED', 'RUNNING'] } } })).toBe(0);
    const report = (await h.http().get(`/api/projects/${p.id}/jobs/${job.id}/report`).expect(200)).body;
    expect(report.concluido).toBe(false);
    expect(report.etapasPendentes.map((s: any) => s.key)).toEqual(['processar']);

    // Retomada
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/resume`).send({ by: 'teste' }).expect(201);
    const done = await waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${p.id}/jobs/${job.id}`)).body;
      return ['CONCLUIDO', 'FALHOU'].includes(j.status) || (j.status === 'BLOQUEADO' && j.blockedReason !== 'PAUSADO') ? j : null;
    }, 30000);
    expect(done.status).toBe('CONCLUIDO');
    const stepAttempts = done.attempts.filter((a: any) => a.stepId === done.steps[1].id);
    expect(stepAttempts.map((a: any) => a.status)).toEqual(['INTERROMPIDA', 'SUCESSO']);
    // A segunda tentativa começou do progresso salvo, não do zero.
    expect(stepAttempts[1].output).toContain(`inicio em ${stopAt}`);
    expect(stepAttempts[1].output).not.toMatch(/^passo 1$/m);
    expect(fs.readFileSync(path.join(wt, 'out', 'final.txt'), 'utf8').trim()).toBe('total=12');
    // Preparação não foi refeita.
    expect(done.attempts.filter((a: any) => a.stepId === done.steps[0].id)).toHaveLength(1);
  });
});
