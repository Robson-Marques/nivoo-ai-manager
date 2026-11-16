/**
 * REAL (opt-in: NIVOO_RUN_CLI_INTEGRATION=1; IA em NIVOO_ENSAIO_IA): o caso do IA Studio — projeto ligado ao
 * repositório, regra escrita para a máquina local ("audite só na pasta original C:\Users\...; se não estiver nela,
 * pare") e pedido de auditoria pela conversa. A IA tem de planejar a auditoria nesta pasta, sem parar, sem pedir a
 * pasta do Windows, autorização ou o endereço do repositório.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import { REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
const IA = process.env.NIVOO_ENSAIO_IA ?? 'codex-cli';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'R', GIT_AUTHOR_EMAIL: 'r@x', GIT_COMMITTER_NAME: 'R', GIT_COMMITTER_EMAIL: 'r@x' } }).toString();

d(`REAL: pasta do projeto é o repositório ligado (${IA})`, () => {
  let h: Harness;
  beforeAll(async () => {
    delete process.env.NIVOO_CLAUDE_BIN;
    process.env.NIVOO_GIT_PERMITIR_LOCAL = '1';
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, IA);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
  });

  it('pedido de auditoria com regra de "pasta original no Windows": planeja aqui, sem bloquear nem pedir o repositório', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-studio-'));
    const remoto = path.join(base, 'ia-studio.git');
    const dev = path.join(base, 'dev');
    git(base, 'init', '-q', '--bare', '-b', 'main', remoto);
    git(base, 'clone', '-q', remoto, dev);
    fs.mkdirSync(path.join(dev, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dev, 'README.md'), '# IA Studio\nPainel de atendimento.\n');
    fs.writeFileSync(path.join(dev, 'src', 'app.js'), 'console.log("app");\n');
    fs.writeFileSync(path.join(dev, 'src', 'antigo.js'), '// não usado\n');
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'inicial');
    git(dev, 'push', '-q', 'origin', 'HEAD:main');
    const p = (await h.http().post('/api/projects').send({
      name: 'IA Studio',
      provider: IA,
      git: { url: remoto, branch: 'main' },
      rules: 'Auditorias rodam somente no repositório original em C:\\Users\\Flowspec\\Documents\\delivery-system\\IA STUDIO. Se a sessão não estiver nessa pasta, pare e peça a pasta original.',
    }).expect(201)).body;
    await h.http().get(`/api/projects/${p.id}/git`).expect(200); // a aba Git consulta o remoto (estado "em dia")
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'Faça uma auditoria completa de limpeza, organização e documentação do projeto (só relatório, sem mudar nada).' }).expect(201);
    const r = await waitFor(async () => {
      const ms = (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
      return ms.find((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE' && m.kind !== 'sistema') ?? null;
    }, 900_000);
    console.log('RESPOSTA:', r.kind, r.content, JSON.stringify(r.perguntas ?? r.plan?.steps?.map((s: any) => s.title)));
    const tudo = `${r.content}\n${JSON.stringify(r.perguntas ?? '')}`;
    expect(tudo).not.toMatch(/pasta original|C:\\\\?Users|endereço do repositório|qual repositório|autoriza/i);
    expect(r.kind).toBe('plano');
  }, 20 * 60_000);
});
