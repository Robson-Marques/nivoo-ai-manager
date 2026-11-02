/**
 * Regressões dos 10 problemas encontrados pela revisão independente de 2026-11-02 (docs/REVISAO-2026-11-02.md).
 * Executor: local-shell real; o stub TEST-ONLY do Claude só onde é preciso simular o provedor
 * (violação de isolamento e sessão que estoura o tempo).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QueueService } from '../../src/queue/queue.service';
import { ClaudeCodeCliProvider } from '../../src/providers/claude-code-cli.provider';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const criterio = [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }];

describe('Revisão independente — regressões', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
  });

  const job = async (pid: string, body: any, start = true) => {
    const j = (await h.http().post(`/api/projects/${pid}/jobs`).send({ objective: 'o', criteria: criterio, ...body }).expect(201)).body;
    if (start) await h.http().post(`/api/projects/${pid}/jobs/${j.id}/start`).expect(201);
    return j;
  };
  const ate = (pid: string, jid: string, estados: string[], ms = 30000) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${jid}`)).body;
      return estados.includes(x.status) ? x : null;
    }, ms);

  it('#2 retomar com a sessão ainda sendo encerrada é recusado (não abre sessão paralela)', async () => {
    const p = await createProject(h, 'rev retomada');
    // Ignora SIGTERM: o encerramento leva o tempo do SIGKILL (3 s), abrindo a janela da corrida.
    const j = await job(p.id, { title: 't', steps: [{ key: 's', instructions: "trap '' TERM; echo inicio; sleep 20" }] });
    await waitFor(() => h.prisma.attempt.findFirst({ where: { jobId: j.id, status: 'EXECUTANDO', pid: { not: null } } }));
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/interrupt`).expect(201);
    const r = await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/resume`).expect(409);
    expect(r.body.message).toMatch(/ainda está sendo encerrada/);
    expect(await h.prisma.queueTask.count({ where: { jobId: j.id, status: { in: ['QUEUED', 'RUNNING'] } } })).toBe(0);
    await waitFor(async () => (await h.prisma.attempt.findFirst({ where: { jobId: j.id } }))?.status === 'INTERROMPIDA', 20000);
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/interrupt`).send({}).expect(409); // já bloqueado
  });

  it('#10 retomar um job FALHOU por limite de tentativas executa de novo (limites contam a partir da retomada)', async () => {
    const p = await createProject(h, 'rev falhou');
    const j = await job(p.id, {
      title: 't', limits: { maxAttemptsPerStep: 1 },
      steps: [{ key: 's', instructions: 'if [ -f out/segunda ]; then echo ok; else touch out/segunda; echo falha; exit 1; fi' }],
    });
    const f = await ate(p.id, j.id, ['FALHOU', 'CONCLUIDO', 'BLOQUEADO']);
    expect(f.status).toBe('FALHOU');
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/resume`).send({}).expect(201);
    const d = await ate(p.id, j.id, ['CONCLUIDO', 'FALHOU', 'BLOQUEADO']);
    expect(d.status).toBe('CONCLUIDO');
    expect(d.attempts.map((a: any) => a.status)).toEqual(['FALHA', 'SUCESSO']);
  });

  it('#8 fila: tarefa saudável com muitas reivindicações é recuperada; só quedas repetidas a descartam, bloqueando o job', async () => {
    const p = await createProject(h, 'rev fila');
    await h.worker.stop(); // controla a fila manualmente neste teste
    try {
      const j = await job(p.id, { title: 'saudavel', steps: [{ key: 's', instructions: 'true' }] });
      const queue = h.app.get(QueueService);
      const passado = new Date(Date.now() - 60_000);
      await h.prisma.queueTask.updateMany({ where: { jobId: j.id }, data: { status: 'RUNNING', lockedBy: 'w-velho', lockedUntil: passado, claims: 30, recoveries: 0 } });
      const t = await queue.claim('w-novo', 3000);
      expect(t?.jobId).toBe(j.id);
      expect(t?.recovered).toBe(true);
      expect((await h.prisma.queueTask.findUniqueOrThrow({ where: { id: t!.id } })).recoveries).toBe(1);

      const j2 = await job(p.id, { title: 'derruba worker', steps: [{ key: 's', instructions: 'true' }] });
      await h.prisma.queueTask.updateMany({ where: { jobId: j2.id }, data: { status: 'RUNNING', lockedBy: 'w-velho', lockedUntil: passado, claims: 6, recoveries: 5 } });
      await h.prisma.queueTask.updateMany({ where: { jobId: j.id }, data: { status: 'DONE' } });
      expect(await queue.claim('w-novo', 3000)).toBeNull();
      const bloqueado = await h.prisma.job.findUniqueOrThrow({ where: { id: j2.id } });
      expect(bloqueado.status).toBe('BLOQUEADO');
      expect(bloqueado.blockedReason).toBe('FALHA_INFRAESTRUTURA');
    } finally {
      h.worker.start();
    }
  });

  it('#3 link simbólico em dados/ não é seguido: o arquivo fora do workspace fica intacto', async () => {
    const p = await createProject(h, 'rev symlink');
    const dataDir = path.join(p.workspacePath, 'data');
    fs.writeFileSync(path.join(dataDir, 'win.csv'), 'timestamp,open,high,low,close,volume\n');
    fs.writeFileSync(path.join(dataDir, 'alvo.txt'), 'NAO-ALTERAR');
    const r = (await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WIN'] }).expect(201)).body;
    const ds = (await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'd', assetCode: 'WIN', uri: 'win.csv' }).expect(201)).body;
    const j = await job(p.id, {
      title: 't', researchId: r.id, experiment: { name: 'e', datasetId: ds.id },
      steps: [
        { key: 'plantar', instructions: 'rm -f dados/win.csv && ln -s "$NIVOO_DATA_DIR/alvo.txt" dados/win.csv' },
        { key: 'depois', dependsOn: ['plantar'], instructions: 'test ! -L dados/win.csv && head -1 dados/win.csv' },
      ],
    });
    const d = await ate(p.id, j.id, ['CONCLUIDO', 'FALHOU', 'BLOQUEADO']);
    expect(d.status).toBe('CONCLUIDO');
    expect(fs.readFileSync(path.join(dataDir, 'alvo.txt'), 'utf8')).toBe('NAO-ALTERAR');
    expect(fs.lstatSync(path.join(p.workspacePath, 'worktrees', j.id, 'dados', 'win.csv')).isSymbolicLink()).toBe(false);
  });

  it('#4 validar não aceita em silêncio um arquivo alterado; o experimento é bloqueado', async () => {
    const p = await createProject(h, 'rev dataset');
    const arq = path.join(p.workspacePath, 'data', 'v.csv');
    fs.writeFileSync(arq, 'timestamp,open,high,low,close,volume\n');
    const ds = (await h.http().post(`/api/projects/${p.id}/datasets`).send({ name: 'v', assetCode: 'WIN', uri: 'v.csv' }).expect(201)).body;
    fs.appendFileSync(arq, '2026-01-02T09:00:00,130000,130000,130000,130000,1\n');
    const v = (await h.http().post(`/api/projects/${p.id}/datasets/${ds.id}/validate`).expect(201)).body;
    expect(v.integro).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.sha256Registrado).toBe(ds.sha256);
    expect((await h.prisma.dataset.findUniqueOrThrow({ where: { id: ds.id } })).sha256).toBe(ds.sha256);
    const r = (await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WIN'] }).expect(201)).body;
    const j = await job(p.id, { title: 't', researchId: r.id, experiment: { name: 'e', datasetId: ds.id }, steps: [{ key: 's', instructions: 'true' }] });
    const b = await ate(p.id, j.id, ['BLOQUEADO', 'CONCLUIDO']);
    expect(b.status).toBe('BLOQUEADO');
    expect(b.statusDetail).toMatch(/alterado/);
  });

  it('#5 hipótese já decidida não pode ser redecidida (memória sem contradição)', async () => {
    const p = await createProject(h, 'rev hipotese');
    const r = (await h.http().post(`/api/projects/${p.id}/researches`).send({ title: 'r', question: 'q', assetCodes: ['WIN'] }).expect(201)).body;
    const hy = (await h.http().post(`/api/projects/${p.id}/researches/${r.id}/hypotheses`).send({ statement: 'H' }).expect(201)).body;
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${hy.id}`).send({ status: 'REJEITADA', conclusion: 'não' }).expect(200);
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${hy.id}`).send({ status: 'EM_INVESTIGACAO' }).expect(400);
    await h.http().patch(`/api/projects/${p.id}/hypotheses/${hy.id}`).send({ status: 'REJEITADA', conclusion: 'de novo' }).expect(400);
    const rej = (await h.http().get(`/api/projects/${p.id}/memory?category=HIPOTESE_REJEITADA`)).body;
    expect(rej).toHaveLength(1);
  });

  it('#6 sessão que viola o isolamento tem o custo contado no orçamento (SIMULADO: stub)', async () => {
    const p = await createProject(h, 'rev violacao');
    ctl('mode', 'violar');
    const j = await job(p.id, { title: 't', defaultProvider: 'claude-code-cli', steps: [{ key: 's', instructions: 'x', verifyCommand: 'true' }] });
    const b = await ate(p.id, j.id, ['BLOQUEADO', 'CONCLUIDO']);
    ctl('mode', null);
    expect(b.status).toBe('BLOQUEADO');
    expect(b.blockedReason).toBe('POLITICA');
    expect(Number(b.costSpentUsd)).toBeCloseTo(0.5);
    expect(Number(b.attempts[0].costUsd)).toBeCloseTo(0.5);
  });

  it('#7 sessão que estoura o tempo tem o custo estimado pelos tokens e contado (SIMULADO: stub)', async () => {
    expect(ClaudeCodeCliProvider.estimateFromStream('{"type":"assistant","message":{"id":"a","usage":{"input_tokens":1000000,"output_tokens":0}}}\n{"type":"assistant","message":{"id":"a","usage":{"input_tokens":1000000,"output_tokens":0}}}').costUsd).toBe(3);
    const p = await createProject(h, 'rev timeout');
    ctl('mode', 'lento');
    const j = await job(p.id, {
      title: 't', defaultProvider: 'claude-code-cli', limits: { stepTimeoutSec: 2, maxAttemptsPerStep: 1 },
      steps: [{ key: 's', instructions: 'x', verifyCommand: 'true' }],
    });
    const f = await ate(p.id, j.id, ['FALHOU', 'BLOQUEADO', 'CONCLUIDO'], 40000);
    ctl('mode', null);
    expect(f.attempts[0].costEstimated).toBe(true);
    expect(Number(f.attempts[0].costUsd)).toBeCloseTo((1000 * 3 + 2000 * 15) / 1e6, 4);
    expect(Number(f.costSpentUsd)).toBeGreaterThan(0);
  });

  it('#9 SSE: reconexão com Last-Event-ID não reenvia o histórico', async () => {
    const p = await createProject(h, 'rev sse');
    const j = await job(p.id, { title: 't', steps: [{ key: 's', instructions: 'echo linha-antiga' }] });
    await ate(p.id, j.id, ['CONCLUIDO']);
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/logs`)).body;
    const ultimo = logs[logs.length - 1].id;
    const server = h.app.getHttpServer();
    if (!server.listening) await new Promise<void>((res) => server.listen(0, res));
    const url = `http://127.0.0.1:${server.address().port}/api/projects/${p.id}/jobs/${j.id}/events`;
    const ler = async (headers: Record<string, string>) => {
      const ctrl = new AbortController();
      const res = await fetch(url, { headers, signal: ctrl.signal });
      const reader = res.body!.getReader();
      let txt = '';
      const fim = Date.now() + 2500;
      while (Date.now() < fim) {
        const r = await Promise.race([reader.read(), new Promise<any>((ok) => setTimeout(() => ok({ value: undefined }), 300))]);
        if (r.value) txt += new TextDecoder().decode(r.value);
      }
      ctrl.abort();
      return txt;
    };
    const completo = await ler({});
    expect(completo).toContain('linha-antiga');
    expect(completo).toMatch(new RegExp(`id: ${ultimo}`));
    const reconexao = await ler({ 'Last-Event-ID': String(ultimo) });
    expect(reconexao).toContain('event: state');
    expect(reconexao).not.toContain('linha-antiga');
  });
});
