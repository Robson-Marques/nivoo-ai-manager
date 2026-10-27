/**
 * Integração REAL com Claude Code CLI e Codex CLI — OPT-IN.
 * Executar somente no host autorizado do worker, com login oficial já feito:
 *   NIVOO_RUN_CLI_INTEGRATION=1 npx jest test/integration
 * Cada teste roda um job mínimo pelo conector e exige conclusão pelo verificador do backend.
 */
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

const enabled = process.env.NIVOO_RUN_CLI_INTEGRATION === '1';
const d = enabled ? describe : describe.skip;

d('Integração real dos conectores CLI (opt-in)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(() => h.close());

  for (const provider of ['claude-code-cli', 'codex-cli']) {
    it(`${provider}: cria arquivo pedido e passa no critério`, async () => {
      const status = (await h.http().post(`/api/providers/${provider}/check`).expect(201)).body;
      if (!status.available) throw new Error(`${provider} indisponível neste host: ${status.errors.join('; ')}`);
      const p = await createProject(h, `cli ${provider}`);
      const job = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: `integração ${provider}`,
        objective: 'Criar o arquivo out/ola.txt contendo exatamente a palavra: nivoo',
        defaultProvider: provider,
        limits: { maxCostUsd: 1, stepTimeoutSec: 300, maxAttemptsPerStep: 2 },
        steps: [{ key: 'criar', instructions: 'Crie o arquivo out/ola.txt (relativo ao diretório atual) contendo exatamente a palavra nivoo. Não faça mais nada.' }],
        criteria: [{ key: 'arquivo', description: 'arquivo com conteúdo', kind: 'COMMAND', config: { command: 'grep -qx nivoo out/ola.txt' } }],
      }).expect(201)).body;
      await h.http().post(`/api/projects/${p.id}/jobs/${job.id}/start`).expect(201);
      const done = await waitFor(async () => {
        const j = (await h.http().get(`/api/projects/${p.id}/jobs/${job.id}`)).body;
        return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(j.status) ? j : null;
      }, 600000, 2000);
      expect(done.status).toBe('CONCLUIDO');
    }, 650000);
  }
});
