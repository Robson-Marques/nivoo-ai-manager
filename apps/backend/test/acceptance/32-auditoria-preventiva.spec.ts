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
  it('cache do corepack quebrado no servidor: o sistema refaz e confere de novo, sem gastar sessão da IA', async () => {
    const cache = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'corepack-'));
    process.env.COREPACK_HOME = cache;
    fs.mkdirSync(path.join(cache, 'v1'), { recursive: true });
    const p = (await h.http().post('/api/projects').send({ name: 'Corepack', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'pnpm',
      steps: [{ key: 'v', instructions: 'echo ok > feito.txt', verifyCommand: `if [ -d '${cache}' ]; then echo "Error: Cannot find module '${cache}/v1/pnpm/12.21.0/bin/pnpm.cjs'" >&2; exit 1; fi; test -f feito.txt` }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: 'feito.txt' } }],
    });
    ctl('mode', null);
    delete process.env.COREPACK_HOME;
    expect(x.status).toBe('CONCLUIDO');
    expect(x.attempts).toHaveLength(1);
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${x.id}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logs).toMatch(/cache do corepack quebrado no servidor; refeito/);
  });

  it('problema do servidor (sem rede para o registro de pacotes): para na hora explicando, sem 6 sessões inúteis', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'SemRede', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'rede',
      steps: [{ key: 'r', instructions: 'echo ok > feito.txt', verifyCommand: 'echo "npm error code EAI_AGAIN request to https://registry.npmjs.org/x failed" >&2; exit 1' }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: 'feito.txt' } }],
    });
    ctl('mode', null);
    expect(x).toMatchObject({ status: 'BLOQUEADO', blockedReason: 'VERIFICACAO_IMPOSSIVEL' });
    expect(x.attempts).toHaveLength(1);
    expect(x.statusDetail).toMatch(/problema do SERVIDOR do Nivoo, não do projeto \(EAI_AGAIN request to https:\/\/registry\.npmjs\.org/);
    expect(x.statusDetail).toMatch(/nivoo update/);
  });
  it('banco de teste descartável: cada trabalho tem o seu nas conferências e nos critérios; apagado no fim', async () => {
    // O usuário que o instalador cria: só cria bancos, não é superusuário.
    await h.prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nivoo_testes_ensaio') THEN
        CREATE ROLE nivoo_testes_ensaio WITH LOGIN CREATEDB NOSUPERUSER NOCREATEROLE PASSWORD 'abc123';
      END IF; END $$`);
    process.env.NIVOO_TESTES_PG_URL = 'postgresql://nivoo_testes_ensaio:abc123@127.0.0.1:5432/postgres';
    const p = (await h.http().post('/api/projects').send({ name: 'Banco', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'integração',
      steps: [{
        key: 'db', instructions: 'echo ok > feito.txt',
        // Como um teste de integração: migra e grava no banco do trabalho (o mesmo nas três variáveis).
        verifyCommand: 'test "$DATABASE_URL" = "$DATABASE_URL_TEST" && test "$TEST_DATABASE_URL" = "$DATABASE_URL_TEST" && psql -X "$DATABASE_URL_TEST" -tAc "create table if not exists pedidos(id int); insert into pedidos values (7); select current_database()" | grep -q "^teste_"',
      }],
      criteria: [{ key: 'b', description: 'banco', kind: 'COMMAND', config: { command: 'test "$(psql -X -tAc "select count(*) from pedidos where id = 7")" -ge 1' } }],
    });
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    // A limpeza roda logo depois do "concluído".
    await waitFor(async () => {
      const l = (await h.http().get(`/api/projects/${p.id}/jobs/${x.id}/logs`)).body.map((y: any) => y.message).join('\n');
      return /Banco de teste do trabalho apagado/.test(l) ? l : null;
    }, 20_000);
    const { nomeDoBancoDeTeste } = require('../../src/common/banco-de-teste');
    const existe = await h.prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM pg_database WHERE datname = '${nomeDoBancoDeTeste(x.id)}'`);
    expect(existe).toHaveLength(0);
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toMatch(/BANCO DE TESTE: o servidor dá a cada trabalho um PostgreSQL vazio e descartável/);
    delete process.env.NIVOO_TESTES_PG_URL;
  });
  it('ver o sistema rodando: a conferência liga o servidor numa porta livre, confere com curl, e o sistema desliga tudo no fim', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Rodando', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const servidor = "require('http').createServer((q, r) => r.end(q.url === '/health' ? 'ok' : 'pedidos:3')).listen(process.env.PORT, () => console.log('no ar'))";
    const inicio = Date.now();
    const x = await rodar(p.id, {
      title: 'rodando',
      steps: [{
        key: 'r', instructions: `echo "${servidor}" > servidor.js`,
        // Sem redirecionar a saída (o caso que deixava a conferência parada até esgotar o tempo).
        verifyCommand: 'echo $NIVOO_PORTA_TESTE > out/porta.txt; PORT=$NIVOO_PORTA_TESTE node servidor.js & for i in $(seq 1 50); do curl -fsS http://127.0.0.1:$NIVOO_PORTA_TESTE/health >/dev/null && break; sleep 0.2; done; curl -fsS http://127.0.0.1:$NIVOO_PORTA_TESTE/api | grep -q "pedidos:3"',
      }],
      criteria: [{ key: 's', description: 's', kind: 'FILE_EXISTS', config: { path: 'servidor.js' } }],
    });
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    expect(Date.now() - inicio).toBeLessThan(30_000);
    const porta = Number(fs.readFileSync(path.join(p.workspacePath, 'worktrees', x.id, 'out', 'porta.txt'), 'utf8'));
    expect(porta).toBeGreaterThan(0);
    // O servidor ligado pela conferência foi desligado.
    const livre = await new Promise<boolean>((ok) => {
      const srv = require('node:net').createServer();
      srv.once('error', () => ok(false));
      srv.listen(porta, '127.0.0.1', () => srv.close(() => ok(true)));
    });
    expect(livre).toBe(true);
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toMatch(/VER O SISTEMA RODANDO \(sem navegador\)/);
  });
  it('fotos das telas: a conferência fotografa (computador e celular), falha com a página larga demais no celular; a IA corrige', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Fotos', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const largo = '<!doctype html><meta name=viewport content=width=device-width><h1>Loja</h1><div style=width:900px>tabela</div>';
    const certo = '<!doctype html><meta name=viewport content=width=device-width><h1>Loja</h1><div style=max-width:100%>tabela</div>';
    const x = await rodar(p.id, {
      title: 'visual',
      steps: [{
        key: 'v',
        // 1ª sessão: página larga demais. 2ª: a IA lê o relatório das fotos e corrige.
        instructions: `if grep -q "mais larga que o celular" out/telas/relatorio.md 2>/dev/null; then echo '${certo}' > index.html; else echo '${largo}' > index.html; fi`,
        verifyCommand: `(node -e "require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(require('fs').readFileSync('index.html'))}).listen(process.env.NIVOO_PORTA_TESTE)" &); sleep 0.7; nivoo-fotos http://127.0.0.1:$NIVOO_PORTA_TESTE / --exigir-sem-erros`,
      }],
      criteria: [{ key: 'i', description: 'i', kind: 'FILE_EXISTS', config: { path: 'index.html' } }],
    });
    ctl('mode', null);
    expect(x.status).toBe('CONCLUIDO');
    expect(x.attempts).toHaveLength(2);
    expect(x.attempts[0].error).toMatch(/mais larga que o celular/);
    const resultados = (await h.http().get(`/api/projects/${p.id}/jobs/${x.id}/resultados`).expect(200)).body.map((r: any) => r.nome);
    expect(resultados).toEqual(expect.arrayContaining(['telas/inicio-computador.png', 'telas/inicio-celular.png', 'telas/relatorio.md']));
    const prompt = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(prompt).toMatch(/FOTOS DAS TELAS \(sem a IA navegar\)/);
    expect(prompt).toMatch(/A última conferência tirou FOTOS das telas/);
  });
  it('conferência demorada mostra o andamento (não parece travada): início, última linha da saída e "ainda rodando"', async () => {
    process.env.NIVOO_CONFERENCIA_AVISO_MS = '500';
    const p = (await h.http().post('/api/projects').send({ name: 'Demorada', provider: 'claude-code-cli' }).expect(201)).body;
    ctl('mode', 'bash');
    const x = await rodar(p.id, {
      title: 'demorada',
      steps: [{ key: 'd', instructions: 'echo ok > feito.txt', verifyCommand: 'echo "instalando dependências"; sleep 1.2; echo "✓ teste do atualizador"; sleep 3; test -f feito.txt' }],
      criteria: [{ key: 'f', description: 'f', kind: 'FILE_EXISTS', config: { path: 'feito.txt' } }],
    });
    ctl('mode', null);
    delete process.env.NIVOO_CONFERENCIA_AVISO_MS;
    expect(x.status).toBe('CONCLUIDO');
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${x.id}/logs`)).body.map((l: any) => l.message).join('\n');
    expect(logs).toMatch(/Conferindo a etapa \(testes, build…\): echo "instalando dependências"/);
    expect(logs).toMatch(/Conferência rodando \(0 min\): ✓ teste do atualizador/);
    expect(logs).toMatch(/Conferência ainda rodando \(0 min\)/);
  });
});
