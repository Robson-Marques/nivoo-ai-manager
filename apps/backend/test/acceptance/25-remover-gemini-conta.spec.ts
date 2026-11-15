/**
 * Gemini pela conta Google (encerrado pelo Google) removido do Nivoo: na atualização, as conexões dele saem
 * (com login e pasta), e projetos, trabalhos em andamento e listas de reserva passam para outra IA.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gravarConexoes, listarConexoes } from '../../src/accounts/connections';
import { removerGeminiConta } from '../../src/accounts/remover-gemini-conta';
import { createHarness, Harness, truncateAll } from '../support/harness';

describe('Remoção do Gemini pela conta', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
  });
  afterAll(() => h.close());

  it('conexões saem; projetos, reservas, modelos e trabalhos em andamento passam para a IA padrão', async () => {
    const extra = 'gemini-cli--0123abcd';
    fs.mkdirSync(path.join(os.homedir(), '.nivoo-ia', extra), { recursive: true });
    gravarConexoes([
      { id: 'gemini-cli', tipo: 'gemini-cli' as never, nome: 'Gemini (conta)', padrao: true, criadaEm: 'x' },
      { id: extra, tipo: 'gemini-cli' as never, nome: 'Gemini 2', padrao: false, criadaEm: 'x' },
      { id: 'codex-cli', tipo: 'codex-cli', nome: 'ChatGPT', padrao: false, criadaEm: 'x' },
    ]);
    const p = (await h.http().post('/api/projects').send({ name: 'Usava Gemini', provider: 'codex-cli' }).expect(201)).body;
    const j = (await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 't', objective: 'x', defaultProvider: 'codex-cli', steps: [{ key: 's', instructions: 'x', verifyCommand: 'true' }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(201)).body;
    // Estado antigo: projeto, reserva, modelo e etapa apontando para o Gemini pela conta.
    await h.prisma.project.update({ where: { id: p.id }, data: { provider: 'gemini-cli', aiReserva: ['gemini-cli', extra, 'codex-cli'], aiModels: { 'gemini-cli': 'gemini-2.5-pro', 'codex-cli': 'gpt-x' } } });
    await h.prisma.step.updateMany({ where: { jobId: j.id }, data: { provider: 'gemini-cli' } });
    await h.prisma.job.update({ where: { id: j.id }, data: { defaultProvider: 'gemini-cli' } });

    expect(await removerGeminiConta(h.prisma)).toEqual(['Gemini (conta)', 'Gemini 2']);
    expect(listarConexoes().map((c) => [c.id, c.padrao])).toEqual([['codex-cli', true]]);
    expect(fs.existsSync(path.join(os.homedir(), '.nivoo-ia', extra))).toBe(false);
    const proj = await h.prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect([proj.provider, proj.aiReserva, proj.aiModels]).toEqual(['codex-cli', ['codex-cli'], { 'codex-cli': 'gpt-x' }]);
    const job = await h.prisma.job.findUniqueOrThrow({ where: { id: j.id }, include: { steps: true } });
    expect(job.defaultProvider).toBe('codex-cli');
    expect(job.steps.find((s) => s.key === 's')!.provider).toBe('codex-cli');
    // A tela de Conexões funciona e não mostra mais o Gemini pela conta.
    expect((await h.http().get('/api/accounts').expect(200)).body.map((c: any) => c.id)).toEqual(['codex-cli']);
    // Rodar de novo não muda nada.
    expect(await removerGeminiConta(h.prisma)).toEqual([]);
  });
});
