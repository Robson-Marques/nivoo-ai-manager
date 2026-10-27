/**
 * INTEGRAÇÃO REAL — ciclo científico completo com DADOS SINTÉTICOS (opt-in: NIVOO_RUN_CLI_INTEGRATION=1).
 *
 * 1. Gera dados sintéticos rotulados (efeito plantado para H1; nenhum efeito para H2).
 * 2. Registra hipóteses com REGRA DE DECISÃO PRÉ-REGISTRADA (antes de qualquer experimento).
 * 3. Claude Code escreve o código do experimento (sessão real); o executor local roda o código;
 *    Claude Code escreve o relatório (outra sessão real).
 * 4. Verificação: verificador de referência do operador (fora do alcance do agente) recalcula
 *    as métricas; reprodutibilidade (reexecução gera métricas idênticas); relatório rotulado.
 * 5. Hipóteses decididas pela regra: espera-se H1 VALIDADA e H2 REJEITADA.
 * 6. Pesquisa só encerra quando nada está pendente; antes disso, o encerramento é recusado.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, killHard, spawnNode, truncateAll, waitFor } from '../support/harness';
import { exportEvidence, REAL, requireProvider, SINTETICO } from '../support/real';

const d = REAL ? describe : describe.skip;
const ESPEC = [
  'Especificação das métricas (CSV de barras de 5 min: timestamp,open,high,low,close,volume; agrupe por dia = 10 primeiros caracteres do timestamp, na ordem do arquivo):',
  '- Para cada dia exceto o primeiro: gap = open da 1ª barra do dia − close da última barra do dia anterior;',
  '  ret60 = close da 12ª barra do dia − open da 1ª barra; vol1h = soma do volume das 12 primeiras barras; ret_dia = close da última barra − open da 1ª.',
  '- n_dias_total = nº de dias considerados; dias de gap = dias com |gap| >= 300; n_dias_gap = quantidade;',
  '- taxa_reversao = fração dos dias de gap com gap*ret60 < 0, arredondada a 4 casas;',
  '- reversao_media_pts = média de (−1 se gap>0 senão 1)*ret60 nos dias de gap, arredondada a 2 casas;',
  '- taxa_acerto_volume = entre os dias com vol1h > mediana(vol1h de todos os dias considerados), fração com ret_dia > 0, 4 casas.',
].join('\n');

d('Ciclo científico real com dados sintéticos', () => {
  let h: Harness;
  let worker: any;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, 'claude-code-cli');
    worker = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-ciencia' });
  });
  afterAll(async () => {
    await killHard(worker);
    await h.close();
  });

  it('hipótese → experimento → validação → decisão pela regra pré-registrada → relatório reproduzível', async () => {
    const p = await createProject(h, 'ciencia sintetica');
    const dataDir = path.join(p.workspacePath, 'data');
    // 1. Dados sintéticos (rotulados) + verificador do operador
    execFileSync('python3', [path.join(SINTETICO, 'gerar_dados.py'), path.join(dataDir, 'win_sintetico_treino.csv'), '42', '250', '2025-01-06']);
    execFileSync('python3', [path.join(SINTETICO, 'gerar_dados.py'), path.join(dataDir, 'win_sintetico_validacao.csv'), '4242', '250', '2026-01-05']);
    fs.copyFileSync(path.join(SINTETICO, 'verificador.py'), path.join(dataDir, 'verificador.py'));
    const nota = 'DADOS SINTÉTICOS (não são dados de mercado), gerados por gerar_dados.py; efeito plantado: reversão pós-gap; sem efeito de volume.';
    const treino = (await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'WIN sintético treino', assetCode: 'WIN', uri: 'win_sintetico_treino.csv', role: 'TREINO', timeframe: '5min', notes: nota }).expect(201)).body;
    const valid = (await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'WIN sintético validação', assetCode: 'WIN', uri: 'win_sintetico_validacao.csv', role: 'VALIDACAO', timeframe: '5min', notes: nota }).expect(201)).body;
    for (const ds of [treino, valid]) {
      const v = (await h.http().post(`/api/projects/${p.id}/datasets/${ds.id}/validate`).expect(201)).body;
      expect(v.valid).toBe(true); // regras do WIN (tick, faixa, pregão)
    }

    // 2. Pesquisa + hipóteses com regra pré-registrada
    const r = (await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'Reversão pós-gap (sintético)', question: 'Gaps de abertura >= 300 pts revertem na primeira hora?', assetCodes: ['WIN'] }).expect(201)).body;
    const h1 = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({
      statement: 'H1: após |gap| >= 300 pts, a primeira hora reverte o gap',
      decisionRule: { metric: 'taxa_reversao', op: '>=', value: 0.65, datasetRole: 'VALIDACAO' },
    }).expect(201)).body;
    const h2 = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({
      statement: 'H2: volume alto na primeira hora antecipa dia de alta',
      decisionRule: { metric: 'taxa_acerto_volume', op: '>=', value: 0.65, datasetRole: 'VALIDACAO' },
    }).expect(201)).body;
    // Decisão manual é recusada quando há regra pré-registrada.
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${h1.id}`).send({ status: 'VALIDADA', conclusion: 'acho que sim' }).expect(400);

    // 3. Experimento (job) — código e relatório por Claude Code; execução pelo executor local.
    const arquivo = 'dados/win_sintetico_validacao.csv';
    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
      title: 'Experimento reversão pós-gap (validação)',
      objective: 'Medir, no conjunto de VALIDAÇÃO sintético, as métricas especificadas e produzir relatório reproduzível para decidir H1 e H2 pelas regras pré-registradas.',
      researchId: r.id,
      defaultProvider: 'claude-code-cli',
      limits: { maxSessionsPerStep: 6, maxCostUsd: 6, stepTimeoutSec: 600, maxDurationSec: 3600 },
      experiment: { name: 'gap300-janela60-validacao', datasetId: valid.id, parameters: { limiar_gap: 300, barras_janela: 12 } },
      steps: [
        {
          key: 'codigo',
          title: 'Escrever o experimento',
          instructions: `Escreva src/experimento.py (Python 3, somente biblioteca padrão) com uso: python3 src/experimento.py <csv> <saida.json>, que grava em <saida.json> um objeto JSON com as chaves n_dias_total, n_dias_gap, taxa_reversao, reversao_media_pts e taxa_acerto_volume.\n${ESPEC}\nO arquivo de dados está em ${arquivo}. Você não pode executar comandos; o backend executará o script.`,
          verifyCommand: `t=$(mktemp) && python3 src/experimento.py ${arquivo} "$t" && python3 -c "import json,sys; d=json.load(open('$t')); k={'n_dias_total','n_dias_gap','taxa_reversao','reversao_media_pts','taxa_acerto_volume'}; sys.exit(0 if k<=set(d) else 1)"`,
        },
        { key: 'executar', dependsOn: ['codigo'], provider: 'local-shell', title: 'Executar o experimento', instructions: `python3 src/experimento.py ${arquivo} out/metrics.json && cat out/metrics.json` },
        {
          key: 'relatorio',
          dependsOn: ['executar'],
          title: 'Relatório',
          instructions: 'Leia out/metrics.json e escreva out/relatorio.md em português: objetivo, dados (deixe explícito que são DADOS SINTÉTICOS e cite o sha256 do dataset que consta no contexto), método (especificação das métricas), resultados (valores exatos de out/metrics.json), as regras de decisão pré-registradas de H1 e H2 e como reproduzir (comando). Não declare a decisão das hipóteses: ela é aplicada pelo sistema.',
          verifyCommand: `grep -qi "sint[eé]tic" out/relatorio.md && grep -q "${valid.sha256.slice(0, 12)}" out/relatorio.md && python3 -c "import json; d=json.load(open('out/metrics.json')); t=open('out/relatorio.md').read(); assert str(d['taxa_reversao']) in t and str(d['taxa_acerto_volume']) in t"`,
        },
      ],
      criteria: [
        { key: 'referencia', description: 'métricas conferem com o verificador de referência do operador', kind: 'COMMAND', config: { command: `python3 "$NIVOO_DATA_DIR/verificador.py" ${arquivo} out/metrics.json 300 12` } },
        { key: 'reprodutivel', description: 'reexecução gera métricas idênticas', kind: 'COMMAND', config: { command: `t=$(mktemp) && python3 src/experimento.py ${arquivo} "$t" && cmp "$t" out/metrics.json` } },
        { key: 'relatorio', description: 'relatório presente', kind: 'ARTIFACT_PRESENT', config: { name: 'relatorio.md' } },
        { key: 'metricas', description: 'artefato de métricas', kind: 'METRIC_THRESHOLD', config: { artifact: 'metrics.json', path: 'n_dias_total', op: '>=', value: 200 } },
      ],
    }).expect(201)).body;

    // Encerrar a pesquisa agora é recusado (incompleta).
    const early = await h.http().post(`/api/projects/${p.id}/researches/${r.id}/close`).expect(400);
    expect(JSON.stringify(early.body)).toMatch(/hipótese em investigação/);

    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    const done = await waitFor(async () => {
      const j = await h.prisma.job.findUnique({ where: { id: job.id } });
      return j && ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(j.status) ? j : null;
    }, 1500000, 3000);
    const exp = await h.prisma.experiment.findUniqueOrThrow({ where: { jobId: job.id } });

    // 5. Decisão pelas regras pré-registradas
    let d1: any = null;
    let d2: any = null;
    if (done.status === 'CONCLUIDO') {
      d1 = (await h.http().post(`/api/projects/${p.id}/hypotheses/${h1.id}/decide`).send({ experimentId: exp.id })).body;
      d2 = (await h.http().post(`/api/projects/${p.id}/hypotheses/${h2.id}/decide`).send({ experimentId: exp.id })).body;
    }
    const closed = await h.http().post(`/api/projects/${p.id}/researches/${r.id}/close`);
    const referencia = JSON.parse(execFileSync('python3', [path.join(SINTETICO, 'verificador.py'), '--calcular', path.join(dataDir, 'win_sintetico_validacao.csv')]).toString());
    await exportEvidence(h, job.id, 'real-03-cientifico', {
      metricasReferencia: referencia,
      metricasExperimento: exp.metrics,
      experimento: { id: exp.id, commit: exp.codeRef, parametros: exp.parameters },
      decisoes: { H1: d1 && { status: d1.status, conclusao: d1.conclusion }, H2: d2 && { status: d2.status, conclusao: d2.conclusion } },
      encerramentoPrematuroRecusado: early.body,
      encerramentoFinal: { http: closed.status, status: closed.body.status },
    });
    if (process.env.NIVOO_EVIDENCE_DIR) {
      const rel = await h.prisma.artifact.findFirst({ where: { jobId: job.id, name: 'relatorio.md' }, orderBy: { createdAt: 'desc' } });
      if (rel) fs.copyFileSync(path.join(require('../../src/config').appConfig().artifactsRoot, rel.storagePath), path.join(process.env.NIVOO_EVIDENCE_DIR, 'real-03-relatorio.md'));
    }

    expect(done.status).toBe('CONCLUIDO');
    expect(exp.metrics).toMatchObject(referencia); // o agente pode acrescentar campos; os especificados devem coincidir
    expect(d1.status).toBe('VALIDADA');
    expect(d2.status).toBe('REJEITADA');
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe('ENCERRADA');
    const mem = (await h.http().get(`/api/projects/${p.id}/memory?category=RESULTADO_VALIDADO`).expect(200)).body;
    expect(mem[0].references.experimentIds).toEqual([exp.id]);
    expect(mem[0].references.gitCommit).toBe(exp.codeRef);
  }, 1800000);
});
