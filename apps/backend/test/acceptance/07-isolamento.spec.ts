/**
 * Isolamento entre projetos (rotas, workspaces, conhecimento, artefatos, memória, caminhos).
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

  it('jobs, artefatos, memória, conhecimento e workspaces de A não são acessíveis por B', async () => {
    const a = await createProject(h, 'Projeto A');
    const b = await createProject(h, 'Projeto B');
    expect(a.workspacePath).not.toBe(b.workspacePath);

    const jobA = (
      await h.http().post(`/api/projects/${a.id}/jobs`).send({
        title: 'segredo A',
        objective: 'o',
        // Registra o diretório de trabalho visto pela etapa.
        steps: [{ key: 's', instructions: 'pwd > out/cwd.txt && echo "dado de A" > out/a.txt' }],
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
    await h.http().post(`/api/projects/${b.id}/jobs/${jobA.id}/pause`).expect(404);
    await h.http().get(`/api/projects/${b.id}/artifacts/${art.id}`).expect(404);
    expect((await h.http().get(`/api/projects/${b.id}/jobs`)).body).toHaveLength(0);
    expect((await h.http().get(`/api/projects/${b.id}/artifacts`)).body).toHaveLength(0);
    const memB = (await h.http().get(`/api/projects/${b.id}/memory`)).body;
    expect(memB.every((m: any) => m.projectId === b.id)).toBe(true);

    // Memória de B não pode referenciar artefato de A.
    await h.http().post(`/api/projects/${b.id}/memory`).send({
      category: 'EVIDENCIA', title: 'roubo', content: 'x',
      references: { artifactIds: [art.id], gitCommit: 'x' },
    }).expect(400);

    // A etapa rodou no worktree de A.
    const cwd = fs.readFileSync(path.join(a.workspacePath, 'worktrees', jobA.id, 'out', 'cwd.txt'), 'utf8').trim();
    expect(fs.realpathSync(cwd)).toBe(fs.realpathSync(path.join(a.workspacePath, 'worktrees', jobA.id)));

    // Conhecimento de A não é legível pela rota de B.
    await h.http().post(`/api/projects/${a.id}/knowledge/import`).send({ files: [{ path: 'segredo.md', contentBase64: Buffer.from('só de A').toString('base64') }] }).expect(201);
    await h.http().get(`/api/projects/${b.id}/knowledge/file?path=segredo.md`).expect(404);
    expect(fs.existsSync(path.join(b.workspacePath, 'worktrees', jobA.id))).toBe(false);

    // Artefatos armazenados em diretórios separados por projeto.
    const storedA = await h.prisma.artifact.findMany({ where: { projectId: a.id } });
    expect(storedA.every((x) => x.storagePath.startsWith(a.id))).toBe(true);
  });

  it('PathGuard impede conhecimento e critérios fora do diretório autorizado', async () => {
    const a = await createProject(h, 'Projeto C');
    const b = await createProject(h, 'Projeto D');
    const b64 = Buffer.from('x').toString('base64');
    await h.http().post(`/api/projects/${a.id}/knowledge/import`).send({ files: [{ path: '../../escape.md', contentBase64: b64 }] }).expect(400);
    await h.http().get(`/api/projects/${a.id}/knowledge/file?path=${encodeURIComponent('../../../' + path.basename(b.workspacePath) + '/conhecimento/x')}`).expect(400);
    // Link dentro do conhecimento apontando para outro projeto não é seguido.
    fs.symlinkSync(path.join(b.workspacePath, 'conhecimento'), path.join(a.workspacePath, 'conhecimento', 'link'));
    await h.http().get(`/api/projects/${a.id}/knowledge/file?path=link/README.md`).expect(403);

    const job = (await h.http().post(`/api/projects/${a.id}/jobs`).send({
      title: 'escape', objective: 'o',
      steps: [{ key: 's', instructions: 'true' }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: '../../../projeto-d/conhecimento/privado.md' } }],
    })).body;
    await h.http().post(`/api/projects/${a.id}/jobs/${job.id}/start`).expect(201);
    const j = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${a.id}/jobs/${job.id}`)).body;
      return x.status === 'BLOQUEADO' ? x : null;
    });
    expect(j.criteria[0].checks[0].evidence.erro).toMatch(/fora do diretório autorizado/);
  });
});
