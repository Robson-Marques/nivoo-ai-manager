/**
 * Critério V1: isolamento entre projetos (dados, rotas, workspaces, artefatos, memória, caminhos).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

describe('Isolamento entre projetos', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(() => h.close());

  it('jobs, artefatos, memória, datasets e workspaces de A não são acessíveis por B', async () => {
    const a = await createProject(h, 'Projeto A');
    const b = await createProject(h, 'Projeto B');
    expect(a.workspacePath).not.toBe(b.workspacePath);

    const jobA = (
      await h.http().post(`/api/projects/${a.id}/jobs`).send({
        title: 'segredo A',
        objective: 'o',
        // Registra o diretório de trabalho e de dados visto pela etapa.
        steps: [{ key: 's', instructions: 'pwd > out/cwd.txt && echo "$NIVOO_DATA_DIR" > out/data.txt && echo "dado de A" > out/a.txt' }],
        criteria: [{ key: 'c', description: 'c', kind: 'ARTIFACT_PRESENT', config: { name: 'a.txt' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${a.id}/jobs/${jobA.id}/start`).expect(201);
    const done = await waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${a.id}/jobs/${jobA.id}`)).body;
      return j.status === 'CONCLUIDO' ? j : null;
    });
    const art = done.artifacts.find((x: any) => x.name === 'a.txt');

    // Rotas com o id de B não enxergam recursos de A.
    await h.http().get(`/api/projects/${b.id}/jobs/${jobA.id}`).expect(404);
    await h.http().get(`/api/projects/${b.id}/jobs/${jobA.id}/logs`).expect(404);
    await h.http().post(`/api/projects/${b.id}/jobs/${jobA.id}/interrupt`).expect(404);
    await h.http().get(`/api/projects/${b.id}/artifacts/${art.id}`).expect(404);
    expect((await h.http().get(`/api/projects/${b.id}/jobs`)).body).toHaveLength(0);
    expect((await h.http().get(`/api/projects/${b.id}/artifacts`)).body).toHaveLength(0);
    const memB = (await h.http().get(`/api/projects/${b.id}/memory`)).body;
    expect(memB.every((m: any) => m.projectId === b.id)).toBe(true);

    // Memória de B não pode referenciar artefato de A.
    await h.http().post(`/api/projects/${b.id}/memory`).send({
      category: 'EVIDENCIA', title: 'roubo', content: 'x',
      references: { artifactIds: [art.id], gitCommit: 'x', parameters: {}, datasetIds: [] },
    }).expect(400);

    // A etapa rodou no worktree de A e recebeu o diretório de dados de A.
    const cwd = fs.readFileSync(path.join(a.workspacePath, 'worktrees', jobA.id, 'out', 'cwd.txt'), 'utf8').trim();
    expect(fs.realpathSync(cwd)).toBe(fs.realpathSync(path.join(a.workspacePath, 'worktrees', jobA.id)));
    const dataDir = fs.readFileSync(path.join(a.workspacePath, 'worktrees', jobA.id, 'out', 'data.txt'), 'utf8').trim();
    expect(dataDir).toBe(path.join(a.workspacePath, 'data'));
    expect(fs.existsSync(path.join(b.workspacePath, 'worktrees', jobA.id))).toBe(false);

    // Artefatos armazenados em diretórios separados por projeto.
    const storedA = await h.prisma.artifact.findMany({ where: { projectId: a.id } });
    expect(storedA.every((x) => x.storagePath.startsWith(a.id))).toBe(true);
  });

  it('PathGuard impede datasets e critérios fora do diretório autorizado', async () => {
    const a = await createProject(h, 'Projeto C');
    const b = await createProject(h, 'Projeto D');
    fs.writeFileSync(path.join(b.workspacePath, 'data', 'privado.csv'), 'timestamp,open,high,low,close,volume\n');
    await h.http().post(`/api/projects/${a.id}/datasets`).send({ name: 'x', assetCode: 'WIN', uri: '../../projeto-d/data/privado.csv' }).expect(403);
    await h.http().post(`/api/projects/${a.id}/datasets`).send({ name: 'y', assetCode: 'WIN', uri: '/etc/passwd' }).expect(403);
    // Symlink dentro de data/ apontando para fora também é bloqueado.
    fs.symlinkSync(path.join(b.workspacePath, 'data'), path.join(a.workspacePath, 'data', 'link'));
    await h.http().post(`/api/projects/${a.id}/datasets`).send({ name: 'z', assetCode: 'WIN', uri: 'link/privado.csv' }).expect(403);

    const job = (await h.http().post(`/api/projects/${a.id}/jobs`).send({
      title: 'escape', objective: 'o',
      steps: [{ key: 's', instructions: 'true' }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: '../../../projeto-d/data/privado.csv' } }],
    })).body;
    await h.http().post(`/api/projects/${a.id}/jobs/${job.id}/start`).expect(201);
    const j = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${a.id}/jobs/${job.id}`)).body;
      return x.status === 'BLOQUEADO' ? x : null;
    });
    expect(j.criteria[0].checks[0].evidence.erro).toMatch(/fora do diretório autorizado/);
  });
});
