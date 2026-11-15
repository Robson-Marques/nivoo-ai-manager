/**
 * Trabalho que vai até o fim: trabalho aprovado na conversa não tem limite de sessões nem de tempo; a
 * conferência que usa um programa inexistente no servidor para na hora, com o motivo (em vez de gastar
 * sessões); e a IA reserva assume sozinha quando a IA do projeto fica sem limite — no trabalho e na conversa.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};

describe('Até o fim: sem limite de sessões, conferência impossível e IA reserva', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    for (const c of (await h.http().get('/api/accounts')).body) await h.http().delete(`/api/accounts/${c.id}`);
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
  });
  const fim = (pid: string, jid: string) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${jid}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 40_000);
  const resposta = (pid: string, cid: string, n: number) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body;
      const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
      return r.length >= n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
    });

  it('plano aprovado na conversa: sem limite de sessões nem de tempo (o plano da IA não impõe limites)', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Sem limites', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl(
      'resposta.txt',
      '```json\n' +
        JSON.stringify({
          tipo: 'plano', texto: 'ok',
          job: { title: 'longo', objective: 'x', limits: { maxSessionsPerStep: 2, maxDurationSec: 60 }, steps: [{ key: 's', instructions: 'x', verifyCommand: 'true' }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] },
          memoria: [],
        }) + '\n```',
    );
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'faça' }).expect(201);
    const plano = await resposta(p.id, c.id, 1);
    const aprovado = (await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson', start: false }).expect(201)).body;
    const job = await h.prisma.job.findUniqueOrThrow({ where: { id: aprovado.messages.find((m: any) => m.id === plano.id).jobId } });
    expect([job.maxSessionsPerStep, job.maxDurationSec, job.maxAttemptsPerStep]).toEqual([0, 0, 10]);
    ctl('mode', null);
  });

  it('sem limite de tempo no trabalho, a sessão usa o tempo da etapa (não 1 segundo)', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Tempo', provider: 'claude-code-cli' }).expect(201)).body;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'demora um pouco', objective: 'x', defaultProvider: 'local-shell', semLimites: true,
        steps: [{ key: 'a', instructions: 'sleep 3 && echo ok > feito.txt' }],
        criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'feito.txt' } }],
      }).expect(201)
    ).body;
    expect((await h.prisma.job.findUniqueOrThrow({ where: { id: j.id } })).maxDurationSec).toBe(0);
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const r = await fim(p.id, j.id);
    expect(r.status).toBe('CONCLUIDO');
    expect(r.attempts).toHaveLength(1);
  });

  it('conferência com programa inexistente: para na 1ª tentativa e diz qual programa falta', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Sem rg', provider: 'claude-code-cli' }).expect(201)).body;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'auditoria', objective: 'x', defaultProvider: 'claude-code-cli', conferencia: false,
        steps: [{ key: 'doc', instructions: 'escreva', verifyCommand: 'programa-que-nao-existe-xyz docs/' }],
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const r = await fim(p.id, j.id);
    expect(r.status).toBe('BLOQUEADO');
    expect(r.blockedReason).toBe('VERIFICACAO_IMPOSSIVEL');
    expect(r.statusDetail).toMatch(/usa "programa-que-nao-existe-xyz", que não existe no servidor/);
    expect(r.attempts).toHaveLength(1);
    // Programa faltando no servidor não é aprendizado: nenhuma "lição" na memória.
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`)).body;
    expect(mem.filter((m: any) => m.references?.origem === 'licao-automatica')).toHaveLength(0);
  });

  it('lição só para falha do jeito de fazer, uma por etapa; o trabalho concluído apaga as lições dele', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Licoes', provider: 'claude-code-cli' }).expect(201)).body;
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'tenta', objective: 'x', defaultProvider: 'local-shell', limits: { maxAttemptsPerStep: 5, repetitionWindow: 2 },
        steps: [{ key: 'a', instructions: 'test -f pode.txt || { echo "abordagem errada XYZ"; exit 3; }' }],
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    expect((await fim(p.id, j.id)).blockedReason).toBe('REPETICAO_IMPRODUTIVA');
    // Tentar de novo e repetir a mesma falha não cria uma segunda lição.
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/resume`).send({ by: 'Robson' }).expect(201);
    await fim(p.id, j.id);
    const licoes = async () => (await h.http().get(`/api/projects/${p.id}/memory`)).body.filter((m: any) => m.references?.origem === 'licao-automatica');
    expect(await licoes()).toHaveLength(1);
    expect((await licoes())[0].title).toMatch(/a IA ficou repetindo sem avançar/);
    // Resolvido o problema, o trabalho conclui e a lição dele some.
    const wt = path.join(p.workspacePath, 'worktrees', j.id);
    fs.writeFileSync(path.join(wt, 'pode.txt'), 'ok');
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/resume`).send({ by: 'Robson' }).expect(201);
    expect((await fim(p.id, j.id)).status).toBe('CONCLUIDO');
    expect(await licoes()).toHaveLength(0);
  });

  it('IA reserva: sem limite na conta do Claude, o trabalho continua sozinho com a reserva (Claude API)', async () => {
    await h.http().post('/api/accounts').send({ tipo: 'claude-api', nome: 'Claude API reserva' }).expect(201);
    await h.http().post('/api/accounts/claude-api/key').send({ key: 'sk-ant-api03-CHAVE-RESERVA-0123456789' }).expect(201);
    const p = (await h.http().post('/api/projects').send({ name: 'Com reserva', provider: 'claude-code-cli' }).expect(201)).body;
    await h.http().patch(`/api/projects/${p.id}`).send({ reserva: ['nao-existe'] }).expect(400);
    expect((await h.http().patch(`/api/projects/${p.id}`).send({ reserva: ['claude-api'] }).expect(200)).body.aiReserva).toEqual(['claude-api']);
    ctl('mode', 'limit_conta');
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'continua', objective: 'x', defaultProvider: 'claude-code-cli', conferencia: false,
        steps: [{ key: 's', instructions: 'faça', verifyCommand: 'true' }],
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const r = await fim(p.id, j.id);
    expect(r.status).toBe('CONCLUIDO');
    expect(r.attempts.map((a: any) => [a.provider, a.status])).toEqual([
      ['claude-code-cli', 'RECURSO_INDISPONIVEL'],
      ['claude-api', 'SUCESSO'],
    ]);
    expect((await h.http().get(`/api/projects/${p.id}`)).body.provider).toBe('claude-api');
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logs).toMatch(/Claude \(conta\) ficou indisponível .* O trabalho continua com Claude API reserva/);

    // Na conversa: a conta do Claude sem limite no meio da resposta → a reserva responde, e a conversa avisa.
    await h.http().patch(`/api/projects/${p.id}`).send({ provider: 'claude-code-cli', reserva: ['claude-api'] }).expect(200);
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'oi' }).expect(201);
    const m = await resposta(p.id, c.id, 1);
    expect(m.status).toBe('PRONTA');
    expect(m.content).toBe('feito'); // respondida pela reserva (o stub da API responde "feito")
    const todas = (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
    expect(todas.find((x: any) => x.kind === 'sistema').content).toMatch(/^Claude \(conta\) ficou indisponível .*Quem responde agora é Claude API reserva/);
    expect((await h.http().get(`/api/projects/${p.id}`)).body.provider).toBe('claude-api');
    ctl('logged_in', null);
    ctl('mode', null);
  });

  it('entrega: terminado o trabalho da conversa, a IA volta sozinha com o que fez, os arquivos e as perguntas', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Entrega', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify({
      tipo: 'plano', texto: 'Vou auditar.',
      job: { title: 'Auditoria', objective: 'docs/auditoria.md com as decisões pendentes', steps: [{ key: 'doc', instructions: "mkdir -p docs && printf '# Auditoria\\nC5: apagar a POC?\\n' > docs/auditoria.md", verifyCommand: 'test -s docs/auditoria.md' }], criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'docs/auditoria.md' } }] },
      memoria: [],
    }) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'audite' }).expect(201);
    const plano = await resposta(p.id, c.id, 1);
    ctl('resposta.txt', '```json\n{"tipo":"resposta","texto":"Pronto: docs/auditoria.md. 1. C5 — apagar a POC? Recomendo apagar.","memoria":[]}\n```');  // a entrega (lida pela IA ao terminar)
    ctl('mode', 'bash'); // a "IA" executa a etapa e grava o documento
    const ap = (await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson' }).expect(201)).body;
    const jobId = ap.messages.find((m: any) => m.id === plano.id).jobId;
    expect((await fim(p.id, jobId)).status).toBe('CONCLUIDO');
    expect((await h.http().get(`/api/projects/${p.id}/jobs/${jobId}/arquivos`).expect(200)).body).toEqual([{ status: 'A', path: 'docs/auditoria.md' }]);
    const entrega = await waitFor(async () => {
      const ms = (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
      const e = ms.find((m: any) => m.kind === 'entrega' && m.status !== 'PENDENTE');
      return e ?? null;
    }, 30_000);
    expect(entrega.content).toMatch(/1\. C5 — apagar a POC\? Recomendo apagar/);
    expect(entrega.jobId).toBe(jobId);
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toContain('apresente a ENTREGA do trabalho que acabou de terminar');
    expect(prompt).toContain('docs/auditoria.md (novo)');
    expect(prompt).toContain('LISTE TODAS como perguntas numeradas');
    ctl('mode', null);
  });

  it('sem limite de sessões: conferência falhando sempre igual (mesmo com a IA mexendo em arquivos) para em 6 e explica', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Gira sem fim', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'gira', objective: 'x', defaultProvider: 'claude-code-cli', conferencia: false,
        limits: { maxSessionsPerStep: 0, maxAttemptsPerStep: 10 },
        steps: [{ key: 's', instructions: 'date +%s%N > tentativa-$RANDOM.txt', verifyCommand: 'test -f relatorio-final.md' }], // falha calada: o sistema explica o que falta
        criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await fim(p.id, j.id);
    ctl('mode', null);
    expect(x).toMatchObject({ status: 'BLOQUEADO', blockedReason: 'REPETICAO_IMPRODUTIVA' });
    expect(x.statusDetail).toMatch(/conferência da etapa falhou 6 vezes seguidas do mesmo jeito: \(exit 1\): o comando de conferência falhou sem mensagem: test -f relatorio-final\.md — falta relatorio-final\.md/);
    expect(x.attempts.filter((a: any) => a.status === 'SESSAO_ENCERRADA')).toHaveLength(6);
  });

  it('critério final não passou: a IA corrige sozinha (com o critério e a evidência), confere as regras de novo e conclui', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Corrige sozinho', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    ctl('correcao.sh', "printf 'Atualize o CHANGELOG\\n' > CLAUDE-regras.md");
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'regra', objective: 'registrar a regra', defaultProvider: 'claude-code-cli',
        steps: [{ key: 'regra', instructions: 'echo rascunho > notas.md', verifyCommand: 'test -f notas.md' }],
        criteria: [{ key: 'regra-registrada', description: 'regra do CHANGELOG registrada', kind: 'COMMAND', config: { command: "grep -q CHANGELOG CLAUDE-regras.md" } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await fim(p.id, j.id);
    ctl('mode', null);
    ctl('correcao.sh', null);
    expect(x.status).toBe('CONCLUIDO');
    const keys = x.steps.map((s: any) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['regra', 'correcao-criterios-1', 'conferencia-regras']));
    const correcao = x.steps.find((s: any) => s.key === 'correcao-criterios-1');
    expect(correcao.verifyCommand).toBe('( grep -q CHANGELOG CLAUDE-regras.md )');
    const prompt = fs.readFileSync(path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub', 'prompt-correcao.txt'), 'utf8');
    expect(prompt).toMatch(/regra-registrada — regra do CHANGELOG registrada/);
    expect(prompt).toMatch(/evidência: .*exitCode/);
    // A conferência das regras rodou depois da correção.
    const ordem = x.attempts.map((a: any) => x.steps.find((s: any) => s.id === a.stepId)?.key);
    expect(ordem.lastIndexOf('conferencia-regras')).toBeGreaterThan(ordem.indexOf('correcao-criterios-1'));
  });
});
