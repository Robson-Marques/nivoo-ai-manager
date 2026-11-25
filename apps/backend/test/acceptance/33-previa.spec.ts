/**
 * Prévia do projeto: site estático servido direto; sistema com servidor ligado numa cópia da pasta principal, numa
 * porta livre, e entregue pelo portão da prévia (origem própria, cookie com código aleatório), inclusive WebSocket;
 * desligar desliga o processo; projeto sem nada para mostrar explica o que fazer.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } }).toString();

function pedir(url: string, cookie?: string): Promise<{ status: number; corpo: string; cabecalhos: http.IncomingHttpHeaders }> {
  return new Promise((ok, falha) => {
    const r = http.get(url, { headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) } }, (res) => {
      let corpo = '';
      res.on('data', (d) => (corpo += d));
      res.on('end', () => ok({ status: res.statusCode ?? 0, corpo, cabecalhos: res.headers }));
    });
    r.on('error', falha);
  });
}

describe('Prévia do projeto', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await truncateAll(h.prisma);
  });
  afterAll(async () => {
    await h.close();
  });

  const projetoCom = async (nome: string, arquivos: Record<string, string>) => {
    const p = (await h.http().post('/api/projects').send({ name: nome }).expect(201)).body;
    const repo = path.join(p.workspacePath, 'repo');
    for (const [rel, txt] of Object.entries(arquivos)) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), txt);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'arquivos');
    return p;
  };
  const noAr = (pid: string) =>
    waitFor(async () => {
      const e = (await h.http().get(`/api/projects/${pid}/previa`).expect(200)).body;
      return e.estado === 'no-ar' || e.estado === 'erro' ? e : null;
    }, 120_000);
  /** Abre como o navegador: o link entrega o cookie e redireciona. */
  const abrir = async (url: string) => {
    const r = await pedir(url);
    expect(r.status).toBe(302);
    const cookie = String(r.cabecalhos['set-cookie']?.[0] ?? '').split(';')[0];
    expect(cookie).toMatch(/^nivoo_previa=[a-f0-9]{48}$/);
    return { base: new URL(url).origin, cookie };
  };

  it('site estático: arquivos com caminho absoluto e rotas da página única funcionam; sem o código, fechada', async () => {
    const p = await projetoCom('Site', {
      'index.html': '<!doctype html><h1>Padaria Pão Bom</h1><script src="/assets/app.js"></script>',
      'assets/app.js': 'console.log("ok")',
    });
    await h.http().post(`/api/projects/${p.id}/previa/ligar`).expect(201);
    const e = await noAr(p.id);
    expect(e).toMatchObject({ estado: 'no-ar', tipo: 'estatico' });
    const { base, cookie } = await abrir(e.url);
    expect((await pedir(`${base}/`, cookie)).corpo).toContain('Padaria Pão Bom');
    const js = await pedir(`${base}/assets/app.js`, cookie);
    expect(js.status).toBe(200);
    expect(js.cabecalhos['content-type']).toMatch(/javascript/);
    expect((await pedir(`${base}/pedidos/12`, cookie)).corpo).toContain('Padaria Pão Bom'); // rota no navegador
    expect((await pedir(`${base}/../../etc/passwd`, cookie)).corpo).not.toContain('root:');
    const sem = await pedir(`${base}/`);
    expect(sem.status).toBe(404);
    expect(sem.corpo).toContain('Prévia fechada');
  });

  it('sistema com servidor: liga numa porta livre (cópia da main), responde pelo portão, WebSocket passa; desligar para tudo', async () => {
    const servidor = [
      "const http = require('http');",
      "const s = http.createServer((q, r) => r.end(q.url === '/api/pedidos' ? JSON.stringify({ pedidos: 3, porta: process.env.PORT }) : '<h1>Sistema da loja</h1>'));",
      "s.on('upgrade', (q, sock) => { sock.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n'); sock.on('data', (d) => sock.write('eco:' + d)); });",
      's.listen(process.env.PORT, "127.0.0.1");',
    ].join('\n');
    const p = await projetoCom('Sistema', { 'package.json': JSON.stringify({ name: 'loja', version: '1.0.0', scripts: { start: 'node server.js' } }), 'server.js': servidor });
    await h.http().post(`/api/projects/${p.id}/previa/ligar`).expect(201);
    const e = await noAr(p.id);
    expect(e).toMatchObject({ estado: 'no-ar', tipo: 'servidor', origem: 'package.json (script "start")' });
    const { base, cookie } = await abrir(e.url);
    expect((await pedir(`${base}/`, cookie)).corpo).toContain('Sistema da loja');
    const api = JSON.parse((await pedir(`${base}/api/pedidos`, cookie)).corpo);
    expect(api.pedidos).toBe(3);
    // WebSocket (chat ao vivo): a conexão é encaminhada inteira.
    const eco = await new Promise<string>((ok, falha) => {
      const u = new URL(base);
      const s = net.connect(Number(u.port), u.hostname, () => {
        s.write(`GET /ws HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`);
        setTimeout(() => s.write('oi'), 200);
      });
      let dados = '';
      s.on('data', (d) => {
        dados += d;
        if (dados.includes('eco:oi')) {
          s.destroy();
          ok(dados);
        }
      });
      s.on('error', falha);
      setTimeout(() => falha(new Error(`sem eco: ${dados}`)), 5000);
    });
    expect(eco).toContain('101');
    // A prévia roda numa cópia da pasta principal, não nela.
    expect(fs.existsSync(path.join(p.workspacePath, 'previa', 'server.js'))).toBe(true);
    await h.http().post(`/api/projects/${p.id}/previa/desligar`).expect(201);
    expect((await h.http().get(`/api/projects/${p.id}/previa`)).body.estado).toBe('parada');
    const porta = Number(api.porta);
    const livre = await waitFor(
      () => new Promise<boolean | null>((ok) => {
        const srv = net.createServer();
        srv.once('error', () => ok(null));
        srv.listen(porta, '127.0.0.1', () => srv.close(() => ok(true)));
      }),
      10_000,
    );
    expect(livre).toBe(true);
    expect((await pedir(`${base}/`, cookie)).status).toBe(404);
  });

  it('permite testar a versão pendente sem incorporá-la e não aceita trabalho de outro projeto', async () => {
    const p=await projetoCom('Avaliação de software',{'index.html':'<h1>Versão principal</h1>'});
    const outro=await projetoCom('Outro projeto',{'index.html':'<h1>Outro</h1>'});
    const base='/api/projects/'+p.id;
    h.worker.start();
    const j=(await h.http().post(base+'/jobs').send({
      title:'Nova interface',objective:'Disponibilizar a versão em avaliação',defaultProvider:'local-shell',
      steps:[{key:'a',instructions:"printf '<h1>Resultado em avaliação</h1>' > index.html"}],
      criteria:[{key:'html',kind:'COMMAND',description:'Resultado presente',config:{command:"grep -q 'Resultado em avaliação' index.html"}},
        {key:'aceite',kind:'MANUAL_APPROVAL',description:'Aceitar resultado funcional'}],
    }).expect(201)).body;
    await h.http().post(base+'/jobs/'+j.id+'/start').expect(201);
    await waitFor(async()=>{
      const state=(await h.http().get(base+'/jobs/'+j.id).expect(200)).body;
      return state.status==='AGUARDANDO_APROVACAO'?state:null;
    },60000);
    expect((await h.http().get(base+'/previa/fontes').expect(200)).body).toEqual(expect.arrayContaining([expect.objectContaining({id:j.id})]));
    await h.http().post('/api/projects/'+outro.id+'/previa/ligar').send({jobId:j.id}).expect(400);
    await h.http().post(base+'/previa/ligar').send({jobId:j.id}).expect(201);
    const e=await noAr(p.id);
    expect(e).toMatchObject({estado:'no-ar',sourceJobId:j.id});
    expect(e.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    const {base:origin,cookie}=await abrir(e.url);
    expect((await pedir(origin+'/',cookie)).corpo).toContain('Resultado em avaliação');
    expect(fs.readFileSync(path.join(p.workspacePath,'repo','index.html'),'utf8')).toContain('Versão principal');
    expect((await h.http().get(base+'/jobs/'+j.id).expect(200)).body.status).toBe('AGUARDANDO_APROVACAO');
    await h.http().post(base+'/previa/ligar').send({}).expect(201);
    const principal=await noAr(p.id);
    expect(principal).toMatchObject({estado:'no-ar',sourceJobId:null});
    const original=await abrir(principal.url);
    expect((await pedir(original.base+'/',original.cookie)).corpo).toContain('Versão principal');
    await h.http().post(base+'/previa/desligar').expect(201);
  });

  it('projeto sem nada para mostrar: explica o que fazer (nivoo-previa.json)', async () => {
    const p = await projetoCom('Vazio', { 'LEIAME.md': 'só texto' });
    await h.http().post(`/api/projects/${p.id}/previa/ligar`).expect(201);
    const e = await noAr(p.id);
    expect(e.estado).toBe('erro');
    expect(e.mensagem).toMatch(/nivoo-previa\.json/);
  });
  it('trabalho em andamento que vai criar a prévia: a mensagem explica que ela aparece quando ele concluir', async () => {
    const p = await projetoCom('Andamento', { 'LEIAME.md': 'só texto' });
    const j = (await h.http().post(`/api/projects/${p.id}/jobs`).send({ title: 'Criar a prévia', objective: 'x', steps: [{ key: 's', instructions: 'true' }], criteria: [{ key: 'c', description: 'c', kind: 'COMMAND', config: { command: 'true' } }] }).expect(201)).body;
    await h.prisma.job.update({ where: { id: j.id }, data: { status: 'EXECUTANDO' } });
    await h.http().post(`/api/projects/${p.id}/previa/ligar`).expect(201);
    const e = await noAr(p.id);
    expect(e.estado).toBe('erro');
    expect(e.trabalhoEmAndamento).toBe(true);
    expect(e.mensagem).toMatch(/O trabalho "Criar a prévia" está em andamento/);
  });
});
