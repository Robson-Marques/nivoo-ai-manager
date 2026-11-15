/**
 * Entrada protegida: com NIVOO_API_TOKEN ligado, entra quem mandar o token OU quem passou pelo login da
 * Cloudflare (Access). O JWT da Cloudflare só vale com assinatura das chaves da equipe configurada, a AUD
 * da aplicação e dentro da validade — cabeçalho forjado, vencido, de outra aplicação ou alterado é recusado.
 * As chaves públicas vêm de um servidor local que imita `https://<equipe>.cloudflareaccess.com/cdn-cgi/access/certs`.
 */
import { generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { createHarness, Harness } from '../support/harness';

const ISS = 'https://equipe-teste.cloudflareaccess.com';
const AUD = 'aud-da-aplicacao-nivoo-123';

function jwt(chave: KeyObject, corpo: Record<string, unknown>, cab: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }): string {
  const p1 = Buffer.from(JSON.stringify(cab)).toString('base64url');
  const p2 = Buffer.from(JSON.stringify(corpo)).toString('base64url');
  return `${p1}.${p2}.${sign('RSA-SHA256', Buffer.from(`${p1}.${p2}`), chave).toString('base64url')}`;
}

describe('Entrada: token do Nivoo ou login da Cloudflare (Access)', () => {
  let h: Harness;
  let certs: http.Server;
  const certo = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const outro = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let buscas = 0;
  beforeAll(async () => {
    certs = http.createServer((_req, res) => {
      buscas++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [{ ...certo.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }));
    });
    await new Promise<void>((ok) => certs.listen(0, '127.0.0.1', ok));
    process.env.NIVOO_API_TOKEN = 'token-secreto-do-teste-0123456789';
    process.env.NIVOO_CF_ACCESS_TEAM = 'equipe-teste';
    process.env.NIVOO_CF_ACCESS_AUD = AUD;
    process.env.NIVOO_CF_ACCESS_CERTS_URL = `http://127.0.0.1:${(certs.address() as AddressInfo).port}/cdn-cgi/access/certs`;
    h = await createHarness();
  });
  afterAll(async () => {
    for (const k of ['NIVOO_API_TOKEN', 'NIVOO_CF_ACCESS_TEAM', 'NIVOO_CF_ACCESS_AUD', 'NIVOO_CF_ACCESS_CERTS_URL']) delete process.env[k];
    await h.close();
    certs.close();
  });

  it('sem nada: 401; token do Nivoo: entra; JWT válido da Cloudflare: entra sem token; forjados: 401', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const valido = { iss: ISS, aud: [AUD], email: 'eu@exemplo.com', exp: agora + 3600, iat: agora, nbf: agora };
    const pedir = (headers: Record<string, string>) => {
      let r = h.http().get('/api/projects');
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      return r;
    };
    await h.http().get('/api/health').expect(200); // saúde continua aberta
    await pedir({}).expect(401);
    await pedir({ authorization: 'Bearer token-errado' }).expect(401);
    await pedir({ authorization: 'Bearer token-secreto-do-teste-0123456789' }).expect(200);
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, valido) }).expect(200);
    expect(buscas).toBe(1);
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, valido) }).expect(200);
    expect(buscas).toBe(1); // chaves em cache

    await pedir({ 'cf-access-jwt-assertion': jwt(outro.privateKey, valido) }).expect(401); // assinado por outra chave
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, { ...valido, aud: ['outra-aplicacao'] }) }).expect(401);
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, { ...valido, iss: 'https://outra-equipe.cloudflareaccess.com' }) }).expect(401);
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, { ...valido, exp: agora - 10 }) }).expect(401); // vencido
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, valido, { alg: 'none', kid: 'k1' }) }).expect(401);
    const [a, , c] = jwt(certo.privateKey, valido).split('.');
    const alterado = Buffer.from(JSON.stringify({ ...valido, email: 'intruso@x.com' })).toString('base64url');
    await pedir({ 'cf-access-jwt-assertion': `${a}.${alterado}.${c}` }).expect(401); // corpo alterado
    await pedir({ 'cf-access-jwt-assertion': 'lixo' }).expect(401);

    // Sem a configuração da Cloudflare no servidor, o cabeçalho não vale nada (só o token).
    delete process.env.NIVOO_CF_ACCESS_AUD;
    await pedir({ 'cf-access-jwt-assertion': jwt(certo.privateKey, valido) }).expect(401);
    process.env.NIVOO_CF_ACCESS_AUD = AUD;
  });
});
