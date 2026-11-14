/**
 * Conexões múltiplas: duas (ou mais) contas do mesmo serviço, cada uma com nome, credencial e pasta
 * próprias — nunca se misturam. Padrão para projetos novos, renomear, excluir (recusado se em uso),
 * login pela tela de uma conta ADICIONAL sem tocar na primeira, e migração do que já estava conectado.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appConfig } from '../../src/config';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const lido = (f: string) => fs.readFileSync(path.join(CTL, f), 'utf8');

describe('Conexões: várias contas do mesmo serviço', () => {
  let h: Harness;
  const segredos = () => JSON.parse(fs.readFileSync(path.join(path.dirname(appConfig().workspacesRoot), 'segredos.json'), 'utf8'));
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
  });

  const trabalho = async (pid: string, ia: string) => {
    const j = (await h.http().post(`/api/projects/${pid}/jobs`).send({ title: 'trabalho', objective: 'x', defaultProvider: ia, conferencia: false, steps: [{ key: 's', instructions: 'faça', verifyCommand: 'true' }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/start`).expect(201);
    return waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(x.status) ? x : null;
    }, 30_000);
  };

  it('migração: o que já estava conectado vira conexão com o nome de antes, sem reconectar', async () => {
    const lista = (await h.http().get('/api/accounts').expect(200)).body;
    // O Claude (conta) do stub está logado; as outras não estão conectadas nem em uso.
    expect(lista.map((c: any) => [c.id, c.nome, c.padrao, c.conectado])).toEqual([['claude-code-cli', 'Claude (conta)', true, true]]);
  });

  it('duas contas de API do Claude: nomes, credenciais e pastas separadas; projeto usa a escolhida', async () => {
    const c1 = (await h.http().post('/api/accounts').send({ tipo: 'claude-api', nome: 'Claude API 1' }).expect(201)).body;
    const c2 = (await h.http().post('/api/accounts').send({ tipo: 'claude-api', nome: 'Claude API 2' }).expect(201)).body;
    expect(c1.id).toBe('claude-api'); // a primeira de cada tipo usa a configuração padrão
    expect(c2.id).toMatch(/^claude-api--[0-9a-f]{8}$/);
    expect([c1.conectado, c2.conectado]).toEqual([false, false]);
    await h.http().post('/api/accounts').send({ tipo: 'claude-api', nome: 'claude api 2' }).expect(409); // nome repetido
    await h.http().post('/api/accounts').send({ tipo: 'outra-ia' }).expect(400);
    const sem = (await h.http().post('/api/accounts').send({ tipo: 'claude-api' }).expect(201)).body; // nome automático
    expect(sem.nome).toBe('Claude API');

    await h.http().post(`/api/accounts/${c1.id}/key`).send({ key: 'sk-ant-api03-CHAVE-UM-0123456789' }).expect(201);
    await h.http().post(`/api/accounts/${c2.id}/key`).send({ key: 'sk-ant-api03-CHAVE-DOIS-0123456789' }).expect(201);
    const lista = (await h.http().get('/api/accounts')).body;
    expect(lista.find((c: any) => c.id === c2.id).conectado).toBe(true);
    expect(lista.find((c: any) => c.id === sem.id).conectado).toBe(false); // não herda a chave das outras
    expect(segredos()[`${c2.id}/ANTHROPIC_API_KEY`]).toBe('sk-ant-api03-CHAVE-DOIS-0123456789');
    expect(segredos().ANTHROPIC_API_KEY).toBe('sk-ant-api03-CHAVE-UM-0123456789');

    // Cada projeto usa a sua; a sessão de IA recebe só a chave e a pasta daquela conexão.
    const p1 = (await h.http().post('/api/projects').send({ name: 'Loja', provider: c1.id }).expect(201)).body;
    const p2 = (await h.http().post('/api/projects').send({ name: 'Blog', provider: c2.id }).expect(201)).body;
    expect((await trabalho(p1.id, c1.id)).status).toBe('CONCLUIDO');
    const [k1, dir1] = lido('env.txt').trim().split('|');
    expect(k1).toBe('sk-ant-api03-CHAVE-UM-0123456789');
    const j2 = await trabalho(p2.id, c2.id);
    expect(j2.status).toBe('CONCLUIDO');
    expect(j2.attempts[0].provider).toBe(c2.id);
    const [k2, dir2] = lido('env.txt').trim().split('|');
    expect(k2).toBe('sk-ant-api03-CHAVE-DOIS-0123456789');
    expect(dir2).toBe(path.join(os.homedir(), '.nivoo-ia', c2.id));
    expect(dir1).not.toBe(dir2);

    // Renomear e padrão (projetos novos sem IA escolhida usam a padrão).
    const ren = (await h.http().patch(`/api/accounts/${c2.id}`).send({ nome: 'Claude do cliente', padrao: true }).expect(200)).body;
    expect([ren.nome, ren.padrao, ren.projetos]).toEqual(['Claude do cliente', true, 1]);
    expect((await h.http().get('/api/accounts')).body.filter((c: any) => c.padrao).map((c: any) => c.id)).toEqual([c2.id]);
    expect((await h.http().post('/api/projects').send({ name: 'Novo' }).expect(201)).body.provider).toBe(c2.id);

    // Excluir: recusado enquanto um projeto a usa; depois de trocar, apaga credencial e pasta.
    const recusa = await h.http().delete(`/api/accounts/${c2.id}`).expect(409);
    expect(recusa.body.message).toMatch(/IA de 2 projeto\(s\): Blog, Novo/);
    for (const p of (await h.http().get('/api/projects')).body.filter((x: any) => x.provider === c2.id)) await h.http().patch(`/api/projects/${p.id}`).send({ provider: c1.id }).expect(200);
    await h.http().delete(`/api/accounts/${c2.id}`).expect(200);
    expect(segredos()[`${c2.id}/ANTHROPIC_API_KEY`]).toBeUndefined();
    expect(fs.existsSync(path.join(os.homedir(), '.nivoo-ia', c2.id))).toBe(false);
    await h.http().post('/api/projects').send({ name: 'X', provider: c2.id }).expect(400); // não existe mais
    expect((await h.http().get('/api/accounts')).body.filter((c: any) => c.padrao)).toHaveLength(1); // outra virou padrão
  });

  it('segunda conta do Claude (assinatura): login pela tela grava o token só nela, sem desconectar a primeira', async () => {
    const extra = (await h.http().post('/api/accounts').send({ tipo: 'claude-code-cli', nome: 'Claude 2' }).expect(201)).body;
    expect(extra.id).toMatch(/^claude-code-cli--/);
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-')), 'claude');
    fs.writeFileSync(fake, `#!/usr/bin/env bash
if [ "$1" = setup-token ]; then
  echo "dir=$CLAUDE_CONFIG_DIR" > "${CTL}/login-env.txt"
  printf 'https://claude.com/cai/oauth/authorize?code=true&state=z\\n'
  read -r code; printf '\\n\\033[32m✓\\033[39m Long-lived authentication token created successfully!\\n\\nYour OAuth token (valid for 1 year):\\n\\nsk-ant-oat01-TOKENDACONTADOIS1234567890\\n\\nStore this token securely. You will not be able to see it again.\\n\\nUse this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\\n'; exit 0
fi
exec ${process.env.NIVOO_CLAUDE_BIN} "$@"
`, { mode: 0o755 });
    const original = process.env.NIVOO_CLAUDE_BIN;
    const tokenDaPrimeira = segredos().CLAUDE_CODE_OAUTH_TOKEN;
    process.env.NIVOO_CLAUDE_BIN = fake;
    try {
      await h.http().post(`/api/accounts/${extra.id}/login`).expect(201);
      await waitFor(async () => ((await h.http().get(`/api/accounts/${extra.id}/login`)).body.state === 'aguardando_codigo' ? true : null), 15_000);
      await h.http().post(`/api/accounts/${extra.id}/login/code`).send({ code: 'X' }).expect(201);
      await waitFor(async () => ((await h.http().get(`/api/accounts/${extra.id}/login`)).body.state === 'conectado' ? true : null), 15_000);
    } finally {
      process.env.NIVOO_CLAUDE_BIN = original;
    }
    expect(lido('login-env.txt').trim()).toBe(`dir=${path.join(os.homedir(), '.nivoo-ia', extra.id)}`);
    expect(segredos()[`${extra.id}/CLAUDE_CODE_OAUTH_TOKEN`]).toBe('sk-ant-oat01-TOKENDACONTADOIS1234567890');
    expect(segredos().CLAUDE_CODE_OAUTH_TOKEN).toBe(tokenDaPrimeira); // a primeira conta não foi tocada
    const p = (await h.http().post('/api/projects').send({ name: 'Com a conta 2', provider: extra.id }).expect(201)).body;
    expect((await trabalho(p.id, extra.id)).status).toBe('CONCLUIDO');
    expect(lido('env.txt').trim().split('|')[2]).toBe('sk-ant-oat01-TOKENDACONTADOIS1234567890');
    // Desconectar só esta (a conexão continua na lista).
    await h.http().post(`/api/accounts/${extra.id}/disconnect`).expect(201);
    expect(segredos()[`${extra.id}/CLAUDE_CODE_OAUTH_TOKEN`]).toBeUndefined();
    expect((await h.http().get('/api/accounts')).body.some((c: any) => c.id === extra.id)).toBe(true);
  });
});
