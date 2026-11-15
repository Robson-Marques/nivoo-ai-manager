/**
 * Defeitos achados na auditoria preventiva (antes de o usuário esbarrar neles):
 * - sessão de IA que esgota o tempo é "sessão encerrada" (confere, salva e continua), não falha;
 * - a IA pede para apagar/mover arquivos em .nivoo/remover.txt e o sistema faz, antes da conferência (caminhos
 *   fora do projeto ou protegidos são recusados);
 * - a saída inteira da conferência fica em .nivoo/ultima-conferencia.txt para a próxima sessão;
 * - trabalho que para avisa na conversa de onde veio;
 * - instrução de IA com "rm -rf" no texto não pede aprovação de "ação destrutiva".
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

describe('Auditoria preventiva', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const f of ['mode', 'resposta.txt']) ctl(f, null);
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
  });

  const rodar = async (pid: string, body: any) => {
    const j = (await h.http().post(`/api/projects/${pid}/jobs`).send({ objective: 'objetivo', defaultProvider: 'claude-code-cli', conferencia: false, ...body }).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/start`).expect(201);
    return waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_APROVACAO'].includes(x.status) ? x : null;
    }, 60_000);
  };

  it('tempo da sessão esgotado: salva o que foi feito e continua numa nova sessão até concluir', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Tempo', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'longo',
      limits: { stepTimeoutSec: 2 },
      steps: [{ key: 'l', instructions: 'if [ -f metade.txt ]; then echo fim > pronto.txt; else echo 1 > metade.txt; sleep 20; fi', verifyCommand: 'test -f pronto.txt' }],
      criteria: [{ key: 'p', description: 'p', kind: 'FILE_EXISTS', config: { path: 'pronto.txt' } }],
    });
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    expect(x.attempts.map((a: any) => a.status)).toEqual(['SESSAO_ENCERRADA', 'SUCESSO']);
  });

  it('a IA pede para apagar/mover em .nivoo/remover.txt: o sistema faz antes da conferência; caminho proibido é recusado', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Remover', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'limpar',
      steps: [
        { key: 'cria', instructions: 'echo velho > velho.txt && mkdir -p morta && echo x > morta/a.js && echo a > a.txt', verifyCommand: 'test -f a.txt' },
        {
          key: 'limpa', dependsOn: ['cria'],
          // A IA não tem como apagar: pede ao sistema. A conferência roda DEPOIS das remoções.
          instructions: "mkdir -p .nivoo && printf 'velho.txt\\nmorta\\nmover a.txt -> docs/a.txt\\n../../fora\\n.git/config\\n' > .nivoo/remover.txt",
          verifyCommand: 'test ! -e velho.txt && test ! -e morta && test -f docs/a.txt && test ! -e a.txt',
        },
      ],
      criteria: [{ key: 'd', description: 'd', kind: 'FILE_EXISTS', config: { path: 'docs/a.txt' } }],
    });
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${x.id}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logs).toMatch(/Pedido da IA: 3 item\(ns\) apagado\(s\)\/movido\(s\): velho\.txt, morta, a\.txt → docs\/a\.txt/);
    expect(logs).toMatch(/Pedidos de remoção recusados[^\n]*\.\.\/\.\.\/fora[^\n]*\.git\/config/);
    const repo = path.join(p.workspacePath, 'repo');
    expect(fs.existsSync(path.join(repo, 'velho.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'docs', 'a.txt'), 'utf8')).toBe('a\n');
  });

  it('a próxima sessão recebe a saída inteira da conferência; instrução com "rm -rf" no texto não pede aprovação', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Saida', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'testes',
      steps: [{
        key: 't',
        // 1ª sessão: a conferência falha com muita saída e o erro no fim; 2ª: a IA lê o arquivo e corrige.
        instructions: '# não use rm -rf aqui\nif [ -f .nivoo/ultima-conferencia.txt ] && grep -q ERRO-NO-FIM .nivoo/ultima-conferencia.txt; then echo ok > corrigido.txt; fi',
        verifyCommand: 'test -f corrigido.txt || { seq 1 20000; echo ERRO-NO-FIM >&2; exit 1; }',
      }],
      criteria: [{ key: 'c', description: 'c', kind: 'FILE_EXISTS', config: { path: 'corrigido.txt' } }],
    });
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    expect(x.approvals ?? []).toHaveLength(0);
    expect(x.attempts.length).toBe(2);
    expect(x.attempts[0].error).toMatch(/ERRO-NO-FIM$/);
  });

  it('trabalho da conversa que para avisa na conversa', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Aviso', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n' + JSON.stringify({
      tipo: 'plano', texto: 'Vou fazer.', job: {
        title: 'Impossível', objective: 'x',
        steps: [{ key: 'i', title: 'Etapa', instructions: 'true', verifyCommand: 'programa-que-nao-existe-abc --x' }],
        criteria: [{ key: 'i', description: 'i', kind: 'FILE_EXISTS', config: { path: 'nada.txt' } }],
      }, memoria: [],
    }) + '\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'faça' }).expect(201);
    const plano = await waitFor(async () => (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages.find((m: any) => m.kind === 'plano' && m.status === 'PRONTA') ?? null);
    ctl('mode', 'bash');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson' }).expect(201);
    const aviso = await waitFor(async () => (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages.find((m: any) => m.kind === 'sistema' && /parou:/.test(m.content)) ?? null, 60_000);
    ctl('mode', null);
    ctl('resposta.txt', null);
    expect(aviso.content).toMatch(/O trabalho "Impossível" parou: .*programa-que-nao-existe-abc/);
  });
});
