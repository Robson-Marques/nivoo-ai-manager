/**
 * Critério V1: bloqueio de conclusão sem evidências exigidas; aprovação explícita de critérios
 * subjetivos; repetição improdutiva; limites de tentativas, tempo e orçamento; política de segurança.
 */
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

describe('Controle de conclusão', () => {
  let h: Harness;
  let pid: string;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    pid = (await createProject(h, 'Conclusão')).id;
    h.worker.start();
  });
  afterAll(() => h.close());

  async function runJob(body: any, until: string[] = ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_APROVACAO']) {
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send({ objective: 'objetivo de teste', ...body }).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/start`).expect(201);
    return waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${pid}/jobs/${job.id}`)).body;
      return until.includes(j.status) ? j : null;
    }, 30000);
  }

  it('saída da IA/agente dizendo "concluído" não conclui: falta a evidência exigida → BLOQUEADO com pendências', async () => {
    const j = await runJob({
      title: 'sem evidência',
      steps: [{ key: 'a', instructions: 'echo "TAREFA CONCLUÍDA COM SUCESSO. Todos os critérios foram atendidos."' }],
      criteria: [
        { key: 'relatorio', description: 'relatório de backtest', kind: 'ARTIFACT_PRESENT', config: { name: 'relatorio.md' } },
        { key: 'metrica', description: 'sharpe', kind: 'METRIC_THRESHOLD', config: { path: 'sharpe', op: '>=', value: 1 } },
      ],
    });
    expect(j.status).toBe('BLOQUEADO');
    expect(j.blockedReason).toBe('CRITERIOS_NAO_ATENDIDOS');
    expect(j.steps[0].status).toBe('CONCLUIDO');
    const rep = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}/report`).expect(200)).body;
    expect(rep.concluido).toBe(false);
    expect(rep.criteriosPendentes.map((c: any) => c.key).sort()).toEqual(['metrica', 'relatorio']);
    expect(rep.detalhe).toMatch(/critério não atendido: relatorio/);
    // Não existe rota para forçar status.
    await h.http().patch(`/api/projects/${pid}/jobs/${j.id}`).send({ status: 'CONCLUIDO' }).expect(404);
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/complete`).expect(404);

    // Corrigindo: adiciona etapa que produz as evidências; retomar → verifica de novo → CONCLUIDO.
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/steps`).send({
      steps: [{ key: 'b', dependsOn: ['a'], instructions: 'echo "# r" > out/relatorio.md && echo \'{"sharpe": 1.1}\' > out/metrics.json' }],
    }).expect(201);
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/resume`).send({}).expect(201);
    const done = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
      return x.status === 'CONCLUIDO' || x.status === 'FALHOU' ? x : null;
    });
    expect(done.status).toBe('CONCLUIDO');
  });

  it('job sem critérios nunca é concluído', async () => {
    const j = await runJob({ title: 'sem critérios', steps: [{ key: 'a', instructions: 'echo ok' }] });
    expect(j.status).toBe('BLOQUEADO');
    expect(j.blockedReason).toBe('SEM_CRITERIOS');
  });

  it('critério subjetivo exige aprovação explícita (aprovar → CONCLUIDO; rejeitar → BLOQUEADO)', async () => {
    const body = {
      title: 'subjetivo',
      steps: [{ key: 'a', instructions: 'echo "# análise" > out/analise.md' }],
      criteria: [
        { key: 'arquivo', description: 'análise gerada', kind: 'ARTIFACT_PRESENT', config: { name: 'analise.md' } },
        { key: 'qualidade', description: 'análise é convincente', kind: 'MANUAL_APPROVAL' },
      ],
    };
    const j = await runJob(body);
    expect(j.status).toBe('AGUARDANDO_APROVACAO');
    const appr = j.approvals.find((a: any) => a.kind === 'CRITERIO_SUBJETIVO');
    expect(appr.status).toBe('PENDENTE');
    await h.http().post(`/api/approvals/${appr.id}/decide`).send({ decision: 'APROVADO' }).expect(400); // decidedBy obrigatório
    await h.http().post(`/api/approvals/${appr.id}/decide`).send({ decision: 'APROVADO', decidedBy: 'Robson', reason: 'ok' }).expect(201);
    const done = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
      return x.status === 'CONCLUIDO' ? x : null;
    });
    const check = done.criteria.find((c: any) => c.key === 'qualidade').checks[0];
    expect(check.evidence.aprovadoPor).toBe('Robson');

    const j2 = await runJob({ ...body, title: 'subjetivo 2' });
    const appr2 = j2.approvals.find((a: any) => a.kind === 'CRITERIO_SUBJETIVO');
    await h.http().post(`/api/approvals/${appr2.id}/decide`).send({ decision: 'REJEITADO', decidedBy: 'Robson', reason: 'fraca' }).expect(201);
    const rejected = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j2.id}`)).body;
      return x.status === 'BLOQUEADO' ? x : null;
    });
    expect(rejected.blockedReason).toBe('CRITERIOS_NAO_ATENDIDOS');
  });

  it('detecta repetição improdutiva (mesmo erro repetido) e bloqueia', async () => {
    const j = await runJob({
      title: 'repete',
      limits: { maxAttemptsPerStep: 10, repetitionWindow: 3 },
      steps: [{ key: 'a', instructions: 'echo "ModuleNotFoundError: pandas" >&2; exit 1' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    expect(j.status).toBe('BLOQUEADO');
    expect(j.blockedReason).toBe('REPETICAO_IMPRODUTIVA');
    expect(j.attempts).toHaveLength(3);
    expect(new Set(j.attempts.map((a: any) => a.outputHash)).size).toBe(1);
    // Lição registrada na memória do projeto, com referência às tentativas.
    const licoes = (await h.http().get(`/api/projects/${pid}/memory?category=PENDENCIA`)).body.filter((m: any) => m.references?.origem === 'licao-automatica' && m.references.jobId === j.id);
    expect(licoes).toHaveLength(1);
    expect(licoes[0].references.motivo).toBe('REPETICAO_IMPRODUTIVA');
    expect(licoes[0].references.attemptIds).toHaveLength(3);
    expect(licoes[0].content).toMatch(/ModuleNotFoundError: pandas/);
  });

  it('respeita limite de tentativas quando as falhas variam → FALHOU', async () => {
    const j = await runJob({
      title: 'varia',
      limits: { maxAttemptsPerStep: 2 },
      steps: [{ key: 'a', instructions: 'echo "falha $RANDOM$RANDOM"; exit 3' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    expect(j.status).toBe('FALHOU');
    expect(j.steps[0].status).toBe('FALHOU');
    expect(j.attempts).toHaveLength(2);
  });

  it('respeita limite de tempo do job (timeout por tentativa + bloqueio por tempo total)', async () => {
    const j = await runJob({
      title: 'tempo',
      limits: { maxDurationSec: 10, stepTimeoutSec: 2, maxAttemptsPerStep: 20, repetitionWindow: 20 },
      steps: [{ key: 'a', instructions: 'echo "t $RANDOM$RANDOM"; sleep 30' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    expect(j.status).toBe('BLOQUEADO');
    expect(j.blockedReason).toBe('LIMITE_TEMPO');
    expect(j.attempts.every((a: any) => /timeout/.test(a.error))).toBe(true);
  });

  it('respeita orçamento de custo', async () => {
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send({
      title: 'orçamento',
      objective: 'o',
      limits: { maxCostUsd: 1 },
      steps: [{ key: 'a', instructions: 'echo a' }, { key: 'b', dependsOn: ['a'], instructions: 'echo b' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    })).body;
    // Simula consumo registrado por um conector pago (custo é informado pelos provedores).
    await h.prisma.job.update({ where: { id: job.id }, data: { costSpentUsd: 1.5 } });
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/start`).expect(201);
    const j = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${job.id}`)).body;
      return x.status === 'BLOQUEADO' ? x : null;
    });
    expect(j.blockedReason).toBe('LIMITE_ORCAMENTO');
    expect(j.attempts).toHaveLength(0);
  });

  it('conector indisponível → AGUARDANDO_RECURSO; ao voltar, continua', async () => {
    await h.http().patch('/api/providers/local-shell').send({ enabled: false }).expect(200);
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send({
      title: 'recurso', objective: 'o',
      steps: [{ key: 'a', instructions: 'echo ok' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    })).body;
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/start`).expect(201);
    const waiting = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${job.id}`)).body;
      return x.status === 'AGUARDANDO_RECURSO' ? x : null;
    });
    expect(waiting.steps[0].status).toBe('AGUARDANDO_RECURSO');
    expect(waiting.statusDetail).toMatch(/desabilitado/);
    await h.http().patch('/api/providers/local-shell').send({ enabled: true }).expect(200);
    // Força nova verificação imediata (sem esperar o backoff): retomar.
    await h.prisma.queueTask.updateMany({ where: { jobId: job.id, status: 'QUEUED' }, data: { runAt: new Date() } });
    h.app.get(require('../../src/providers/provider-registry.service').ProviderRegistry).invalidate();
    const done = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${job.id}`)).body;
      return x.status === 'CONCLUIDO' ? x : null;
    });
    expect(done.attempts).toHaveLength(1);
  });

  it('ação destrutiva exige aprovação; operação financeira real é proibida', async () => {
    await h.http().post(`/api/projects/${pid}/jobs`).send({
      title: 'fin', objective: 'o',
      steps: [{ key: 'a', instructions: 'python3 -c "import MetaTrader5 as mt5; mt5.order_send(req)"' }],
    }).expect(400);
    await h.http().post(`/api/projects/${pid}/jobs`).send({
      title: 'fin2', objective: 'o',
      steps: [{ key: 'a', instructions: 'executar ordem real de compra de WIN' }],
    }).expect(400);

    const j = await runJob({
      title: 'destrutivo',
      steps: [{ key: 'limpar', instructions: 'mkdir -p tmp/x && rm -rf tmp/x && echo limpo > out/limpo.txt' }],
      criteria: [{ key: 'c', description: 'c', kind: 'ARTIFACT_PRESENT', config: { name: 'limpo.txt' } }],
    });
    expect(j.status).toBe('AGUARDANDO_APROVACAO');
    expect(j.steps[0].requiresApproval).toBe(true);
    expect(j.attempts).toHaveLength(0); // nada foi executado sem aprovação
    const appr = j.approvals.find((a: any) => a.kind === 'ACAO_DESTRUTIVA');
    expect(appr.description).toMatch(/rm -r/);
    await h.http().post(`/api/approvals/${appr.id}/decide`).send({ decision: 'APROVADO', decidedBy: 'Robson' }).expect(201);
    const done = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
      return x.status === 'CONCLUIDO' ? x : null;
    });
    expect(done.attempts).toHaveLength(1);
  });

  it('memória: EVIDENCIA/RESULTADO_VALIDADO exigem referências reproduzíveis', async () => {
    const r = await h.http().post(`/api/projects/${pid}/memory`).send({ category: 'RESULTADO_VALIDADO', title: 't', content: 'funciona' }).expect(400);
    expect(r.body.message).toMatch(/referências reproduzíveis/);
    await h.http().post(`/api/projects/${pid}/memory`).send({ category: 'DECISAO_APROVADA', title: 'usar 1min', content: 'timeframe 1min', author: 'Robson' }).expect(201);
    const art = await h.prisma.artifact.findFirstOrThrow({ where: { projectId: pid, kind: 'METRICS' } });
    const ds = await h.http().post(`/api/projects/${pid}/datasets`).send({ name: 'd', assetCode: 'WIN', uri: 'x.csv' });
    await h.http().post(`/api/projects/${pid}/memory`).send({
      category: 'EVIDENCIA', title: 'ok', content: 'c',
      references: { artifactIds: [art.id], datasetIds: [ds.body.id], gitCommit: 'abc', parameters: { a: 1 } },
    }).expect(201);
    const first = (await h.http().post(`/api/projects/${pid}/memory`).send({ category: 'PENDENCIA', title: 'p', content: 'v1' })).body;
    const v2 = (await h.http().post(`/api/projects/${pid}/memory/${first.id}/supersede`).send({ content: 'v2' }).expect(201)).body;
    expect(v2.version).toBe(2);
    const all = (await h.http().get(`/api/projects/${pid}/memory?category=PENDENCIA&all=1`)).body;
    expect(all.filter((m: any) => m.references?.origem !== 'licao-automatica').map((m: any) => m.content).sort()).toEqual(['v1', 'v2']);
  });
});
