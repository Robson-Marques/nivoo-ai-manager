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
    const mem = (await h.http().get(`/api/projects/${p.id}/memory?camada=INTERNA`)).body;
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
    const licoes = async () => (await h.http().get(`/api/projects/${p.id}/memory?camada=INTERNA`)).body.filter((m: any) => m.references?.origem === 'licao-automatica');
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
    await h.http().post('/api/accounts/claude-api/key').send({ key: 'chave-ficticia-para-testes-unitarios' }).expect(201);
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

  it('entrega: conclusão publica os resultados uma única vez, sem criar outra sessão de IA', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Entrega', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify({
      tipo: 'plano', texto: 'Vou auditar.',
      job: { title: 'Auditoria', objective: 'docs/auditoria.md com as decisões pendentes', steps: [{ key: 'doc', instructions: "mkdir -p docs && printf '# Auditoria\\nC5: apagar a POC?\\n' > docs/auditoria.md && cp contexto/conversa-do-pedido.md out/conversa-vista.md && echo RELATORIO-ACHADOS-18 > out/relatorio-auditoria.md", verifyCommand: 'test -s docs/auditoria.md' }], criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'docs/auditoria.md' } }] },
      memoria: [],
    }) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'audite com as 16 seções: SEC-ORIGINAL-1 … SEC-ORIGINAL-16' }).expect(201);
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
    expect(entrega.content).toContain('Trabalho concluído. Os arquivos e as prévias produzidas estão disponíveis');
    expect(entrega.content).toContain('Nenhuma aprovação adicional será solicitada automaticamente.');
    expect(entrega.jobId).toBe(jobId);
    // A sessão do trabalho recebeu a conversa inteira do pedido (não só o resumo do objetivo).
    const wt = path.join((await h.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).workspacePath, 'worktrees', jobId);
    const vista = fs.readFileSync(path.join(wt, 'out', 'conversa-vista.md'), 'utf8');
    expect(vista).toMatch(/## Usuário — [\s\S]*audite com as 16 seções: SEC-ORIGINAL-1 … SEC-ORIGINAL-16/);
    expect(vista).toMatch(/## IA — [\s\S]*Vou auditar/);
    // Resultados em out/ (relatórios): aparecem no trabalho, ficam na pasta definitiva do projeto e a IA da entrega os lê.
    const resultados = (await h.http().get(`/api/projects/${p.id}/jobs/${jobId}/resultados`).expect(200)).body;
    const rel = resultados.find((r: any) => r.nome === 'relatorio-auditoria.md');
    expect(rel).toBeTruthy();
    expect((await h.http().get(`/api/projects/${p.id}/artifacts/${rel.id}`).expect(200)).text).toContain('RELATORIO-ACHADOS-18');
    const raiz = (await h.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).workspacePath;
    const pastas = fs.readdirSync(path.join(raiz, 'resultados'));
    expect(pastas).toEqual([expect.stringMatching(new RegExp(`^\\d{4}-\\d{2}-\\d{2}-auditoria-${jobId.slice(0, 8)}$`))]);
    expect(fs.readFileSync(path.join(raiz, 'resultados', pastas[0], 'relatorio-auditoria.md'), 'utf8')).toContain('RELATORIO-ACHADOS-18');
    const mensagens = (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
    expect(mensagens.filter((m: any) => m.kind === 'entrega' && m.jobId === jobId)).toHaveLength(1);
    // O relatório real continua disponível mesmo sem segunda sessão de IA para formular a entrega.
    ctl('mode', null);
  });

  it('sem limite de sessões: conferência falhando sempre igual (mesmo com a IA mexendo em arquivos) para em 3 e explica', async () => {
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
    expect(x.statusDetail).toContain('a mesma conferência da etapa falhou três vezes (sem contar erros distintos)');
    expect(x.statusDetail).toContain('test -f relatorio-final.md — falta relatorio-final.md');
    expect(x.attempts.filter((a: any) => a.status === 'SESSAO_ENCERRADA')).toHaveLength(3);
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
    // A correção confere o critério que falhou E de novo as conferências das etapas (a correção não pode quebrar nada).
    expect(correcao.verifyCommand).toBe('( grep -q CHANGELOG CLAUDE-regras.md ) && ( test -f notas.md ) && ( nivoo-conferir-telas --se-houver )');
    const prompt = fs.readFileSync(path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub', 'prompt-correcao.txt'), 'utf8');
    expect(prompt).toMatch(/regra-registrada — regra do CHANGELOG registrada/);
    expect(prompt).toMatch(/evidência: .*exitCode/);
    // A conferência das regras rodou depois da correção.
    const ordem = x.attempts.map((a: any) => x.steps.find((s: any) => s.id === a.stepId)?.key);
    expect(ordem.lastIndexOf('conferencia-regras')).toBeGreaterThan(ordem.indexOf('correcao-criterios-1'));
  });

  it('critério falhou E há aprovação manual pendente: a IA corrige assim mesmo e o trabalho só espera a aprovação', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Corrige com aprovação', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    ctl('correcao.sh', "printf 'Atualize o CHANGELOG\\n' > CLAUDE-regras.md");
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'regra', objective: 'registrar a regra', defaultProvider: 'claude-code-cli', conferencia: false,
        steps: [{ key: 'regra', instructions: 'echo rascunho > notas.md', verifyCommand: 'test -f notas.md' }],
        criteria: [
          { key: 'regra-registrada', description: 'regra do CHANGELOG registrada', kind: 'COMMAND', config: { command: 'grep -q CHANGELOG CLAUDE-regras.md' } },
          { key: 'teste-na-esteira', description: 'testado na esteira', kind: 'MANUAL_APPROVAL' },
        ],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await waitFor(async () => {
      const y = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_APROVACAO'].includes(y.status) ? y : null;
    }, 60_000);
    ctl('mode', null);
    ctl('correcao.sh', null);
    expect(x.steps.map((s: any) => s.key)).toContain('correcao-criterios-1');
    expect(x.status).toBe('AGUARDANDO_APROVACAO');
  });

  it('revisão diz "não conforme": a etapa dela termina (não fica em loop); a IA corrige com as violações apontadas e a revisão aprova', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Revisão devolve', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    ctl('conforme', 'false'); // a revisora (stub) reprova com "regra X descumprida (stub)"
    ctl('correcao.sh', `echo true > '${path.join(CTL, 'conforme')}'; echo corrigido > inventario.tsv`);
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'auditoria', objective: 'inventário', defaultProvider: 'claude-code-cli',
        steps: [{ key: 'inv', instructions: 'echo cabecalho > inventario.tsv', verifyCommand: 'test -s inventario.tsv' }],
        criteria: [{ key: 'i', description: 'inventário', kind: 'FILE_EXISTS', config: { path: 'inventario.tsv' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await fim(p.id, j.id);
    ctl('mode', null);
    ctl('conforme', null);
    ctl('correcao.sh', null);
    expect(x.status).toBe('CONCLUIDO');
    const revisao = x.steps.find((s: any) => s.key === 'conferencia-regras');
    const tentativasRevisao = x.attempts.filter((a: any) => a.stepId === revisao.id);
    expect(tentativasRevisao.map((a: any) => a.status)).toEqual(['SUCESSO', 'SUCESSO']); // uma por rodada, sem loop
    const prompt = fs.readFileSync(path.join(CTL, 'prompt-correcao.txt'), 'utf8');
    expect(prompt).toMatch(/REVISÃO INDEPENDENTE apontou estas violações[\s\S]*regra X descumprida \(stub\)/);
    expect(prompt).toMatch(/out\/perguntas-ao-usuario\.md/);
  });
  it('revisão "não conforme" só por dúvida do usuário: não roda correções à toa; responder ali mesmo continua o trabalho; "aceitar assim mesmo" conclui', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Revisão com dúvida', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    ctl('conforme', 'duvida');
    const j = (
      await h.http().post(`/api/projects/${p.id}/jobs`).send({
        title: 'auditoria', objective: 'auditoria', defaultProvider: 'claude-code-cli',
        steps: [{ key: 'aud', instructions: 'echo relatorio > auditoria.md', verifyCommand: 'test -s auditoria.md' }],
        criteria: [{ key: 'r', description: 'relatório', kind: 'FILE_EXISTS', config: { path: 'auditoria.md' } }],
      }).expect(201)
    ).body;
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/start`).expect(201);
    const x = await fim(p.id, j.id);
    ctl('mode', null);
    ctl('conforme', null);
    expect(x).toMatchObject({ status: 'BLOQUEADO', blockedReason: 'CRITERIOS_NAO_ATENDIDOS' });
    expect(x.steps.some((s: any) => s.key.startsWith('correcao-criterios-'))).toBe(false);
    const r = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/revisao`).expect(200)).body;
    expect(r).toMatchObject({ conforme: false, violacoes: [], perguntas: [{ pergunta: 'Qual é a lista original dos títulos das 16 seções?', opcoes: ['Os títulos do documento X', 'Os títulos atuais do relatório'] }] });
    const promptRevisor = fs.readFileSync(path.join(CTL, 'prompt-revisor.txt'), 'utf8');
    expect(promptRevisor).toMatch(/SÓ O USUÁRIO responde[\s\S]*NÃO é violação[\s\S]*respostas possíveis em "opcoes"/);
    // A IA recebe a conversa inteira do pedido (não só o resumo do objetivo).
    expect(promptRevisor).toMatch(/contexto\/conversa-do-pedido\.md/);
    // Responder ali mesmo: a IA aplica a resposta (etapa nova) e a revisão confere de novo; a resposta vai para a memória.
    ctl('mode', 'bash');
    ctl('conforme', 'duvida'); // a revisora ainda tem dúvida: para de novo, sem correções à toa
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/responder-revisao`).send({ por: 'Robson' }).expect(400);
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/responder-revisao`).send({ resposta: 'Os títulos são os do arquivo SECOES-ORIGINAIS.', por: 'Robson' }).expect(201);
    const b = await fim(p.id, j.id);
    ctl('mode', null);
    ctl('conforme', null);
    expect(b.status).toBe('BLOQUEADO');
    const etapa = b.steps.find((s: any) => s.key === 'resposta-usuario-1');
    expect(etapa.instructions).toMatch(/Qual é a lista original[\s\S]*Resposta do usuário \(Robson\):\nOs títulos são os do arquivo SECOES-ORIGINAIS\./);
    expect(etapa.status).toBe('CONCLUIDO');
    expect(etapa.verifyCommand).toBe('( test -s auditoria.md ) && ( nivoo-conferir-telas --se-houver )'); // a resposta muda o trabalho: as conferências rodam de novo
    const ordem = b.attempts.map((a: any) => b.steps.find((s: any) => s.id === a.stepId)?.key);
    expect(ordem.lastIndexOf('conferencia-regras')).toBeGreaterThan(ordem.indexOf('resposta-usuario-1'));
    expect(b.steps.some((s: any) => s.key.startsWith('correcao-criterios-'))).toBe(false);
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`)).body;
    expect(mem.some((m: any) => /SECOES-ORIGINAIS/.test(m.content) && m.category === 'DECISAO_APROVADA')).toBe(true);
    // Ainda com dúvida: aceitar assim mesmo conclui.
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/aceitar-revisao`).send({ por: 'Robson' }).expect(201);
    const y = await waitFor(async () => {
      const z = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(z.status) ? z : null;
    }, 30_000);
    expect(y.status).toBe('CONCLUIDO');
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/responder-revisao`).send({ resposta: 'x', por: 'Robson' }).expect(409);
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logs).toMatch(/Revisão aceita assim mesmo por Robson/);
    // Trabalho que não está parado na conferência final não aceita o atalho.
    await h.http().post(`/api/projects/${p.id}/jobs/${j.id}/aceitar-revisao`).send({ por: 'Robson' }).expect(409);
  });
});
