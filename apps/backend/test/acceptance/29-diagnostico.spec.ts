/**
 * Diagnóstico para o suporte: o relatório do trabalho (etapas, tentativas, erro, conferência, log, IAs) e o do
 * sistema (worker, fila, trabalhos parados, erros registrados) — sempre sem segredos.
 */
import { registrarErro } from '../../src/diagnostico/erros';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

describe('Diagnóstico', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    await h.close();
  });

  it('trabalho parado: relatório completo e sem segredos; sistema: worker, fila, parados e erros', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Diag' }).expect(201)).body;
    const token = 'sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'Falha de propósito', objective: 'gerar relatorio.md', defaultProvider: 'local-shell', limits: { maxAttemptsPerStep: 1 },
        steps: [{ key: 'gera', title: 'Gerar o relatório', instructions: `echo "usando ${token}"; echo "Authorization: Bearer abcdefghijklmnop123"; exit 3`, verifyCommand: 'test -f relatorio.md' }],
        criteria: [{ key: 'r', description: 'relatório existe', kind: 'FILE_EXISTS', config: { path: 'relatorio.md' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 30_000);
    const r = await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/diagnostico`).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/markdown/);
    const d = r.text;
    for (const trecho of ['# Diagnóstico do trabalho "Falha de propósito"', '## Motivo da parada', '## Etapas', '**gera** "Gerar o relatório"', 'conferência da etapa: `test -f relatorio.md`', '## Tentativas', '### #1 · gera · `local-shell`', '## Critérios finais', '## IAs e executores usados', '## Log do trabalho']) {
      expect(d).toContain(trecho);
    }
    expect(d).not.toContain(token);
    expect(d).toContain('sk-ant-oat01-AB…[oculto]');
    expect(d).not.toContain('abcdefghijklmnop123');

    registrarErro('worker', `falha na tarefa RUN_STEP x (trabalho ${j.id}): banco caiu com postgres://nivoo:SenhaSecreta@localhost/nivoo`, new Error('detalhe do erro'));
    const s = (await h.http().get('/api/system/diagnostico').expect(200)).text;
    for (const trecho of ['# Diagnóstico do sistema Nivoo', '## Worker', 'NO AR', '## Fila', '## Conexões de IA', '## Trabalhos parados recentes', 'Falha de propósito', '## Últimos erros do sistema', '[worker] falha na tarefa RUN_STEP']) {
      expect(s).toContain(trecho);
    }
    expect(s).not.toContain('SenhaSecreta');
    // O erro ligado ao trabalho também aparece no diagnóstico dele.
    expect((await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/diagnostico`)).text).toContain('## Erros do sistema ligados a este trabalho');
  });
});
