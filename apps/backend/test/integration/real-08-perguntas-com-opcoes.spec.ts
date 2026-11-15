/**
 * REAL (opt-in: NIVOO_RUN_CLI_INTEGRATION=1; IA em NIVOO_ENSAIO_IA): pedido que depende de uma decisão do usuário →
 * a IA real pergunta com o campo "perguntas" (cartões com opções), em vez de listar perguntas no texto.
 */
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import { REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
const IA = process.env.NIVOO_ENSAIO_IA ?? 'claude-code-cli';

d(`REAL: perguntas com opções (${IA})`, () => {
  let h: Harness;
  beforeAll(async () => {
    delete process.env.NIVOO_CLAUDE_BIN;
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, IA);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
  });

  it('decisão que só o usuário toma vira cartões de opções', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Logo', provider: IA, description: 'Site institucional de uma padaria.' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({
      content: 'Quero uma página de contato no site. Antes de fazer, me pergunte o que você precisa decidir comigo (formulário ou só WhatsApp, e se mostra o mapa).',
    }).expect(201);
    const r = await waitFor(async () => {
      const ms = (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
      return ms.find((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE' && m.kind !== 'sistema') ?? null;
    }, 600_000);
    console.log('RESPOSTA:', r.kind, r.content, JSON.stringify(r.perguntas, null, 1));
    expect(Array.isArray(r.perguntas) && r.perguntas.length).toBeGreaterThan(0);
    for (const q of r.perguntas) expect(q.opcoes.length).toBeGreaterThanOrEqual(2);
  }, 15 * 60_000);
});
