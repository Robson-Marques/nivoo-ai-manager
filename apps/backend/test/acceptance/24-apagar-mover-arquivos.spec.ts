/**
 * Apagar/mover arquivos do projeto (as IAs não apagam; o Claude nem tem terminal): etapa do sistema
 * "arquivos-projeto" que executa direto (o "Fazer" do plano é a confirmação; o git guarda tudo), nunca mexe em
 * caminho protegido ou fora do projeto, e entra na pasta principal como qualquer trabalho.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

describe('Apagar e mover arquivos com confirmação', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    await h.close();
  });
  const ate = (pid: string, jid: string, estados: string[]) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${jid}`)).body;
      return estados.includes(x.status) ? x : null;
    }, 30_000);

  it('apaga e move direto, com registro; caminhos protegidos são recusados', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Limpeza' }).expect(201)).body;
    // Os arquivos já existem na pasta principal (trabalho anterior).
    const criar = (await h.http().post(`/api/projects/${p.id}/jobs`).send({
      title: 'criar', objective: 'x', defaultProvider: 'local-shell',
      steps: [{ key: 'criar', instructions: 'mkdir -p velho src && echo a > lixo.txt && echo b > velho/x.js && echo c > notas.md && echo d > src/app.ts' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    }).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${criar.id}/start`).expect(201);
    expect((await ate(p.id, criar.id, ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'])).status).toBe('CONCLUIDO');

    const corpo = (ops: any) => ({
      title: 'limpeza', objective: 'x', defaultProvider: 'arquivos-projeto',
      steps: [{ key: 'limpar', title: 'Apagar arquivos mortos', provider: 'arquivos-projeto', instructions: 'sem uso, conforme a auditoria', providerOptions: ops }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'test -f src/app.ts' } }],
    });
    for (const ruim of [{ remover: ['.git'] }, { remover: ['../fora'] }, { remover: ['contexto/base'] }, { remover: [] }, { mover: [{ de: 'a', para: '/etc/x' }] }]) {
      await h.http().post(`/api/projects/${p.id}/jobs`).send(corpo(ruim)).expect(400);
    }
    const j = (await h.http().post(`/api/projects/${p.id}/jobs`).send(corpo({ remover: ['lixo.txt', 'velho'], mover: [{ de: 'notas.md', para: 'docs/notas.md' }] })).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const fim = await ate(p.id, j.id, ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_APROVACAO']);
    expect(fim.status).toBe('CONCLUIDO');
    expect(fim.approvals ?? []).toHaveLength(0); // sem segunda confirmação: o "Fazer" já confirmou
    const repo = path.join(p.workspacePath, 'repo');
    const arquivos = execFileSync('git', ['ls-tree', '-r', '--name-only', 'main'], { cwd: repo }).toString().trim().split('\n');
    expect(arquivos.filter((f) => !['.gitignore', 'README.md'].includes(f)).sort()).toEqual(['docs/notas.md', 'src/app.ts']);
    const etapa = fim.attempts.find((a: any) => a.provider === 'arquivos-projeto');
    expect(etapa.output).toBe('movido: notas.md → docs/notas.md\napagado: lixo.txt\napagado: velho');
    // O que saiu fica no histórico do git: dá para voltar.
    expect(execFileSync('git', ['show', 'main~1:lixo.txt'], { cwd: repo }).toString()).toBe('a\n');
  });
});
