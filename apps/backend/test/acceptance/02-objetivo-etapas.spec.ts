/**
 * Critério V1: persistência do objetivo (imutável e versionado) e das etapas/dependências.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createHarness, createProject, Harness, truncateAll } from '../support/harness';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Objetivo versionado e etapas persistentes', () => {
  let h: Harness;
  let pid: string;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    pid = (await createProject(h, 'Objetivos')).id;
  });
  afterAll(() => h.close());

  const body = {
    title: 'Levantamento de sazonalidade WDO',
    objective: 'Medir retorno médio por faixa horária do WDO em 2025 com dados validados.',
    steps: [
      { key: 'coletar', title: 'Coletar', instructions: 'echo coletar' },
      { key: 'limpar', title: 'Limpar', instructions: 'echo limpar', dependsOn: ['coletar'] },
      { key: 'medir', title: 'Medir', instructions: 'echo medir', dependsOn: ['limpar'], verifyCommand: 'true' },
    ],
    criteria: [{ key: 'relatorio', description: 'relatório gerado', kind: 'ARTIFACT_PRESENT', config: { name: 'relatorio.md' } }],
    limits: { maxAttemptsPerStep: 4, maxDurationSec: 600, maxCostUsd: 2 },
  };

  it('persiste objetivo v1 com hash, etapas, dependências, critérios e limites', async () => {
    const res = await h.http().post(`/api/projects/${pid}/jobs`).send(body).expect(201);
    const job = res.body;
    expect(job.status).toBe('PENDENTE');
    expect(job.objectives).toHaveLength(1);
    expect(job.objectives[0]).toMatchObject({ version: 1, text: body.objective, sha256: sha(body.objective) });
    expect(job.steps.map((s: any) => [s.key, s.dependsOn])).toEqual([
      ['coletar', []],
      ['limpar', ['coletar']],
      ['medir', ['limpar']],
    ]);
    expect(job.maxAttemptsPerStep).toBe(4);
    expect(job.gitBranch).toBe(`job/${job.id}`);

    // Leitura por uma conexão independente (estado está no banco, não em memória do processo).
    const fresh = new PrismaClient();
    try {
      const stored = await fresh.job.findUniqueOrThrow({ where: { id: job.id }, include: { steps: true, objectives: true, criteria: true } });
      expect(stored.steps).toHaveLength(3);
      expect(stored.criteria[0].kind).toBe('ARTIFACT_PRESENT');
      expect(stored.objectives[0].text).toBe(body.objective);
    } finally {
      await fresh.$disconnect();
    }
  });

  it('nova versão do objetivo é append-only: v1 permanece intacta', async () => {
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send(body).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/objective`).send({ text: 'novo' }).expect(400); // motivo obrigatório
    const v2 = await h
      .http()
      .post(`/api/projects/${pid}/jobs/${job.id}/objective`)
      .send({ text: 'Medir retorno por faixa horária do WDO em 2024 e 2025.', reason: 'ampliar amostra', author: 'pesquisador' })
      .expect(201);
    expect(v2.body.objectiveVersion).toBe(2);
    expect(v2.body.objectives.map((o: any) => o.version)).toEqual([1, 2]);
    expect(v2.body.objectives[0].text).toBe(body.objective);
    expect(v2.body.objectives[0].sha256).toBe(sha(body.objective));
    expect(v2.body.objectives[1].reason).toBe('ampliar amostra');
  });

  it('rejeita dependências inexistentes, ciclos e etapas duplicadas', async () => {
    const bad = (steps: any[]) => h.http().post(`/api/projects/${pid}/jobs`).send({ ...body, steps }).expect(400);
    await bad([{ key: 'a', instructions: 'true', dependsOn: ['x'] }]);
    await bad([
      { key: 'a', instructions: 'true', dependsOn: ['b'] },
      { key: 'b', instructions: 'true', dependsOn: ['a'] },
    ]);
    await bad([
      { key: 'a', instructions: 'true' },
      { key: 'a', instructions: 'true' },
    ]);
  });

  it('permite adicionar etapas e critérios depois, preservando os existentes', async () => {
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send(body).expect(201)).body;
    const r = await h
      .http()
      .post(`/api/projects/${pid}/jobs/${job.id}/steps`)
      .send({ steps: [{ key: 'publicar', instructions: 'echo ok', dependsOn: ['medir'] }] })
      .expect(201);
    expect(r.body.steps.map((s: any) => s.key)).toEqual(['coletar', 'limpar', 'medir', 'publicar']);
    const c = await h
      .http()
      .post(`/api/projects/${pid}/jobs/${job.id}/criteria`)
      .send({ criteria: [{ key: 'teste', description: 'testes passam', kind: 'COMMAND', config: { command: 'true' } }] })
      .expect(201);
    expect(c.body.criteria.map((x: any) => x.key)).toEqual(['relatorio', 'teste']);
  });
});
