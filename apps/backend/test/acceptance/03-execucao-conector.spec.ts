/**
 * Critérios V1: execução de uma tarefa por conector disponível; registro de logs e artefatos.
 * Conector usado: local-shell (executor real, determinístico — não é IA e não é simulado).
 * Os conectores de IA (Claude Code CLI / Codex CLI / APIs) são verificados quanto a
 * disponibilidade real neste host; não são simulados.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

describe('Execução por conector, logs e artefatos', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    await h.app.get(require('../../src/market/market.service').MarketService).ensureAssets();
    h.worker.start();
  });
  afterAll(() => h.close());

  it('lista conectores com disponibilidade, limites e erros reais', async () => {
    const res = await h.http().get('/api/providers').expect(200);
    const ids = res.body.map((p: any) => p.id).sort();
    expect(ids).toEqual(['anthropic-api', 'claude-code-cli', 'codex-cli', 'local-shell', 'openai-api']);
    for (const p of res.body) {
      expect(typeof p.available).toBe('boolean');
      expect(Array.isArray(p.errors)).toBe(true);
      expect(p.limits).toBeDefined();
      if (!p.available) expect(p.errors.length).toBeGreaterThan(0);
    }
    const shell = res.body.find((p: any) => p.id === 'local-shell');
    expect(shell.available).toBe(true);
    expect(shell.isAi).toBe(false);
  });

  it('executa job completo: etapas, logs, artefatos com sha256, checkpoints git e conclusão verificada', async () => {
    const p = await createProject(h, 'Execução');
    const r = await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WIN'] }).expect(201);
    const hyp = await h.http().post(`/api/projects/${p.id}/researches/${r.body.id}/hypotheses`).send({ statement: 'h1' }).expect(201);
    const job = (
      await h
        .http()
        .post(`/api/projects/${p.id}/jobs`)
        .send({
          title: 'Experimento média móvel (somente medição)',
          objective: 'Calcular métricas de um experimento e registrar evidências.',
          researchId: r.body.id,
          defaultProvider: 'local-shell',
          steps: [
            { key: 'codigo', instructions: 'mkdir -p src && printf "janela=20\\n" > src/params.txt && echo "codigo gravado"' },
            {
              key: 'medir',
              dependsOn: ['codigo'],
              instructions: 'python3 -c "import json; json.dump({\'sharpe\': 1.42, \'trades\': 118}, open(\'out/metrics.json\',\'w\'))" && echo "# Relatório" > out/relatorio.md && echo medido',
              verifyCommand: 'test -s out/metrics.json',
            },
          ],
          criteria: [
            { key: 'metrica', description: 'sharpe >= 1', kind: 'METRIC_THRESHOLD', config: { artifact: 'metrics.json', path: 'sharpe', op: '>=', value: 1 } },
            { key: 'relatorio', description: 'relatório presente', kind: 'ARTIFACT_PRESENT', config: { name: 'relatorio.md' } },
            { key: 'codigo', description: 'parâmetros versionados', kind: 'FILE_EXISTS', config: { path: 'src/params.txt' } },
            { key: 'teste', description: 'comando de verificação', kind: 'COMMAND', config: { command: 'grep -q janela=20 src/params.txt' } },
          ],
          experiment: { name: 'MM20', hypothesisId: hyp.body.id, parameters: { janela: 20 } },
        })
        .expect(201)
    ).body;

    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    const done = await waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${p.id}/jobs/${job.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(j.status) ? j : null;
    });
    expect(done.status).toBe('CONCLUIDO');
    expect(done.steps.every((s: any) => s.status === 'CONCLUIDO')).toBe(true);
    expect(done.attempts).toHaveLength(2);
    expect(done.attempts.every((a: any) => a.status === 'SUCESSO' && a.provider === 'local-shell')).toBe(true);
    expect(done.criteria.every((c: any) => c.status === 'APROVADO')).toBe(true);
    // Cada critério tem evidência registrada.
    expect(done.criteria.every((c: any) => c.checks.length === 1 && c.checks[0].passed && c.checks[0].artifactId)).toBe(true);

    // Logs persistidos (inclui saída do provedor e da avaliação).
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${job.id}/logs`).expect(200)).body;
    const msgs = logs.map((l: any) => l.message).join('\n');
    expect(msgs).toContain('codigo gravado');
    expect(msgs).toContain('medido');
    expect(msgs).toMatch(/Avaliação de conclusão: CONCLUIDO/);

    // Artefatos: conteúdo íntegro (sha256) e baixável.
    const metrics = done.artifacts.find((a: any) => a.name === 'metrics.json');
    expect(metrics.kind).toBe('METRICS');
    const dl = await h.http().get(`/api/projects/${p.id}/artifacts/${metrics.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(createHash('sha256').update(dl.body).digest('hex')).toBe(metrics.sha256);
    expect(dl.headers['x-content-sha256']).toBe(metrics.sha256);
    expect(dl.headers['content-security-policy']).toMatch(/^sandbox/);
    expect(JSON.parse(dl.body.toString()).sharpe).toBe(1.42);
    expect(done.artifacts.some((a: any) => a.kind === 'LOG' && a.name === 'logs/medir/tentativa-1.log')).toBe(true);
    expect(done.artifacts.filter((a: any) => a.kind === 'CRITERION_EVIDENCE')).toHaveLength(4);

    // Checkpoints com commit git na branch do job; main preservada.
    expect(done.checkpoints.length).toBeGreaterThanOrEqual(2);
    const commit = done.checkpoints[done.checkpoints.length - 1].gitCommit;
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    const repo = path.join(p.workspacePath, 'repo');
    const branchHead = execFileSync('git', ['rev-parse', `job/${job.id}`], { cwd: repo }).toString().trim();
    const mainLog = execFileSync('git', ['log', '--oneline', 'main'], { cwd: repo }).toString().trim().split('\n');
    expect(mainLog).toHaveLength(1);
    expect(execFileSync('git', ['show', `${branchHead}:src/params.txt`], { cwd: repo }).toString()).toBe('janela=20\n');
    expect(fs.existsSync(path.join(repo, 'src'))).toBe(false); // main não foi alterada

    // Experimento vinculado a dados reproduzíveis e memória de evidência.
    expect(done.experiment.status).toBe('CONCLUIDO');
    expect(done.experiment.metrics).toEqual({ sharpe: 1.42, trades: 118 });
    expect(done.experiment.codeRef).toMatch(/^[0-9a-f]{40}$/);
    const mem = (await h.http().get(`/api/projects/${p.id}/memory?category=EVIDENCIA`).expect(200)).body;
    expect(mem).toHaveLength(1);
    expect(mem[0].references.artifactIds).toContain(metrics.id);
    expect(mem[0].references.experimentIds).toEqual([done.experiment.id]);

    // Com experimento verificado, a hipótese pode ser VALIDADA e vira RESULTADO_VALIDADO com referências.
    await h
      .http()
      .patch(`/api/projects/${p.id}/hypotheses/${hyp.body.id}`)
      .send({ status: 'VALIDADA', conclusion: 'sharpe 1.42 no conjunto de treino', experimentIds: [done.experiment.id] })
      .expect(200);
    const validated = (await h.http().get(`/api/projects/${p.id}/memory?category=RESULTADO_VALIDADO`).expect(200)).body;
    expect(validated[0].references.gitCommit).toBe(done.experiment.codeRef);
    const cmp = (await h.http().get(`/api/projects/${p.id}/researches/${r.body.id}/experiments/compare`).expect(200)).body;
    expect(cmp.rows[0]).toMatchObject({ name: 'MM20', verified: true });
    expect(cmp.metricKeys).toEqual(['sharpe', 'trades']);
  });

  it('SSE entrega estado e logs em tempo real', async () => {
    const p = await createProject(h, 'SSE');
    const job = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'sse',
        objective: 'o',
        steps: [{ key: 'a', instructions: 'echo linha-sse' }],
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      })
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    await waitFor(async () => (await h.prisma.job.findUnique({ where: { id: job.id } }))?.status === 'CONCLUIDO');
    const server = h.app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const port = server.address().port;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/${p.id}/jobs/${job.id}/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let text = '';
    const end = Date.now() + 5000;
    while (Date.now() < end && !(text.includes('linha-sse') && text.includes('CONCLUIDO'))) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    ctrl.abort();
    expect(text).toContain('event: state');
    expect(text).toContain('linha-sse');
    expect(text).toContain('CONCLUIDO');
  });
});
