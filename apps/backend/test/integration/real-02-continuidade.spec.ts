/**
 * INTEGRAÇÃO REAL — continuidade entre múltiplas sessões de IA (opt-in: NIVOO_RUN_CLI_INTEGRATION=1).
 *
 * Cenário:
 *  - Etapa 1 exige várias ações; cada sessão do Claude Code tem limite de 2 turnos → o trabalho
 *    atravessa várias sessões reais. No meio, o worker A é morto (SIGKILL) e o worker B assume.
 *  - Etapa 2 roda em outra sessão e só pode passar se usar informações que existem apenas na
 *    memória do projeto no banco (hipótese e decisão aprovada com códigos únicos), não em arquivos.
 *  - Nenhum comando manual de continuação é emitido (sem /resume, sem /start adicional).
 * Verifica: objetivo v1 íntegro em todos os prompts, notas do agente preservadas e repassadas,
 * artefatos e checkpoints preservados, conclusão apenas pelo verificador.
 */
import { createHarness, createProject, Harness, killHard, spawnNode, truncateAll, waitFor } from '../support/harness';
import { exportEvidence, readArtifact, REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
const OBJETIVO = 'Implementar em Python as funções de indicadores media_movel, desvio_padrao e zscore (uma por arquivo em src/) usando a janela padrão definida nas decisões aprovadas do projeto, e documentar em out/resumo.md citando a hipótese em investigação. [marcador-objetivo: OBJ-CONT-91X]';

d('Continuidade real entre sessões e workers', () => {
  let h: Harness;
  const procs: any[] = [];
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, 'claude-code-cli');
  });
  afterAll(async () => {
    for (const p of procs) await killHard(p);
    await h.close();
  });

  it('trabalho atravessa várias sessões e uma queda de worker sem perder objetivo, decisões, hipóteses, notas e artefatos', async () => {
    const p = await createProject(h, 'continuidade real');
    await h.http().post(`/api/projects/${p.id}/memory`).send({ category: 'ESPECIFICACAO', title: 'H-CONT-7Q: hipótese em investigação', content: 'Hipótese H-CONT-7Q: o z-score de 20 períodos identifica excessos que revertem.', author: 'operador' }).expect(201);
    await h.http().post(`/api/projects/${p.id}/memory`).send({ category: 'DECISAO_APROVADA', title: 'D-JAN-20: janela padrão', content: 'Decisão D-JAN-20: a janela padrão dos indicadores é 20 períodos.', author: 'operador' }).expect(201);

    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
      title: 'indicadores em várias sessões',
      objective: OBJETIVO,
      defaultProvider: 'claude-code-cli',
      conferencia: false, // este teste mede continuidade; a conferência das regras tem prova própria (real-06)
      limits: { maxSessionsPerStep: 12, maxCostUsd: 6, stepTimeoutSec: 300, maxDurationSec: 3600, repetitionWindow: 3 },
      steps: [
        {
          key: 'funcoes',
          instructions: [
            'Crie, UM ARQUIVO POR VEZ e nesta ordem, src/media_movel.py (função media_movel(xs, n=JANELA)), src/desvio_padrao.py (função desvio_padrao(xs, n=JANELA), desvio populacional) e src/zscore.py (função zscore(xs, n=JANELA) = (último - média)/desvio da janela final; importe das outras com "from media_movel import media_movel" e "from desvio_padrao import desvio_padrao").',
            'JANELA é o valor padrão definido na decisão aprovada do projeto. Cada função recebe lista de floats e calcula sobre os últimos n valores.',
            'Não explore o diretório: o contexto (checkpoint, notas e memória) diz o que sessões anteriores já fizeram. Se estiver em dúvida, use no máximo um Glob em src/.',
            'Logo após criar cada arquivo, acrescente uma nota PROGRESSO em .nivoo/notas.jsonl dizendo o que foi feito e o que falta.',
          ].join('\n'),
          providerOptions: { maxTurns: 4 },
          verifyCommand: 'cd src && python3 -c "import inspect,media_movel as a,desvio_padrao as b,zscore as c; assert all(inspect.signature(f).parameters[\'n\'].default==20 for f in (a.media_movel,b.desvio_padrao,c.zscore)); xs=[float(i) for i in range(1,41)]; assert abs(a.media_movel(xs)-30.5)<1e-9; assert abs(b.desvio_padrao(xs)-5.766281297335398)<1e-6; assert abs(c.zscore(xs)-(40-30.5)/5.766281297335398)<1e-6"',
        },
        {
          key: 'resumo',
          dependsOn: ['funcoes'],
          instructions: 'Escreva out/resumo.md (em português) descrevendo as três funções criadas em src/, citando literalmente o código da hipótese em investigação do projeto e o código da decisão aprovada sobre a janela, conforme constam na memória do projeto.',
          verifyCommand: 'grep -q "H-CONT-7Q" out/resumo.md && grep -q "D-JAN-20" out/resumo.md',
        },
      ],
      criteria: [
        { key: 'testes', description: 'funções corretas com janela 20', kind: 'COMMAND', config: { command: 'cd src && python3 -c "import zscore; xs=[float(i) for i in range(1,41)]; assert abs(zscore.zscore(xs)-9.5/5.766281297335398)<1e-6"' } },
        { key: 'resumo', description: 'resumo cita hipótese e decisão', kind: 'ARTIFACT_PRESENT', config: { name: 'resumo.md' } },
        { key: 'arquivos', description: 'código versionado', kind: 'FILE_EXISTS', config: { path: 'src/zscore.py' } },
      ],
    }).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);

    // Worker A começa; é morto durante uma sessão posterior à primeira.
    const workerA = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-A-real', NIVOO_LEASE_MS: '6000' });
    procs.push(workerA);
    await waitFor(async () => {
      const ended = await h.prisma.attempt.count({ where: { jobId: job.id, status: { not: 'EXECUTANDO' } } });
      const running = await h.prisma.attempt.findFirst({ where: { jobId: job.id, status: 'EXECUTANDO', pid: { not: null } } });
      return ended >= 1 && running ? running : null;
    }, 600000, 1000);
    await new Promise((res) => setTimeout(res, 1500)); // deixa a sessão começar a trabalhar
    await killHard(workerA);
    const orphanAttempt = await h.prisma.attempt.findFirst({ where: { jobId: job.id, status: 'EXECUTANDO' } });

    const workerB = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-B-real', NIVOO_LEASE_MS: '6000' });
    procs.push(workerB);
    const done = await waitFor(async () => {
      const j = await h.prisma.job.findUnique({ where: { id: job.id } });
      return j && ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(j.status) ? j : null;
    }, 1500000, 3000);

    const ev = await exportEvidence(h, job.id, 'real-02-continuidade', {
      tentativaInterrompidaPelaQuedaDoWorker: orphanAttempt?.id ?? null,
      comandosManuaisDeContinuacao: 0,
    });
    // Prompt completo de uma sessão posterior (para auditoria humana).
    const prompts = await h.prisma.artifact.findMany({ where: { jobId: job.id, kind: 'PROMPT' }, orderBy: { createdAt: 'asc' } });
    const lastFuncoes = [...prompts].reverse().find((a) => a.name.startsWith('prompts/funcoes/'));
    if (process.env.NIVOO_EVIDENCE_DIR && lastFuncoes) {
      require('node:fs').writeFileSync(`${process.env.NIVOO_EVIDENCE_DIR}/real-02-prompt-ultima-sessao-funcoes.md`, readArtifact(p.id, lastFuncoes.storagePath));
    }

    expect(done.status).toBe('CONCLUIDO');
    // Várias sessões reais distintas no job e uma queda real de worker no meio de uma sessão.
    // (Quantas sessões cada etapa usa depende do modelo; a continuação dentro de UMA etapa é provada em real-01a.)
    expect(new Set(ev.sessoes.map((s: any) => s.sessionId).filter(Boolean)).size).toBeGreaterThanOrEqual(2);
    const queda = ev.sessoes.findIndex((s: any) => s.status === 'INTERROMPIDA' && s.worker === 'worker-A-real');
    expect(queda).toBeGreaterThanOrEqual(0);
    // Tudo depois da queda foi feito pelo worker B, sem comando manual.
    expect(ev.sessoes.slice(queda + 1).every((s: any) => s.worker === 'worker-B-real')).toBe(true);
    expect(ev.sessoes.slice(queda + 1).some((s: any) => s.status === 'SUCESSO')).toBe(true);
    // Objetivo íntegro: uma única versão, mesmo hash, presente em todos os prompts.
    expect(ev.objetivo).toHaveLength(1);
    expect(ev.prompts.length).toBe(ev.sessoes.length);
    expect(ev.prompts.every((x: any) => x.contemObjetivoV1Integro)).toBe(true);
    // Notas do agente preservadas na memória e repassadas às sessões seguintes.
    expect(ev.memoria.some((m: any) => m.autor.startsWith('agente:claude-code-cli'))).toBe(true);
    expect(ev.prompts.slice(1).some((x: any) => x.contemNotasDoAgente)).toBe(true);
    // Hipótese e decisão (só no banco) chegaram à sessão da etapa 2.
    expect(ev.criterios.every((c: any) => c.status === 'APROVADO')).toBe(true);
    expect(ev.memoria.find((m: any) => m.titulo.startsWith('H-CONT-7Q'))).toBeDefined();
  }, 1800000);
});
