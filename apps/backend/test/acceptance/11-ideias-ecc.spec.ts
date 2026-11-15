/**
 * Ideias trazidas da análise do ECC, reimplementadas no Nivoo (automatizado; o executor de IA é o
 * stub TEST-ONLY, que só registra o prompt recebido — a prova com Claude real está em real-05).
 *  - limpeza de arquivos de harness plantados no workspace (hooks / CLAUDE.md / AGENTS.md)
 *  - orçamento de contexto com memória completa em .nivoo/memoria.md (fora do git)
 *  - lições de falha por projeto entrando no contexto de jobs futuros (e não de outros projetos)
 *  - orçamento de custo do projeto
 *  - aprovação válida só para o conteúdo aprovado (hash)
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, createProject, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const promptRecebido = () => fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');

describe('Ideias do ECC no Nivoo', () => {
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
    delete process.env.NIVOO_CONTEXT_MAX_CHARS;
    fs.rmSync(CTL, { recursive: true, force: true });
  });

  async function run(pid: string, body: any, until = ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_APROVACAO']) {
    const job = (await h.http().post(`/api/projects/${pid}/jobs`).send({ objective: 'objetivo', conferencia: false, ...body }).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${job.id}/start`).expect(201);
    return waitFor(async () => {
      const j = (await h.http().get(`/api/projects/${pid}/jobs/${job.id}`)).body;
      return until.includes(j.status) ? j : null;
    }, 30000);
  }

  it('remove configuração de harness plantada antes da sessão de IA (hooks); documentos de instrução ficam fora da sessão e voltam', async () => {
    const p = await createProject(h, 'harness');
    const j = await run(p.id, {
      title: 'plantio',
      steps: [
        { key: 'plantar', instructions: 'mkdir -p .claude sub/.claude && echo "{\\"hooks\\":{}}" > .claude/settings.json && echo "regra oculta" > CLAUDE.md && echo x > AGENTS.md && echo y > sub/.claude/x && echo ok > out/feito.txt' },
        { key: 'ia', provider: 'claude-code-cli', dependsOn: ['plantar'], instructions: 'trabalhe', verifyCommand: 'test -f out/feito.txt' },
      ],
      criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'out/feito.txt' } }],
    });
    expect(j.status).toBe('CONCLUIDO');
    const wt = path.join(p.workspacePath, 'worktrees', j.id);
    // Configuração (hooks, .claude/) é sempre removida.
    for (const f of ['.claude', 'sub/.claude']) expect(fs.existsSync(path.join(wt, f))).toBe(false);
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/logs`)).body.map((l: any) => l.message).join('\n');
    const linha = logs.split('\n').find((l: string) => l.startsWith('Arquivos de harness removidos antes da sessão')) ?? '';
    for (const f of ['.claude', 'sub/.claude']) expect(linha.split(/[:,] /)).toContain(f);
    // Documentos (CLAUDE.md, AGENTS.md) escritos por uma etapa do trabalho são do trabalho: durante a sessão de IA
    // ficam fora da pasta (só a cópia legível em contexto/repositorio/, que não vale como configuração) e voltam depois.
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toMatch(/CLAUDE\.md, AGENTS\.md ficam fora da pasta|AGENTS\.md, CLAUDE\.md ficam fora da pasta/);
    expect(fs.readFileSync(path.join(wt, 'CLAUDE.md'), 'utf8')).toBe('regra oculta\n');
  });

  it('orçamento de contexto: decisões entram, excesso é omitido e declarado; memória íntegra em .nivoo/memoria.md fora do git', async () => {
    const p = await createProject(h, 'orcamento contexto');
    await h.http().post(`/api/projects/${p.id}/memory`).send({ category: 'DECISAO_APROVADA', title: 'D-PRIORIDADE', content: 'decisão que nunca pode sumir' }).expect(201);
    for (let i = 0; i < 40; i++) {
      await h.http().post(`/api/projects/${p.id}/memory`).send({ category: 'PENDENCIA', title: `nota-${i}`, content: `PENDENCIA-${i} ` + 'x'.repeat(400) }).expect(201);
    }
    process.env.NIVOO_CONTEXT_MAX_CHARS = '6000';
    const j = await run(p.id, {
      title: 'contexto', defaultProvider: 'claude-code-cli',
      steps: [{ key: 'a', instructions: 'trabalhe', verifyCommand: 'true' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    delete process.env.NIVOO_CONTEXT_MAX_CHARS;
    const prompt = promptRecebido();
    expect(prompt).toContain('D-PRIORIDADE');
    expect(prompt).toMatch(/entrada\(s\) de memória de menor prioridade foram omitidas/);
    expect(prompt).toContain('PENDENCIA-39'); // mais recente entra antes
    expect(prompt).not.toContain('PENDENCIA-0 ');
    const stats = (await h.prisma.attempt.findFirstOrThrow({ where: { jobId: j.id } })).contextStats as any;
    expect(stats.memoryOmitted).toBeGreaterThan(20);
    expect(stats.budgetChars).toBe(6000);
    const wt = path.join(p.workspacePath, 'worktrees', j.id);
    const full = fs.readFileSync(path.join(wt, '.nivoo', 'memoria.md'), 'utf8');
    expect(full).toContain('PENDENCIA-0 ');
    expect(full).toContain('PENDENCIA-39');
    const tracked = execFileSync('git', ['ls-files'], { cwd: wt }).toString();
    expect(tracked).not.toContain('.nivoo/memoria.md');
  });

  it('lição de falha entra no contexto do próximo job do MESMO projeto, não de outro projeto', async () => {
    const a = await createProject(h, 'licoes A');
    const b = await createProject(h, 'licoes B');
    const falho = await run(a.id, {
      title: 'abordagem ruim', limits: { maxAttemptsPerStep: 2 },
      steps: [{ key: 'baixar', instructions: 'echo "ERRO-UNICO-7731: fonte de dados indisponível" >&2; exit 4' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    expect(['FALHOU', 'BLOQUEADO']).toContain(falho.status); // limite de tentativas ou repetição: ambos geram lição
    const body = (title: string) => ({
      title, defaultProvider: 'claude-code-cli',
      steps: [{ key: 'a', instructions: 'trabalhe', verifyCommand: 'true' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    await run(a.id, body('novo job A'));
    const promptA = promptRecebido();
    expect(promptA).toMatch(/\[LIÇÃO\] Lição: "baixar" \(.*\) — a IA ficou repetindo sem avançar/);
    expect(promptA).toContain('ERRO-UNICO-7731');
    await run(b.id, body('job B'));
    expect(promptRecebido()).not.toContain('ERRO-UNICO-7731');
  });

  it('orçamento de custo do projeto bloqueia novas execuções quando a soma dos jobs atinge o limite', async () => {
    const p = await createProject(h, 'orcamento projeto');
    await h.http().patch(`/api/projects/${p.id}`).send({ maxCostUsd: 2 }).expect(200);
    const j1 = (await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'gasto', objective: 'o', steps: [{ key: 's', instructions: 'true' }] }).expect(201)).body;
    // Custo informado por conectores pagos em jobs anteriores (simulado no banco).
    await h.prisma.job.update({ where: { id: j1.id }, data: { costSpentUsd: 2.5 } });
    const j2 = await run(p.id, {
      title: 'novo', limits: { maxCostUsd: 100 },
      steps: [{ key: 's', instructions: 'true' }],
      criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
    });
    expect(j2.status).toBe('BLOQUEADO');
    expect(j2.blockedReason).toBe('LIMITE_ORCAMENTO_PROJETO');
    expect(j2.attempts).toHaveLength(0);
    const r = (await h.http().patch(`/api/projects/${p.id}`).send({ maxCostUsd: null }).expect(200)).body;
    expect(r.maxCostUsd).toBeNull();
  });

  it('aprovação vale só para o conteúdo aprovado: etapa alterada depois exige nova aprovação', async () => {
    const p = await createProject(h, 'aprovacao hash');
    const j = await run(p.id, {
      title: 'destrutivo',
      steps: [{ key: 'limpar', instructions: 'mkdir -p tmp/x && rm -rf tmp/x && echo ok > out/ok.txt' }],
      criteria: [{ key: 'c', description: 'c', kind: 'ARTIFACT_PRESENT', config: { name: 'ok.txt' } }],
    });
    expect(j.status).toBe('AGUARDANDO_APROVACAO');
    const appr = j.approvals[0];
    expect(appr.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    // Conteúdo da etapa muda entre a solicitação e a decisão (adulteração direta no banco).
    await h.prisma.step.update({ where: { id: j.steps[0].id }, data: { instructions: 'rm -rf tmp && echo ok > out/ok.txt' } });
    await h.http().post(`/api/approvals/${appr.id}/decide`).send({ decision: 'APROVADO', decidedBy: 'Robson' }).expect(201);
    const after = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return x.approvals.length === 2 ? x : null;
    }, 60000);
    expect(after.status).toBe('AGUARDANDO_APROVACAO');
    expect(after.attempts).toHaveLength(0); // nada executou com a aprovação antiga
    expect(after.approvals[1].status).toBe('PENDENTE');
    expect(after.approvals[1].subjectHash).not.toBe(appr.subjectHash);
  });
});
