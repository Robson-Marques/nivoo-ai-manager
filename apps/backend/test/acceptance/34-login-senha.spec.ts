/**
 * Login por usuário e senha (para servir num domínio próprio, sem o login da Cloudflare): com NIVOO_LOGIN_USUARIO/SENHA
 * ligados, a entrada exige autenticação; /api/login troca usuário+senha por um crachá de sessão assinado que o guard
 * aceita. Credenciais erradas, crachá forjado ou vencido não entram.
 */
import { createHarness, Harness } from '../support/harness';

describe('Entrada: login por usuário e senha', () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.NIVOO_LOGIN_USUARIO = 'robson';
    process.env.NIVOO_LOGIN_SENHA = 'senha-super-secreta-123';
    h = await createHarness();
  });
  afterAll(async () => {
    delete process.env.NIVOO_LOGIN_USUARIO;
    delete process.env.NIVOO_LOGIN_SENHA;
    await h.close();
  });

  it('login disponível no status; sem crachá 401; usuário/senha certos entram; errados e forjados não', async () => {
    // A tela pergunta o que o servidor oferece: login por senha ligado.
    expect((await h.http().get('/api/login/status').expect(200)).body).toMatchObject({ loginDisponivel: true });
    // Saúde e a rota de login são públicas; o resto exige entrar.
    await h.http().get('/api/health').expect(200);
    await h.http().get('/api/projects').expect(401);
    // Senha errada: 401 (e não diz qual campo errou).
    await h.http().post('/api/login').send({ usuario: 'robson', senha: 'errada' }).expect(401);
    await h.http().post('/api/login').send({ usuario: 'outro', senha: 'senha-super-secreta-123' }).expect(401);
    // Certo: devolve um crachá de sessão assinado.
    const { token } = (await h.http().post('/api/login').send({ usuario: 'robson', senha: 'senha-super-secreta-123' }).expect(201)).body;
    expect(token).toMatch(/^s1\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    // Com o crachá, entra; sem ou com crachá adulterado, 401.
    await h.http().get('/api/projects').set('authorization', `Bearer ${token}`).expect(200);
    await h.http().get('/api/projects').set('authorization', `Bearer ${token}x`).expect(401);
    await h.http().get('/api/projects').set('authorization', 'Bearer s1.abc.' + '0'.repeat(64)).expect(401);
  });

  it('sem login configurado no servidor, o status diz que não há login por senha', async () => {
    delete process.env.NIVOO_LOGIN_USUARIO;
    delete process.env.NIVOO_LOGIN_SENHA;
    expect((await h.http().get('/api/login/status').expect(200)).body).toMatchObject({ loginDisponivel: false });
    // Sem nenhuma proteção (sem token, sem login, sem Cloudflare): acesso aberto (local).
    await h.http().get('/api/projects').expect(200);
    process.env.NIVOO_LOGIN_USUARIO = 'robson';
    process.env.NIVOO_LOGIN_SENHA = 'senha-super-secreta-123';
  });
});
