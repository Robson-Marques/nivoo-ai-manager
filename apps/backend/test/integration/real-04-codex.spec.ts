/**
 * INTEGRAÇÃO REAL — Codex CLI (opt-in: NIVOO_RUN_CODEX_INTEGRATION=1).
 * Requer `codex` instalado e logado OFICIALMENTE no host do worker (`codex login`,
 * `codex login --device-auth` ou `printenv OPENAI_API_KEY | codex login --with-api-key`).
 * Se não houver login, o teste FALHA com a mensagem de bloqueio — nunca simula sucesso.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, killHard, spawnNode, truncateAll, waitFor } from '../support/harness';
import { exportEvidence } from '../support/real';

const d = process.env.NIVOO_RUN_CODEX_INTEGRATION === '1' ? describe : describe.skip;

d('Codex CLI real', () => {
  let h: Harness;
  let worker: any;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
  });
  afterAll(async () => {
    if (worker) await killHard(worker);
    await h.close();
  });

  it('executa uma etapa real e passa pelo verificador', async () => {
    const status = (await h.http().post('/api/providers/codex-cli/check').expect(201)).body;
    if (process.env.NIVOO_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.NIVOO_EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.NIVOO_EVIDENCE_DIR, 'real-04-codex-status.json'), JSON.stringify(status, null, 2));
    }
    if (!status.available) throw new Error(`BLOQUEIO: codex-cli indisponível — ${status.errors.join('; ')}`);
    worker = spawnNode('worker.js', { NIVOO_WORKER_ID: 'worker-codex' });
    const p = await createProject(h, 'codex real');
    const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
      title: 'codex', objective: 'Criar out/ola.txt contendo exatamente nivoo.', defaultProvider: 'codex-cli', conferencia: false,
      limits: { maxSessionsPerStep: 3, maxCostUsd: 1 },
      steps: [{ key: 'criar', instructions: 'Crie o arquivo out/ola.txt contendo exatamente a palavra nivoo.', verifyCommand: 'grep -qx nivoo out/ola.txt' }],
      criteria: [{ key: 'c', description: 'arquivo', kind: 'COMMAND', config: { command: 'grep -qx nivoo out/ola.txt' } }],
    }).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
    const done = await waitFor(async () => {
      const j = await h.prisma.job.findUnique({ where: { id: job.id } });
      return j && ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(j.status) ? j : null;
    }, 600000, 2000);
    await exportEvidence(h, job.id, 'real-04-codex');
    expect(done.status).toBe('CONCLUIDO');
  }, 700000);
});
