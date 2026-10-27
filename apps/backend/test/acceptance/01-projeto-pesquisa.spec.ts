/**
 * Critério V1: criação de projeto e pesquisa (ambiente Mercado, WIN e WDO independentes).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHarness, createProject, Harness, truncateAll } from '../support/harness';

describe('Projeto e pesquisa (Mercado)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    await h.app.get(require('../../src/market/market.service').MarketService).ensureAssets();
  });
  afterAll(() => h.close());

  it('cria projeto com workspace git isolado (main preservada) e especificação na memória', async () => {
    const p = await createProject(h, 'Pesquisa Abertura WIN');
    expect(p.slug).toBe('pesquisa-abertura-win');
    const repo = path.join(p.workspacePath, 'repo');
    expect(fs.existsSync(path.join(repo, '.git'))).toBe(true);
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repo }).toString().trim();
    expect(branch).toBe('main');
    const mem = await h.http().get(`/api/projects/${p.id}/memory`).expect(200);
    expect(mem.body.map((m: any) => m.category)).toContain('ESPECIFICACAO');
    await h.http().post('/api/projects').send({ name: 'Pesquisa Abertura WIN' }).expect(409);
  });

  it('cria pesquisa vinculada a WIN e WDO e registra hipótese na memória', async () => {
    const p = await createProject(h, 'Volatilidade');
    const r = await h
      .http()
      .post(`/api/projects/${p.id}/researches`)
      .send({ title: 'Gap de abertura', question: 'O gap de abertura reverte na primeira hora?', assetCodes: ['WIN', 'WDO'] })
      .expect(201);
    expect(r.body.assets.map((a: any) => a.asset.code).sort()).toEqual(['WDO', 'WIN']);
    await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'x', question: 'y', assetCodes: ['PETR4'] }).expect(400);

    const hyp = await h
      .http()
      .post(`/api/projects/${p.id}/researches/${r.body.id}/hypotheses`)
      .send({ statement: 'Gaps > 300 pontos no WIN revertem 50% em 60 min', rationale: 'observação preliminar' })
      .expect(201);
    expect(hyp.body.status).toBe('EM_INVESTIGACAO');
    const research = await h.http().get(`/api/projects/${p.id}/researches/${r.body.id}`).expect(200);
    expect(research.body.status).toBe('EM_ANDAMENTO');
    expect(research.body.memory.some((m: any) => m.category === 'HIPOTESE_INVESTIGACAO')).toBe(true);

    // Hipótese não pode ser VALIDADA sem experimento verificado.
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${hyp.body.id}`).send({ status: 'VALIDADA', conclusion: 'parece bom' }).expect(400);
  });

  it('mantém configurações e validações de WIN e WDO independentes', async () => {
    const before = await h.http().get('/api/market/assets/WDO').expect(200);
    await h.http().patch('/api/market/assets/WIN').send({ tickSize: 5, validation: { maxBarRangePoints: 4000 } }).expect(200);
    const after = await h.http().get('/api/market/assets/WDO').expect(200);
    expect(after.body).toEqual(before.body);
    const win = await h.http().get('/api/market/assets/WIN').expect(200);
    expect(win.body.validation.maxBarRangePoints).toBe(4000);
    expect(win.body.validation.minPrice).toBe(50000);
    expect(Number(win.body.pointValue)).toBeCloseTo(0.2);
    expect(Number(after.body.pointValue)).toBeCloseTo(10);
  });

  it('valida dataset segundo as regras do ativo (mesmo arquivo: válido p/ WIN, inválido p/ WDO)', async () => {
    const p = await createProject(h, 'Dados');
    const dataDir = path.join(p.workspacePath, 'data');
    fs.writeFileSync(
      path.join(dataDir, 'win_1min.csv'),
      'timestamp,open,high,low,close,volume\n2026-03-02T09:00:00,128000,128150,127950,128100,1500\n2026-03-02T09:01:00,128100,128200,128050,128150,900\n',
    );
    const win = await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'WIN 1min mar', assetCode: 'WIN', uri: 'win_1min.csv', role: 'TREINO' }).expect(201);
    expect(win.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const wdo = await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'mesmo arquivo como WDO', assetCode: 'WDO', uri: 'win_1min.csv' }).expect(201);
    const vWin = await h.http().post(`/api/projects/${p.id}/datasets/${win.body.id}/validate`).expect(201);
    expect(vWin.body.valid).toBe(true);
    expect(vWin.body.rows).toBe(2);
    const vWdo = await h.http().post(`/api/projects/${p.id}/datasets/${wdo.body.id}/validate`).expect(201);
    expect(vWdo.body.valid).toBe(false);
    expect(vWdo.body.errors.some((e: any) => /fora da faixa WDO/.test(e.issue))).toBe(true);
  });

  it('bloqueia uso de conjunto RESERVADO até liberação aprovada', async () => {
    const p = await createProject(h, 'Holdout');
    const r = await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WDO'] }).expect(201);
    const ds = await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'holdout 2026', assetCode: 'WDO', uri: 'holdout.csv', role: 'RESERVADO' }).expect(201);
    const jobBody = {
      title: 'exp',
      objective: 'testar',
      researchId: r.body.id,
      steps: [{ key: 's', instructions: 'true' }],
      criteria: [{ key: 'c', description: 'cmd', kind: 'COMMAND', config: { command: 'true' } }],
      experiment: { name: 'e1', datasetId: ds.body.id, parameters: { janela: 20 } },
    };
    const blocked = await h.http().post(`/api/projects/${p.id}/jobs`).send(jobBody).expect(400);
    expect(blocked.body.message).toMatch(/RESERVADO/);
    const appr = await h.http().post(`/api/projects/${p.id}/datasets/${ds.body.id}/request-release`).send({ reason: 'validação final' }).expect(201);
    await h.http().post(`/api/approvals/${appr.body.id}/decide`).send({ decision: 'APROVADO', decidedBy: 'pesquisador' }).expect(201);
    const ok = await h.http().post(`/api/projects/${p.id}/jobs`).send(jobBody).expect(201);
    expect(ok.body.experiment.datasetId).toBe(ds.body.id);
  });
});
