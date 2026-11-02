/**
 * AUTOMATIZADO, SEM IA (executor local) — ciclo científico com DADOS SINTÉTICOS.
 * Prova as regras do backend (pré-registro, decisão pela regra, verificador de referência,
 * reprodutibilidade, notas na memória, encerramento de pesquisa só sem pendências).
 * A versão com Claude Code escrevendo código e relatório está em test/integration/real-03.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

const SINT = path.join(__dirname, '..', 'support', 'sintetico');

describe('Ciclo científico determinístico (dados sintéticos, sem IA)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(() => h.close());

  it('pré-registro → experimento → verificação → decisão pela regra → encerramento', async () => {
    const p = await createProject(h, 'ciencia ci');
    const dataDir = path.join(p.workspacePath, 'data');
    execFileSync('python3', [path.join(SINT, 'gerar_dados.py'), path.join(dataDir, 'valid.csv'), '4242', '250', '2026-01-05']);
    fs.copyFileSync(path.join(SINT, 'verificador.py'), path.join(dataDir, 'verificador.py'));
    const ds = (await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'sintético validação', assetCode: 'WIN', uri: 'valid.csv', role: 'VALIDACAO', notes: 'DADOS SINTÉTICOS' }).expect(201)).body;
    const r = (await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'gap', question: 'q', assetCodes: ['WIN'] }).expect(201)).body;
    const h1 = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({ statement: 'H1', decisionRule: { metric: 'taxa_reversao', op: '>=', value: 0.65, datasetRole: 'VALIDACAO' } }).expect(201)).body;
    const h2 = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({ statement: 'H2', decisionRule: { metric: 'taxa_acerto_volume', op: '>=', value: 0.65, datasetRole: 'VALIDACAO' } }).expect(201)).body;
    const h3 = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({ statement: 'H3 sem regra' }).expect(201)).body;

    // O "experimento" usa o próprio verificador como código (determinístico, sem IA).
    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
      title: 'exp', objective: 'medir', researchId: r.id,
      experiment: { name: 'e1', datasetId: ds.id, parameters: { limiar_gap: 300 } }, // mede H1 e H2
      steps: [
        { key: 'codigo', instructions: `mkdir -p src && cp "$NIVOO_DATA_DIR/verificador.py" src/experimento.py && echo '{"tipo":"PROGRESSO","titulo":"código pronto","conteudo":"falta executar"}' >> .nivoo/notas.jsonl || (mkdir -p .nivoo && echo '{"tipo":"PROGRESSO","titulo":"código pronto","conteudo":"falta executar"}' >> .nivoo/notas.jsonl)` },
        { key: 'executar', dependsOn: ['codigo'], instructions: 'python3 src/experimento.py --calcular dados/valid.csv > out/metrics.json' },
      ],
      criteria: [
        { key: 'ref', description: 'referência', kind: 'COMMAND', config: { command: 'python3 "$NIVOO_DATA_DIR/verificador.py" dados/valid.csv out/metrics.json' } },
        { key: 'repro', description: 'reprodutível', kind: 'COMMAND', config: { command: 't=$(mktemp) && python3 src/experimento.py --calcular dados/valid.csv > "$t" && cmp "$t" out/metrics.json' } },
      ],
    }).expect(201)).body;

    // Pesquisa incompleta não encerra.
    const early = await h.http().post(`/api/projects/${p.id}/researches/${r.id}/close`).expect(400);
    expect(early.body.pendencias.length).toBeGreaterThanOrEqual(4);

    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    await waitFor(async () => (await h.prisma.job.findUnique({ where: { id: job.id } }))?.status === 'CONCLUIDO', 60000);
    const exp = await h.prisma.experiment.findUniqueOrThrow({ where: { jobId: job.id } });
    const ref = JSON.parse(execFileSync('python3', [path.join(SINT, 'verificador.py'), '--calcular', path.join(dataDir, 'valid.csv')]).toString());
    expect(exp.metrics).toEqual(ref);

    // Nota estruturada do executor virou memória, e o dataset foi copiado com sha conferido.
    const pend = (await h.http().get(`/api/projects/${p.id}/memory?category=PENDENCIA`)).body;
    expect(pend.some((m: any) => m.title === 'código pronto' && m.references.jobId === job.id)).toBe(true);

    // Regra não pode mais mudar após o início do experimento; decisão manual recusada.
    await h.http().put(`/api/projects/${p.id}/hypotheses/${h1.id}/decision-rule`).send({ metric: 'taxa_reversao', op: '>=', value: 0.1 }).expect(400);
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${h2.id}/status`).send({}).expect(404);
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${h2.id}`).send({ status: 'VALIDADA', conclusion: 'x', experimentIds: [exp.id] }).expect(400);
    // H3 sem regra não pode ser decidida pela regra.
    await h.http().post(`/api/projects/${p.id}/hypotheses/${h3.id}/decide`).send({ experimentId: exp.id }).expect(400);

    const d1 = (await h.http().post(`/api/projects/${p.id}/hypotheses/${h1.id}/decide`).send({ experimentId: exp.id }).expect(201)).body;
    const d2 = (await h.http().post(`/api/projects/${p.id}/hypotheses/${h2.id}/decide`).send({ experimentId: exp.id }).expect(201)).body;
    expect(d1.status).toBe('VALIDADA');
    expect(d2.status).toBe('REJEITADA');
    expect(d1.conclusion).toMatch(/regra pré-registrada taxa_reversao >= 0.65/);
    // A entrada "em investigação" foi substituída pela decisão (memória sem contradição).
    const emInvestigacao = (await h.http().get(`/api/projects/${p.id}/memory?category=HIPOTESE_INVESTIGACAO`)).body;
    expect(emInvestigacao.some((m: any) => m.references?.hypothesisId === h1.id)).toBe(false);
    expect(emInvestigacao.some((m: any) => m.references?.hypothesisId === h3.id)).toBe(true);
    await h.http().post(`/api/projects/${p.id}/hypotheses/${h1.id}/decide`).send({ experimentId: exp.id }).expect(400); // já decidida

    // Ainda há H3 em investigação → encerramento recusado; após rejeitá-la, encerra.
    await h.http().post(`/api/projects/${p.id}/researches/${r.id}/close`).expect(400);
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${h3.id}`).send({ status: 'REJEITADA', conclusion: 'fora de escopo' }).expect(200);
    const closed = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/close`).expect(201)).body;
    expect(closed.status).toBe('ENCERRADA');
    const validated = (await h.http().get(`/api/projects/${p.id}/memory?category=RESULTADO_VALIDADO`)).body;
    expect(validated[0].references.gitCommit).toBe(exp.codeRef);
  });

  it('pré-registro: regra definida depois do início do experimento não vale', async () => {
    const p = await createProject(h, 'ciencia pre registro');
    const r = (await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'x', question: 'q', assetCodes: ['WIN'] }).expect(201)).body;
    const hy = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({ statement: 'H' }).expect(201)).body;
    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
      title: 'e', objective: 'o', researchId: r.id, experiment: { name: 'e', hypothesisId: hy.id },
      steps: [{ key: 's', instructions: 'echo \'{"m": 1}\' > out/metrics.json' }],
      criteria: [{ key: 'c', description: 'c', kind: 'ARTIFACT_PRESENT', config: { name: 'metrics.json' } }],
    }).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    await waitFor(async () => (await h.prisma.job.findUnique({ where: { id: job.id } }))?.status === 'CONCLUIDO', 30000);
    await h.http().put(`/api/projects/${p.id}/hypotheses/${hy.id}/decision-rule`).send({ metric: 'm', op: '>=', value: 1 }).expect(400);
    // Experimento vinculado a outra hipótese não decide esta.
    const outra = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({ statement: 'H outra', decisionRule: { metric: 'm', op: '>=', value: 1 } }).expect(201)).body;
    const exp = await h.prisma.experiment.findUniqueOrThrow({ where: { jobId: job.id } });
    const res = await h.http().post(`/api/projects/${p.id}/hypotheses/${outra.id}/decide`).send({ experimentId: exp.id }).expect(400);
    expect(res.body.message).toMatch(/não pertence/);
  });
});
