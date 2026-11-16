/**
 * Git do projeto (GitHub/GitLab): projeto a partir de repositório existente, IA trabalhando em cima dele
 * sem apagar as instruções do repositório (CLAUDE.md), commit único por trabalho, envio (push + tag),
 * atualização (pull), recusa de envio com o remoto à frente, envio automático e ligar projeto que começou
 * do zero. O "servidor Git" é um repositório bare local (NIVOO_GIT_PERMITIR_LOCAL=1, só nos testes);
 * o login por token é exercitado na conferência das contas e no Debian real.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appConfig } from '../../src/config';
import { normalizeRepoUrl } from '../../src/git/git.service';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ok = [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }];
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'Robson', GIT_AUTHOR_EMAIL: 'r@x', GIT_COMMITTER_NAME: 'Robson', GIT_COMMITTER_EMAIL: 'r@x' } }).toString().trim();

describe('Git do projeto (GitHub/GitLab)', () => {
  let h: Harness;
  let base: string;
  let remoto: string;
  let dev: string; // "outra pessoa" trabalhando no repositório
  beforeAll(async () => {
    process.env.NIVOO_GIT_PERMITIR_LOCAL = '1';
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'git-remoto-'));
    remoto = path.join(base, 'loja.git');
    git(base, 'init', '-q', '--bare', '-b', 'develop', remoto);
    dev = path.join(base, 'dev');
    git(base, 'clone', '-q', remoto, dev);
    git(dev, 'checkout', '-q', '-b', 'develop');
    fs.writeFileSync(path.join(dev, 'app.txt'), 'versão 1\n');
    fs.writeFileSync(path.join(dev, 'CLAUDE.md'), 'Regra do repositório: REPO-RULE-9.\n');
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'inicial');
    git(dev, 'push', '-q', 'origin', 'develop');
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    await h.close();
    delete process.env.NIVOO_GIT_PERMITIR_LOCAL;
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(base, { recursive: true, force: true });
  });

  // O envio ao Git acontece logo depois do "Pronto": espera a linha dele no registro do trabalho.
  const logDoEnvio = (jid: string) =>
    waitFor(async () => {
      const l = (await h.http().get(`/api/projects/${pid}/jobs/${jid}/logs`)).body.map((x: any) => x.message).join('\n');
      return /enviada ao Git|envio automático ao Git falhou/.test(l) ? l : null;
    }, 30_000);

  const job = async (pid: string, body: any) => {
    const j = (await h.http().post(`/api/projects/${pid}/jobs`).send({ objective: 'objetivo do trabalho', criteria: ok, ...body }).expect(201)).body;
    await h.http().post(`/api/projects/${pid}/jobs/${j.id}/start`).expect(201);
    return waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/jobs/${j.id}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 30_000);
  };

  it('endereços: https, git@host:grupo/repo e ssh:// viram https; usuário/token no endereço é recusado', () => {
    delete process.env.NIVOO_GIT_PERMITIR_LOCAL;
    try {
      expect(normalizeRepoUrl('git@git.nivoo.dev.br:nivoo-dev/studio-workflow.git')).toBe('https://git.nivoo.dev.br/nivoo-dev/studio-workflow.git');
      expect(normalizeRepoUrl('ssh://git@gitlab.exemplo.com:2222/grupo/app')).toBe('https://gitlab.exemplo.com/grupo/app.git');
      expect(normalizeRepoUrl('https://github.com/fulano/app')).toBe('https://github.com/fulano/app.git');
      expect(() => normalizeRepoUrl('https://user:tok@github.com/fulano/app')).toThrow(/usuário ou token/);
      expect(() => normalizeRepoUrl('/etc/algum-repo')).toThrow(); // caminho local só nos testes
    } finally {
      process.env.NIVOO_GIT_PERMITIR_LOCAL = '1';
    }
  });

  it('contas Git: token guardado fora do banco (arquivo 600), nunca devolvido pela API', async () => {
    const c = (await h.http().post('/api/git/accounts').send({ tipo: 'gitlab', host: 'git.exemplo.com.br/', token: 'glpat-TOKEN-DE-TESTE-123', verificar: false, autorNome: 'Robson', autorEmail: 'r@x' }).expect(201)).body;
    expect(c).toMatchObject({ tipo: 'gitlab', host: 'https://git.exemplo.com.br', usuario: 'oauth2' });
    expect(c.token).toBeUndefined();
    expect(JSON.stringify((await h.http().get('/api/git/accounts')).body)).not.toContain('glpat-TOKEN');
    const arq = path.join(path.dirname(appConfig().workspacesRoot), 'git-contas.json');
    expect(fs.statSync(arq).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(arq, 'utf8')).toContain('glpat-TOKEN-DE-TESTE-123');
    await h.http().post('/api/git/accounts').send({ tipo: 'outro', token: 'x'.repeat(20) }).expect(400);
    await h.http().delete(`/api/git/accounts/${c.id}`).expect(200);
    expect((await h.http().get('/api/git/accounts')).body).toHaveLength(0);
  });

  let pid = '';
  it('projeto a partir do repositório: clona a branch; a IA lê CLAUDE.md do repositório sem apagá-lo; um commit por trabalho', async () => {
    await h.http().post('/api/projects').send({ name: 'Loja', git: { url: remoto, branch: 'nao-existe' } }).expect(400);
    const p = (await h.http().post('/api/projects').send({ name: 'Loja', git: { url: remoto, branch: 'develop' } }).expect(201)).body;
    pid = p.id;
    expect(p).toMatchObject({ gitUrl: remoto, gitBranch: 'develop' });
    expect((await h.http().get(`/api/projects/${pid}/files`)).body.arquivos.map((f: any) => f.path)).toEqual(expect.arrayContaining(['app.txt', 'CLAUDE.md']));

    fs.mkdirSync(CTL, { recursive: true });
    fs.rmSync(path.join(CTL, 'mode'), { force: true });
    const d = await job(pid, {
      title: 'Ajusta a versão',
      defaultProvider: 'claude-code-cli',
      conferencia: false,
      steps: [{ key: 's', instructions: 'x', verifyCommand: 'grep -q REPO-RULE-9 contexto/repositorio/_CLAUDE.md && test ! -e CLAUDE.md' }],
    });
    expect(d.status).toBe('CONCLUIDO');
    const promptEtapa = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(promptEtapa).toContain('contexto/repositorio/');
    // A IA sabe que esta pasta É o projeto ligado ao repositório (não pede endereço nem "a pasta original").
    expect(promptEtapa).toContain(`ligada ao repositório ${remoto} (branch develop)`);
    expect(promptEtapa).toMatch(/Caminhos de outra máquina[\s\S]*são ESTE mesmo projeto/);
    expect(promptEtapa).not.toMatch(/not a git repository/); // a etapa roda numa cópia com git
    // Conversa: cópia sem .git — o prompt explica e o histórico vai em contexto/historico-git.txt.
    const conv = (await h.http().post(`/api/projects/${pid}/conversations`).send({}).expect(201)).body;
    fs.writeFileSync(path.join(CTL, 'mode'), 'texto');
    fs.writeFileSync(path.join(CTL, 'resposta.txt'), '```json\n{"tipo":"resposta","texto":"ok","memoria":[]}\n```');
    await h.http().post(`/api/projects/${pid}/conversations/${conv.id}/messages`).send({ content: 'faça a auditoria' }).expect(201);
    await waitFor(async () => {
      const ms = (await h.http().get(`/api/projects/${pid}/conversations/${conv.id}`)).body.messages;
      return ms.some((m: any) => m.role === 'ASSISTENTE' && m.status !== 'PENDENTE') ? true : null;
    }, 60_000);
    fs.rmSync(path.join(CTL, 'mode'), { force: true });
    fs.rmSync(path.join(CTL, 'resposta.txt'), { force: true });
    const promptConversa = fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8');
    expect(promptConversa).toContain(`ligada ao repositório ${remoto} (branch develop)`);
    expect(promptConversa).toMatch(/"not a git repository" — é esperado, não é bloqueio/);
    expect(fs.readFileSync(path.join(CTL, 'historico-git.txt'), 'utf8')).toMatch(/inicial/);
    const repo = path.join(p.workspacePath, 'repo');
    expect(git(repo, 'show', 'main:CLAUDE.md')).toBe('Regra do repositório: REPO-RULE-9.'); // intacto
    // Um trabalho de IA de verdade muda arquivos: aqui, um trabalho local que edita app.txt.
    const d2 = await job(pid, { title: 'Versão 2 do app', steps: [{ key: 's', instructions: 'echo "versão 2" > app.txt' }] });
    expect(d2.status).toBe('CONCLUIDO');
    expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('Versão 2 do app');
    expect(git(repo, 'log', '-1', '--format=%B', 'main')).toContain('conferência das regras');
    expect(git(repo, 'log', '--format=%s', 'main')).not.toContain('checkpoint'); // sem commits internos
    // Versionamento padrão (projeto ligado ao Git): commit + tag + push sozinho; trabalho sem mudança não gera versão.
    const envio = await logDoEnvio(d2.id);
    expect((await h.http().get(`/api/projects/${pid}/git`)).body).toMatchObject({ autoEnvio: true, enviar: 0 });
    const tags = git(dev, 'ls-remote', '--tags', 'origin');
    expect(tags).toContain('refs/tags/v0.1.0');
    expect(tags).not.toContain('refs/tags/v0.1.1');
    git(dev, 'pull', '-q', 'origin', 'develop');
    expect(fs.readFileSync(path.join(dev, 'app.txt'), 'utf8')).toBe('versão 2\n');
    expect(envio).toContain('Versão v0.1.0 enviada ao Git (commit + tag + push).');
  });

  it('versionamento padrão com o repositório à frente: traz as novidades, cria a próxima versão e envia', async () => {
    fs.writeFileSync(path.join(dev, 'externo.md'), 'feito fora do Nivoo\n');
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'mudança externa antes');
    git(dev, 'push', '-q', 'origin', 'develop');
    const d = await job(pid, { title: 'Mais um ajuste', steps: [{ key: 's', instructions: 'echo ajuste > ajuste.txt' }] });
    expect(d.status).toBe('CONCLUIDO');
    expect(await logDoEnvio(d.id)).toContain('Versão v0.1.1 enviada ao Git (commit + tag + push); antes, trouxe as novidades que já estavam no repositório.');
    git(dev, 'pull', '-q', 'origin', 'develop');
    expect(fs.existsSync(path.join(dev, 'ajuste.txt')) && fs.existsSync(path.join(dev, 'externo.md'))).toBe(true);
    expect(git(dev, 'ls-remote', '--tags', 'origin')).toContain('refs/tags/v0.1.1');
  });

  it('a etiqueta segue a versão que o projeto declara (package.json): 0.4.0 vira v0.4.0; sem subir, segue a sequência', async () => {
    const a = await job(pid, { title: 'Versão nova', steps: [{ key: 's', instructions: `printf '{\\n  "name": "loja",\\n  "version": "0.4.0"\\n}\\n' > package.json` }] });
    expect(a.status).toBe('CONCLUIDO');
    expect(await logDoEnvio(a.id)).toContain('Versão v0.4.0 enviada ao Git');
    const b = await job(pid, { title: 'Sem subir versão', steps: [{ key: 's', instructions: 'echo x > outro.txt' }] });
    expect(b.status).toBe('CONCLUIDO');
    expect(await logDoEnvio(b.id)).toContain('Versão v0.4.1 enviada ao Git');
    expect(git(dev, 'ls-remote', '--tags', 'origin')).toMatch(/refs\/tags\/v0\.4\.0[\s\S]*refs\/tags\/v0\.4\.1|refs\/tags\/v0\.4\.1[\s\S]*refs\/tags\/v0\.4\.0/);
  });

  it('envio manual (versionamento automático desligado): push + tag; remoto à frente recusa até atualizar; conflito não estraga nada', async () => {
    await h.http().patch(`/api/projects/${pid}/git`).send({ autoEnvio: false }).expect(200);
    const st = (await h.http().get(`/api/projects/${pid}/git`).expect(200)).body;
    expect(st).toMatchObject({ ligado: true, branch: 'develop', enviar: 0, receber: 0, autoEnvio: false });
    await h.http().post(`/api/projects/${pid}/git/push`).send({ tag: 'v1.0.0', mensagem: 'primeira versão' }).expect(201);
    git(dev, 'pull', '-q', 'origin', 'develop');
    expect(git(dev, 'ls-remote', '--tags', 'origin')).toContain('refs/tags/v1.0.0');
    await h.http().post(`/api/projects/${pid}/git/push`).send({ tag: 'v1.0.0' }).expect(409); // tag repetida
    await h.http().post(`/api/projects/${pid}/git/push`).send({ tag: 'nome inválido' }).expect(400);
    // Nome de tag que vira opção do git ou que é nome de branch: recusado (uma tag "main" travaria a pasta principal).
    await h.http().post(`/api/projects/${pid}/git/push`).send({ tag: '--force' }).expect(400);
    await h.http().post(`/api/projects/${pid}/git/push`).send({ tag: 'main' }).expect(400);
    const repoP = path.join((await h.prisma.project.findUniqueOrThrow({ where: { id: pid } })).workspacePath, 'repo');
    expect(git(repoP, 'tag', '-l').split('\n')).not.toContain('main');

    // Alguém envia direto ao repositório; aqui também sai um trabalho novo (arquivo diferente).
    fs.writeFileSync(path.join(dev, 'LEIAME.md'), 'feito fora do Nivoo\n');
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'mudança externa');
    git(dev, 'push', '-q', 'origin', 'develop');
    await job(pid, { title: 'Novo arquivo', steps: [{ key: 's', instructions: 'echo novo > novo.txt' }] });
    expect((await h.http().get(`/api/projects/${pid}/git`)).body).toMatchObject({ enviar: 1, receber: 1 });
    await h.http().post(`/api/projects/${pid}/git/push`).expect(409); // remoto à frente
    // Com tag: ou vão branch e tag, ou nada (sem tag solta só aqui nem branch sem versão lá).
    await h.http().post(`/api/projects/${pid}/git/push`).send({ tag: 'v9.9.9' }).expect(409);
    expect(git(repoP, 'tag', '-l')).not.toContain('v9.9.9');
    expect(git(dev, 'ls-remote', '--tags', 'origin')).not.toContain('v9.9.9');
    const pull = (await h.http().post(`/api/projects/${pid}/git/pull`).expect(201)).body;
    expect(pull.resultado).toBe('atualizado');
    await h.http().post(`/api/projects/${pid}/git/push`).expect(201);
    git(dev, 'pull', '-q', 'origin', 'develop');
    expect(fs.existsSync(path.join(dev, 'novo.txt'))).toBe(true);

    // Conflito: os dois lados mudam app.txt de jeitos diferentes → atualização recusada, nada muda.
    fs.writeFileSync(path.join(dev, 'app.txt'), 'versão do colega\n');
    git(dev, 'commit', '-q', '-am', 'colega');
    git(dev, 'push', '-q', 'origin', 'develop');
    await job(pid, { title: 'Versão 3', steps: [{ key: 's', instructions: 'echo "versão 3" > app.txt' }] });
    const repo = path.join((await h.prisma.project.findUniqueOrThrow({ where: { id: pid } })).workspacePath, 'repo');
    const antes = git(repo, 'rev-parse', 'main');
    await h.http().post(`/api/projects/${pid}/git/pull`).expect(409);
    expect(git(repo, 'rev-parse', 'main')).toBe(antes);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('envio automático ao concluir; projeto que começou do zero pode ser ligado a um repositório vazio', async () => {
    const vazio = path.join(base, 'novo.git');
    git(base, 'init', '-q', '--bare', '-b', 'main', vazio);
    const p = (await h.http().post('/api/projects').send({ name: 'Do zero' }).expect(201)).body;
    await h.http().patch(`/api/projects/${p.id}/git`).send({ autoEnvio: true }).expect(400); // ainda não ligado
    const st = (await h.http().post(`/api/projects/${p.id}/git/link`).send({ url: vazio, branch: 'main' }).expect(201)).body;
    expect(st).toMatchObject({ ligado: true, remotoVazio: true });
    await h.http().patch(`/api/projects/${p.id}/git`).send({ autoEnvio: true }).expect(200);
    const d = await job(p.id, { title: 'Primeira página', steps: [{ key: 's', instructions: 'echo "<h1>oi</h1>" > index.html' }] });
    expect(d.status).toBe('CONCLUIDO');
    await waitFor(async () => (execFileSync('git', ['--git-dir', vazio, 'log', '--format=%s', 'main']).toString().includes('Primeira página') ? true : null), 15_000);
    await h.http().delete(`/api/projects/${p.id}/git`).expect(200);
    expect((await h.http().get(`/api/projects/${p.id}/git`)).body.ligado).toBe(false);
  });

  it('trabalho que pede para atualizar o CLAUDE.md do repositório: a nova versão fica; pasta .claude/ plantada não', async () => {
    fs.mkdirSync(CTL, { recursive: true });
    fs.writeFileSync(path.join(CTL, 'mode'), 'bash');
    const d = await job(pid, {
      title: 'Registrar a regra',
      defaultProvider: 'claude-code-cli',
      conferencia: false,
      steps: [{
        key: 'regra',
        instructions: "test ! -e CLAUDE.md && cp contexto/repositorio/_CLAUDE.md CLAUDE.md && printf '\\nAtualize o CHANGELOG a cada versão.\\n' >> CLAUDE.md && mkdir -p .claude && echo '{\"hooks\":{}}' > .claude/settings.json",
        verifyCommand: 'grep -q CHANGELOG CLAUDE.md && grep -q REPO-RULE-9 CLAUDE.md',
      }],
    });
    fs.rmSync(path.join(CTL, 'mode'), { force: true });
    expect(d.status).toBe('CONCLUIDO');
    expect(fs.readFileSync(path.join(CTL, 'prompt.txt'), 'utf8')).toMatch(/escreva o arquivo no caminho original \(ex\.: CLAUDE\.md\)/);
    const repo = path.join((await h.prisma.project.findUniqueOrThrow({ where: { id: pid } })).workspacePath, 'repo');
    const claudeMd = git(repo, 'show', 'main:CLAUDE.md');
    expect(claudeMd).toContain('REPO-RULE-9');
    expect(claudeMd).toContain('Atualize o CHANGELOG a cada versão.');
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('.claude/');
  });
  it('repositório SEM CLAUDE.md e o plano pede para criar um: o novo fica, sobrevive às próximas etapas e entra na main', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Sem instruções' }).expect(201)).body;
    fs.mkdirSync(CTL, { recursive: true });
    fs.writeFileSync(path.join(CTL, 'mode'), 'bash');
    const d = await job(p.id, {
      title: 'Criar o CLAUDE.md',
      defaultProvider: 'claude-code-cli',
      conferencia: false,
      criteria: [{ key: 'regra-registrada', description: 'regra no CLAUDE.md', kind: 'COMMAND', config: { command: 'grep -q REGRA-NOVA-7 CLAUDE.md && grep -q SUB-3 docs/AGENTS.md' } }],
      steps: [
        { key: 'regra', instructions: "echo 'Regra: REGRA-NOVA-7' > CLAUDE.md && mkdir -p docs && echo 'SUB-3' > docs/AGENTS.md", verifyCommand: 'grep -q REGRA-NOVA-7 CLAUDE.md' },
        // Na etapa seguinte o arquivo criado antes é do trabalho: fica fora da pasta (cópia em contexto/) e volta depois.
        { key: 'depois', instructions: 'test ! -e CLAUDE.md && grep -q REGRA-NOVA-7 contexto/repositorio/_CLAUDE.md && echo ok > feito.txt', verifyCommand: 'test -f feito.txt' },
      ],
    });
    fs.rmSync(path.join(CTL, 'mode'), { force: true });
    const logs = (await h.http().get(`/api/projects/${p.id}/jobs/${d.id}/logs`)).body.map((x: any) => x.message).join('\n');
    expect(logs).not.toMatch(/criou arquivos de harness[^\n]*CLAUDE\.md/);
    expect(d.status).toBe('CONCLUIDO');
    const repo = path.join((await h.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).workspacePath, 'repo');
    expect(git(repo, 'show', 'main:CLAUDE.md')).toBe('Regra: REGRA-NOVA-7');
    expect(git(repo, 'show', 'main:docs/AGENTS.md')).toBe('SUB-3');
    expect(git(repo, 'show', 'main:feito.txt')).toBe('ok');
  });
});
