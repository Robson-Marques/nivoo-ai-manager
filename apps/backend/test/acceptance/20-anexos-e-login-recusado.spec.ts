/**
 * Chat com anexos: imagem vai como imagem para a IA ver; documentos (Word...) viram texto; arquivo de
 * texto entra como está; tipos não suportados são recusados. Os anexos chegam à sessão em
 * contexto/anexos/<mensagem>/, aparecem no prompt, podem ser abertos pela tela e — quando o plano pede —
 * são copiados para dentro do projeto pelo sistema (ex.: o logo enviado vira public/logo.png).
 * Login recusado pela IA (token expirado/revogado): a conexão deixa de aparecer "Conectado" até reconectar.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const CTL = path.join(process.env.TMPDIR ?? '/tmp', 'nivoo-cli-stub');
const ctl = (name: string, value: string | null) => {
  fs.mkdirSync(CTL, { recursive: true });
  if (value === null) fs.rmSync(path.join(CTL, name), { force: true });
  else fs.writeFileSync(path.join(CTL, name), value);
};
const lido = (name: string) => fs.readFileSync(path.join(CTL, name), 'utf8');
const b64 = (t: string | Buffer) => Buffer.from(t).toString('base64');
// PNG 1x1 válido.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Chat com anexos e login recusado', () => {
  let h: Harness;
  let docs: string;
  beforeAll(async () => {
    process.env.NIVOO_CLAUDE_BIN = path.join(__dirname, '..', 'support', 'stubs', 'claude-stub.sh');
    fs.rmSync(CTL, { recursive: true, force: true });
    docs = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-anexos-'));
    execFileSync('python3', [path.join(__dirname, '..', 'support', 'documentos.py'), docs]);
    h = await createHarness();
    await truncateAll(h.prisma);
    h.worker.start();
  });
  afterAll(async () => {
    for (const p of (await h.http().get('/api/projects')).body) await h.http().delete(`/api/projects/${p.id}`);
    await h.close();
    delete process.env.NIVOO_CLAUDE_BIN;
    fs.rmSync(CTL, { recursive: true, force: true });
    fs.rmSync(docs, { recursive: true, force: true });
  });

  const resposta = (pid: string, cid: string, n: number) =>
    waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${pid}/conversations/${cid}`)).body;
      const r = x.messages.filter((m: any) => m.role === 'ASSISTENTE' && m.kind !== 'sistema');
      return r.length >= n && r[n - 1].status !== 'PENDENTE' ? r[n - 1] : null;
    });

  it('imagem, documento e texto chegam à IA; tipos ruins são recusados; o plano coloca o logo no projeto', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Site com logo', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const enviar = (corpo: any) => h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send(corpo);

    // Recusas claras (nada é gravado).
    expect((await enviar({ content: 'x', anexos: [{ nome: 'pacote.zip', contentBase64: b64('PK') }] }).expect(400)).body.message).toMatch(/pacote\.zip: tipo de arquivo não suportado/);
    expect((await enviar({ content: 'x', anexos: [{ nome: 'velho.doc', contentBase64: b64('x') }] }).expect(400)).body.message).toMatch(/Formato antigo/);
    await enviar({ content: '' }).expect(400); // sem texto e sem anexo

    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n{"tipo":"resposta","texto":"Vi a imagem e li o contrato.","memoria":[]}\n```');
    // Só anexos, sem texto: vale; o título da conversa vem dos anexos.
    const r1 = (
      await enviar({
        anexos: [
          { nome: 'logo.png', contentBase64: PNG.toString('base64') },
          { nome: 'contrato.docx', contentBase64: fs.readFileSync(path.join(docs, 'contrato.docx')).toString('base64') },
          { nome: 'notas.md', contentBase64: b64('# Notas\nCor principal: laranja') },
        ],
      }).expect(201)
    ).body;
    const minha = r1.messages.find((m: any) => m.role === 'USUARIO');
    expect(minha.attachments).toEqual([
      { nome: 'logo.png', tipo: 'imagem', bytes: PNG.length },
      { nome: 'contrato.txt', tipo: 'texto', bytes: expect.any(Number), de: 'contrato.docx' },
      { nome: 'notas.md', tipo: 'texto', bytes: Buffer.byteLength('# Notas\nCor principal: laranja') },
    ]);
    expect(r1.title).toBe('logo.png, contrato.docx, notas.md');
    expect((await resposta(p.id, c.id, 1)).content).toBe('Vi a imagem e li o contrato.');
    const prompt = lido('prompt.txt');
    expect(prompt).toContain('(sem texto: o usuário só enviou anexos)');
    expect(prompt).toContain(`- contexto/anexos/${minha.id}/logo.png (imagem: abra o arquivo para ver)`);
    expect(prompt).toContain(`- contexto/anexos/${minha.id}/contrato.txt (texto extraído de contrato.docx)`);
    expect(lido('anexos.txt')).toContain(`./${minha.id}/logo.png ${PNG.length}`);

    // Abrir pela tela: imagem com o tipo certo; o documento como texto.
    const img = await h.http().get(`/api/projects/${p.id}/conversations/${c.id}/messages/${minha.id}/anexos/logo.png`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (d: Buffer) => partes.push(d));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body, PNG)).toBe(0);
    expect((await h.http().get(`/api/projects/${p.id}/conversations/${c.id}/messages/${minha.id}/anexos/contrato.txt`).expect(200)).text).toContain('DOCX-11');
    await h.http().get(`/api/projects/${p.id}/conversations/${c.id}/messages/${minha.id}/anexos/..%2F..%2Fsegredo`).expect(404);

    // A IA propõe colocar o logo no projeto: o sistema copia o arquivo (a IA não consegue gravar imagem).
    ctl(
      'resposta.txt',
      '```json\n' +
        JSON.stringify({
          tipo: 'plano',
          texto: 'Vou colocar o seu logo no site.',
          job: {
            title: 'Logo no site',
            objective: 'public/logo.png é o logo enviado',
            anexosNoProjeto: [
              { anexo: `contexto/anexos/${minha.id}/logo.png`, para: 'public/logo.png' },
              { anexo: 'contexto/anexos/outra-conversa/x.png', para: 'public/x.png' }, // não é desta conversa: ignorado
            ],
            steps: [{ key: 'conferir', title: 'Conferir o logo', instructions: 'confira', verifyCommand: 'test -s public/logo.png' }],
            criteria: [{ key: 'logo', description: 'logo no projeto', kind: 'FILE_EXISTS', config: { path: 'public/logo.png' } }],
          },
          memoria: [],
        }) +
        '\n```',
    );
    await enviar({ content: 'Coloque esse logo no site' }).expect(201);
    const plano = await resposta(p.id, c.id, 2);
    expect(plano.kind).toBe('plano');
    expect(plano.plan.anexosNoProjeto).toEqual([{ anexo: `contexto/anexos/${minha.id}/logo.png`, para: 'public/logo.png' }]);
    const aprovado = (await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages/${plano.id}/approve`).send({ decidedBy: 'Robson' }).expect(201)).body;
    const jobId = aprovado.messages.find((m: any) => m.id === plano.id).jobId;
    const job = await waitFor(async () => {
      const x = (await h.http().get(`/api/projects/${p.id}/jobs/${jobId}`)).body;
      return ['CONCLUIDO', 'BLOQUEADO', 'FALHOU'].includes(x.status) ? x : null;
    }, 30_000);
    expect(job.status).toBe('CONCLUIDO');
    const noProjeto = execFileSync('git', ['show', 'main:public/logo.png'], { cwd: path.join(p.workspacePath, 'repo') });
    expect(Buffer.compare(noProjeto, PNG)).toBe(0);
    expect(lido('anexos.txt')).toContain(`./${minha.id}/logo.png`); // as etapas do trabalho também recebem os anexos

    // Excluir a conversa apaga os anexos dela.
    await h.http().delete(`/api/projects/${p.id}/conversations/${c.id}`).expect(200);
    expect(fs.existsSync(path.join(p.workspacePath, 'anexos', c.id))).toBe(false);
    ctl('mode', null);
    ctl('resposta.txt', null);
  });

  it('login recusado pela IA: a conexão vira "reconecte" e a mensagem explica; reconectar limpa', async () => {
    const p = (await h.http().post('/api/projects').send({ name: 'Token vencido', provider: 'claude-code-cli' }).expect(201)).body;
    const c = (await h.http().post(`/api/projects/${p.id}/conversations`).send({}).expect(201)).body;
    const antes = (await h.http().get('/api/accounts?atualizar=1')).body.find((x: any) => x.id === 'claude-code-cli');
    expect([antes.conectado, antes.loginRecusado]).toEqual([true, false]); // o CLI acha que está tudo certo
    ctl('mode', '401');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'oi' }).expect(201);
    const r = await resposta(p.id, c.id, 1);
    expect(r.status).toBe('ERRO');
    expect(r.content).toMatch(/recusou o login .*401 OAuth access token is invalid.*Reconecte em "Conexões"/);
    const depois = (await h.http().get('/api/accounts?atualizar=1')).body.find((x: any) => x.id === 'claude-code-cli');
    expect([depois.conectado, depois.loginRecusado]).toEqual([false, true]);
    expect(depois.problema).toMatch(/a IA recusou o login/);
    // Nova mensagem não chama a IA à toa: avisa que precisa reconectar.
    ctl('mode', 'texto');
    ctl('resposta.txt', '```json\n{"tipo":"resposta","texto":"oi de novo","memoria":[]}\n```');
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'de novo' }).expect(201);
    expect((await resposta(p.id, c.id, 2)).content).toMatch(/não está conectada: .*recusou o login/);

    // Reconectar pela tela (login oficial simulado) limpa a marca.
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-')), 'claude');
    fs.writeFileSync(fake, `#!/usr/bin/env bash
if [ "$1" = setup-token ]; then
  printf 'https://claude.com/cai/oauth/authorize?code=true&state=r\\n'
  read -r code; printf '\\n\\033[32m✓\\033[39m Long-lived authentication token created successfully!\\n\\nYour OAuth token (valid for 1 year):\\n\\nsk-ant-oat01-TOKENNOVODEPOISDERECUSA123\\n\\nStore this token securely. You will not be able to see it again.\\n\\nUse this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\\n'; exit 0
fi
exec ${process.env.NIVOO_CLAUDE_BIN} "$@"
`, { mode: 0o755 });
    const original = process.env.NIVOO_CLAUDE_BIN;
    process.env.NIVOO_CLAUDE_BIN = fake;
    try {
      // Token gerado mas recusado na conferência com a Anthropic: não diz "Conectado" nem salva.
      ctl('mode', '401');
      await h.http().post('/api/accounts/claude-code-cli/login').expect(201);
      await waitFor(async () => ((await h.http().get('/api/accounts/claude-code-cli/login')).body.state === 'aguardando_codigo' ? true : null), 15_000);
      await h.http().post('/api/accounts/claude-code-cli/login/code').send({ code: 'X' }).expect(201);
      const recusado = await waitFor(async () => {
        const st = (await h.http().get('/api/accounts/claude-code-cli/login')).body;
        return st.state === 'erro' ? st : null;
      }, 15_000);
      expect(recusado.message).toMatch(/A Anthropic recusou o token/);
      expect((await h.http().get('/api/accounts?atualizar=1')).body.find((x: any) => x.id === 'claude-code-cli').loginRecusado).toBe(true);
      ctl('mode', 'texto');
      await h.http().post('/api/accounts/claude-code-cli/login').expect(201);
      await waitFor(async () => ((await h.http().get('/api/accounts/claude-code-cli/login')).body.state === 'aguardando_codigo' ? true : null), 15_000);
      await h.http().post('/api/accounts/claude-code-cli/login/code').send({ code: 'X' }).expect(201);
      await waitFor(async () => ((await h.http().get('/api/accounts/claude-code-cli/login')).body.state === 'conectado' ? true : null), 15_000);
    } finally {
      process.env.NIVOO_CLAUDE_BIN = original;
    }
    const ok = (await h.http().get('/api/accounts?atualizar=1')).body.find((x: any) => x.id === 'claude-code-cli');
    expect([ok.conectado, ok.loginRecusado]).toEqual([true, false]);
    await h.http().post(`/api/projects/${p.id}/conversations/${c.id}/messages`).send({ content: 'agora vai' }).expect(201);
    expect((await resposta(p.id, c.id, 3)).status).toBe('PRONTA');
    ctl('mode', null);
  });
});
