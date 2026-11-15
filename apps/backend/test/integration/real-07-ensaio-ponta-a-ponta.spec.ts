/**
 * ENSAIO REAL ponta a ponta (opt-in: NIVOO_RUN_CLI_INTEGRATION=1) — Claude Code de verdade, o caminho do usuário:
 * projeto trazido de um repositório Git (pnpm, testes com node --test, build), com um bug que faz um teste falhar,
 * um arquivo morto e SEM CLAUDE.md. Pedido em duas partes pelo chat → plano → "Fazer" → etapas com conferência que
 * roda pnpm test/build → revisão → entrega → a segunda parte começa sozinha → fim.
 *
 * Confere o que o usuário veria: testes passando NA PASTA PRINCIPAL, bug corrigido, arquivo morto removido,
 * CLAUDE.md criado, nada de node_modules no git, entrega sem pedir para o usuário rodar testes, memória sem lixo.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import { REAL, requireProvider } from '../support/real';

const d = REAL ? describe : describe.skip;
// Qual IA ensaiar: NIVOO_ENSAIO_IA=claude-code-cli (padrão) ou codex-cli.
const IA = process.env.NIVOO_ENSAIO_IA ?? 'claude-code-cli';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'R', GIT_AUTHOR_EMAIL: 'r@x', GIT_COMMITTER_NAME: 'R', GIT_COMMITTER_EMAIL: 'r@x' } }).toString().trim();

function criarRepositorio(base: string): string {
  const remoto = path.join(base, 'loja.git');
  git(base, 'init', '-q', '--bare', '-b', 'main', remoto);
  const dev = path.join(base, 'dev');
  git(base, 'clone', '-q', remoto, dev);
  const w = (rel: string, txt: string) => {
    fs.mkdirSync(path.dirname(path.join(dev, rel)), { recursive: true });
    fs.writeFileSync(path.join(dev, rel), txt);
  };
  w('package.json', JSON.stringify({
    name: 'loja', version: '0.3.0', private: true, type: 'module', packageManager: 'pnpm@10.0.0',
    scripts: { test: 'node --test test/*.test.js', build: 'node scripts/build.mjs' },
  }, null, 2) + '\n');
  w('pnpm-lock.yaml', "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n");
  w('src/preco.js', [
    '// Preço final com desconto percentual (ex.: 10 = 10%).',
    'export function precoComDesconto(preco, desconto) {',
    '  return preco - desconto; // BUG: subtrai o número, não a porcentagem',
    '}',
    '',
  ].join('\n'));
  w('src/velho.js', '// Código antigo: não é importado por ninguém.\nexport function calculoAntigo(x) { return x * 2; }\n');
  w('test/preco.test.js', [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { precoComDesconto } from '../src/preco.js';",
    "test('10% de desconto em 200 dá 180', () => assert.equal(precoComDesconto(200, 10), 180));",
    '',
  ].join('\n'));
  w('scripts/build.mjs', "import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nfor (const f of readdirSync('src')) copyFileSync(`src/${f}`, `dist/${f}`);\nconsole.log('build ok');\n");
  w('.gitignore', 'node_modules/\ndist/\n');
  w('CHANGELOG.md', '# Changelog\n\n## 0.3.0\n- Cálculo de preço.\n');
  git(dev, 'add', '-A');
  git(dev, 'commit', '-q', '-m', 'inicial');
  git(dev, 'push', '-q', 'origin', 'main');
  return remoto;
}

d(`ENSAIO REAL ponta a ponta (${IA})`, () => {
  let h: Harness;
  let base: string;
  beforeAll(async () => {
    delete process.env.NIVOO_CLAUDE_BIN;
    process.env.NIVOO_GIT_PERMITIR_LOCAL = '1';
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ensaio-'));
    h = await createHarness();
    await truncateAll(h.prisma);
    await requireProvider(h, IA);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
    delete process.env.NIVOO_GIT_PERMITIR_LOCAL;
  });

  it('pedido em duas partes vai até o fim, testado pelo sistema, sem trabalho empurrado para o usuário', async () => {
    const remoto = criarRepositorio(base);
    const p = (await h.http().post('/api/projects').send({ name: 'Loja ensaio', provider: IA, git: { url: remoto, branch: 'main' } }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const msgs = async () => (await h.http().get(`/api/projects/${p.id}/conversations/${c.id}`)).body.messages;
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({
      content: [
        'Duas partes, faça tudo até o fim:',
        'Parte 1: o cálculo de desconto em src/preco.js está errado (o teste falha). Corrija. O arquivo src/velho.js não é usado por ninguém: apague.',
        'Parte 2: crie em src/frete.js a função freteGratis(total) que devolve true a partir de 150, com teste em test/frete.test.js.',
        'Registre no CLAUDE.md a regra: "todo cálculo tem teste". Suba a versão no package.json e escreva no CHANGELOG.',
      ].join('\n'),
    }).expect(201);
    const plano = await waitFor(async () => (await msgs()).find((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE' && m.kind !== 'sistema') ?? null, 900_000);
    console.log('PLANO:', plano.kind, JSON.stringify(plano.plan, null, 1)?.slice(0, 4000), '\nTEXTO:', plano.content);
    expect(plano.kind).toBe('plano');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Ensaio' }).expect(201);

    // Espera tudo assentar: nenhum trabalho rodando, nenhuma resposta pendente, por 60 s seguidos.
    let quieto = 0;
    const inicio = Date.now();
    while (Date.now() - inicio < 75 * 60_000) {
      await new Promise((r) => setTimeout(r, 15_000));
      const ms = await msgs();
      const jobs = (await h.http().get(`/api/projects/${p.id}/jobs`)).body;
      const ativo = jobs.some((j: any) => ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO'].includes(j.status)) || ms.some((m: any) => m.status === 'PENDENTE');
      quieto = ativo ? 0 : quieto + 1;
      if (quieto >= 4) break;
    }
    const ms = await msgs();
    const jobs = (await h.http().get(`/api/projects/${p.id}/jobs`)).body;
    console.log('CONVERSA:\n' + ms.map((m: any) => `--- ${m.role}/${m.kind}/${m.status}${m.approvedBy ? ` (aprovado por ${m.approvedBy})` : ''}\n${String(m.content).slice(0, 3000)}`).join('\n'));
    for (const j of jobs) {
      const full = (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body;
      console.log(`TRABALHO ${full.title}: ${full.status} ${full.blockedReason ?? ''} ${full.statusDetail ?? ''}`);
      for (const s of full.steps) console.log(`  etapa ${s.key} [${s.status}] verify: ${s.verifyCommand}`);
      for (const a of full.attempts) console.log(`  tentativa ${a.number} ${a.status} ${(a.error ?? '').slice(-300)}`);
    }
    const repo = path.join(p.workspacePath, 'repo');
    const arquivos = git(repo, 'ls-tree', '-r', '--name-only', 'main');
    console.log('MAIN:\n' + arquivos);
    const mem = (await h.http().get(`/api/projects/${p.id}/memory`)).body;
    console.log('MEMÓRIA DO PROJETO:', mem.map((m: any) => `${m.category}: ${m.title}`).join(' | '));

    // O que o usuário veria.
    expect(jobs.every((j: any) => j.status === 'CONCLUIDO')).toBe(true);
    const tmp = path.join(base, 'confere');
    git(base, 'clone', '-q', repo, tmp);
    execFileSync('bash', ['-c', 'node --test test/*.test.js'], { cwd: tmp, stdio: 'pipe' }); // testes passando na pasta principal
    expect(fs.existsSync(path.join(tmp, 'src/velho.js'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'src/frete.js'))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf8')).toMatch(/teste/i);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).version).not.toBe('0.3.0');
    expect(arquivos).not.toMatch(/node_modules|\.pytest_cache|^dist\//m);
    const verificacoes = (await Promise.all(jobs.map(async (j: any) => (await h.http().get(`/api/projects/${p.id}/jobs/${j.id}`)).body.steps.map((s: any) => s.verifyCommand ?? '')))).flat().join('\n');
    expect(verificacoes).toMatch(/\bp?npm( run)? test|node --test/); // o sistema testou
    const entregas = ms.filter((m: any) => m.kind === 'entrega').map((m: any) => m.content).join('\n');
    expect(entregas).not.toMatch(/(você|voce) (pode )?rod(a|e)r? (os )?test|rode `?(pnpm|npm) /i);
    expect(ms.some((m: any) => /\(sem resposta\)/.test(m.content))).toBe(false);
  }, 90 * 60_000);
});
