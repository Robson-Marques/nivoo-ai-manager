/**
 * Critério V1: funcionamento com navegador fechado.
 * API e worker rodam como processos REAIS. O "navegador" (cliente SSE) se conecta e é fechado;
 * a API é encerrada; o worker continua e conclui o job. Ao reabrir, o estado está completo.
 */
import { PrismaClient } from '@prisma/client';
import { killHard, spawnNode, waitFor } from '../support/harness';
import { resumableCounter } from '../support/scripts';

const PORT = 3917;
const base = `http://127.0.0.1:${PORT}/api`;

async function api(pathname: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status >= 400) throw new Error(`${method} ${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

describe('Funcionamento com navegador fechado', () => {
  const prisma = new PrismaClient();
  const procs: any[] = [];
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "Project", "QueueTask", "WorkerHeartbeat", "ProviderConfig" CASCADE`);
  });
  afterAll(async () => {
    for (const p of procs) await killHard(p);
    await prisma.$disconnect();
  });

  it('job continua e conclui após o cliente desconectar e a API parar', async () => {
    const apiProc = spawnNode('main.js', { PORT: String(PORT) });
    procs.push(apiProc);
    await waitFor(async () => (await fetch(`${base}/health`)).ok, 20000);
    const worker = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-headless' });
    procs.push(worker);

    const project = await api('/projects', 'POST', { name: 'Headless' });
    const job = await api(`/projects/${project.id}/jobs`, 'POST', {
      title: 'longo sem navegador',
      objective: 'Executar sem nenhum cliente conectado.',
      steps: [
        { key: 'a', instructions: resumableCounter(8, 0.3) },
        { key: 'b', dependsOn: ['a'], instructions: 'echo \'{"ok": 1}\' > out/metrics.json' },
      ],
      criteria: [{ key: 'm', description: 'ok', kind: 'METRIC_THRESHOLD', config: { path: 'ok', op: '==', value: 1 } }],
    });
    await api(`/projects/${project.id}/jobs/${job.id}/start`, 'POST');

    // "Navegador" abre o acompanhamento em tempo real e fecha logo em seguida.
    const ctrl = new AbortController();
    const sse = await fetch(`${base}/projects/${project.id}/jobs/${job.id}/events`, { signal: ctrl.signal });
    const reader = sse.body!.getReader();
    let first = '';
    while (!first.includes('event: state')) first += new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('EXECUTANDO');
    ctrl.abort();

    // Encerra a API: nenhuma interface ativa.
    await killHard(apiProc);
    const done = await waitFor(async () => {
      const j = await prisma.job.findUnique({ where: { id: job.id } });
      return j && ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(j.status) ? j : null;
    }, 60000, 300);
    expect(done.status).toBe('CONCLUIDO');

    // Reabre a interface (API) e consulta o estado completo.
    const api2 = spawnNode('main.js', { PORT: String(PORT) });
    procs.push(api2);
    await waitFor(async () => (await fetch(`${base}/health`)).ok, 20000);
    const full = await api(`/projects/${project.id}/jobs/${job.id}`);
    expect(full.status).toBe('CONCLUIDO');
    expect(full.attempts.every((a: any) => a.workerId === 'worker-headless')).toBe(true);
    const logs = await api(`/projects/${project.id}/jobs/${job.id}/logs`);
    expect(logs.some((l: any) => l.message === 'passo 8')).toBe(true);
    const workers = await api('/system/workers');
    expect(workers.find((w: any) => w.id === 'worker-headless').online).toBe(true);
  });
});
