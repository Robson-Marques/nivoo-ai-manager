/**
 * Regressão: fila persistente com o PostgreSQL em fuso diferente de UTC (bug real no servidor, Debian 13
 * em America/Sao_Paulo). O Prisma grava `DateTime` em UTC em colunas `timestamp without time zone`; o SQL
 * bruto da fila comparava com `now()` (hora local da sessão) — tarefas novas ficavam 3 h sem ser
 * reivindicadas. Cada cenário roda com a sessão do banco em America/Sao_Paulo e em UTC.
 * O fuso é definido no BANCO de teste (ALTER DATABASE ... SET timezone), nunca no servidor.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { QueueService } from '../../src/queue/queue.service';
import { TEST_DB } from '../support/env';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const LEASE = 30_000;

async function fusoDoBanco(tz: string | null): Promise<void> {
  const dbName = new URL(TEST_DB).pathname.slice(1);
  const admin = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  try {
    await admin.$executeRawUnsafe(tz ? `ALTER DATABASE "${dbName}" SET timezone TO '${tz}'` : `ALTER DATABASE "${dbName}" RESET timezone`);
  } finally {
    await admin.$disconnect();
  }
}

describe.each(['America/Sao_Paulo', 'UTC'])('Fila persistente com o banco em %s', (tz) => {
  let h: Harness;
  let fila: QueueService;
  beforeAll(async () => {
    await fusoDoBanco(tz); // vale para as conexões novas (as do harness, criadas a seguir)
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    h = await createHarness();
    await truncateAll(h.prisma);
    fila = h.app.get(QueueService);
  });
  afterAll(async () => {
    await h.close();
    await fusoDoBanco(null);
    delete process.env.NIVOO_CLAUDE_BIN;
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('a sessão do banco está mesmo no fuso do cenário', async () => {
    const [{ timezone }] = await h.prisma.$queryRawUnsafe<Array<{ timezone: string }>>(`SELECT current_setting('TimeZone') AS timezone`);
    expect(timezone).toBe(tz);
  });

  it('tarefa recém-enfileirada é reivindicada na hora (claims 0 → 1); tarefa futura não', async () => {
    await h.prisma.queueTask.deleteMany({});
    const p = await createProject(h, `fila agora ${tz}`);
    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 't', objective: 'o', steps: [{ key: 's', instructions: 'true' }] }).expect(201)).body;
    const futura = await fila.enqueue(h.prisma, 'EVALUATE_JOB', job.id, null, new Date(Date.now() + 60_000));
    const nova = await fila.enqueue(h.prisma, 'RUN_STEP', job.id, job.steps[0].id);
    expect(nova!.claims).toBe(0);
    const t = await fila.claim('worker-teste', LEASE);
    expect(t?.id).toBe(nova!.id);
    expect(t!.claims).toBe(1);
    expect(t!.status).toBe('RUNNING');
    // lockedUntil gravado em UTC: cerca de LEASE ms à frente do relógio real (não 3 h de diferença).
    expect(Math.abs(t!.lockedUntil!.getTime() - (Date.now() + LEASE))).toBeLessThan(10_000);
    expect(Math.abs(t!.updatedAt.getTime() - Date.now())).toBeLessThan(10_000);
    // A tarefa marcada para daqui a 1 minuto continua esperando.
    expect(await fila.claim('worker-teste', LEASE)).toBeNull();
    expect((await h.prisma.queueTask.findUniqueOrThrow({ where: { id: futura!.id } })).status).toBe('QUEUED');
  });

  it('heartbeat renova o lease; lease expirado é recuperado por outro worker; quedas repetidas viram DEAD', async () => {
    await h.prisma.queueTask.deleteMany({});
    const p = await createProject(h, `fila lease ${tz}`);
    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 't', objective: 'o', steps: [{ key: 's', instructions: 'true' }] }).expect(201)).body;
    const tarefa = await fila.enqueue(h.prisma, 'RUN_STEP', job.id, job.steps[0].id);
    const a = await fila.claim('worker-a', 2_000);
    expect(a?.id).toBe(tarefa!.id);
    expect(await fila.heartbeat(a!.id, 'worker-a', a!.claims, LEASE)).toBe(true);
    const renovada = await h.prisma.queueTask.findUniqueOrThrow({ where: { id: a!.id } });
    expect(Math.abs(renovada.lockedUntil!.getTime() - (Date.now() + LEASE))).toBeLessThan(10_000);
    expect(Math.abs(renovada.updatedAt.getTime() - Date.now())).toBeLessThan(10_000);
    // Lease ainda válido: outro worker não pega.
    expect(await fila.claim('worker-b', LEASE)).toBeNull();
    // Worker A "morre": lease vence (no passado, em UTC) e B recupera.
    await h.prisma.queueTask.update({ where: { id: a!.id }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    const b = await fila.claim('worker-b', LEASE);
    expect(b?.id).toBe(a!.id);
    expect(b!.recovered).toBe(true);
    expect(b!.previousLockedBy).toBe('worker-a');
    expect(b!.recoveries).toBe(1);
    expect(await fila.heartbeat(a!.id, 'worker-a', a!.claims, LEASE)).toBe(false); // A perdeu o lease (geração antiga)
    // Quedas repetidas com lease vencido: a tarefa vira DEAD e o job é bloqueado (não fica preso).
    await h.prisma.job.update({ where: { id: job.id }, data: { status: 'EXECUTANDO' } });
    await h.prisma.queueTask.update({ where: { id: a!.id }, data: { recoveries: 5, lockedUntil: new Date(Date.now() - 1_000) } });
    expect(await fila.claim('worker-c', LEASE)).toBeNull();
    const morta = await h.prisma.queueTask.findUniqueOrThrow({ where: { id: a!.id } });
    expect(morta.status).toBe('DEAD');
    expect(Math.abs(morta.updatedAt.getTime() - Date.now())).toBeLessThan(10_000);
    expect((await h.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).blockedReason).toBe('FALHA_INFRAESTRUTURA');
  });

  it('o worker consome RUN_STEP (trabalho conclui) e PLAN_MESSAGE (o chat responde)', async () => {
    await h.prisma.queueTask.deleteMany({});
    h.worker.start();
    try {
      const p = await createProject(h, `fila worker ${tz}`);
      const j = (
        await h.http().post(`/api/projects/${p.id}/jobs`).send({
          title: 'verificacao',
          objective: 'o',
          steps: [{ key: 's', instructions: 'echo ok > out/ok.txt' }],
          criteria: [{ key: 'c', description: 'c', kind: 'ARTIFACT_PRESENT', config: { name: 'ok.txt' } }],
        }).expect(201)
      ).body;
      await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
      const feito = await waitFor(async () => {
        const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
        return x.status === 'CONCLUIDO' ? x : null;
      }, 20_000);
      expect(feito.attempts).toHaveLength(1);

      ctl('mode', 'texto');
      ctl('resposta.txt', '```json\n' + JSON.stringify({ tipo: 'resposta', texto: `respondi em ${tz}`, memoria: [] }) + '\n```');
      const conv = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
      await h.http().post(`/api/projects/${p.id}/conversations/${conv.id}/messages`).send({ content: 'oi' }).expect(201);
      const r = await waitFor(async () => {
        const x = (await h.http().get(`/api/projects/${p.id}/conversations/${conv.id}`)).body;
        const m = x.messages.find((y: any) => y.role === 'ASSISTENTE');
        return m && m.status !== 'PENDENTE' ? m : null;
      }, 20_000);
      expect(r.content).toBe(`respondi em ${tz}`);
      // Heartbeat do worker gravado em UTC: a tela mostra o worker online.
      const workers = (await h.http().get('/api/system/workers')).body;
      expect(workers.some((w: any) => w.online)).toBe(true);
    } finally {
      await h.worker.stop();
    }
  });
});
