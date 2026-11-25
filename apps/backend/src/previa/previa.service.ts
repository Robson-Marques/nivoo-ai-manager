import { randomBytes } from 'node:crypto';
import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { descartarBancoDeTeste, prepararBancoDeTeste } from '../common/banco-de-teste';
import { ambienteDaConferencia, portaLivre, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { modoCaminho, baseSessao, separarCaminho, caminhoPublico, headersCaminho, headersProjeto, headersRespostaProjeto } from './previa-path';

/**
 * Prévia do projeto: o site ou o sistema do projeto rodando, para o usuário ver ao lado da conversa.
 *
 * - Site (index.html): servido direto da pasta.
 * - Sistema com servidor: numa cópia da pasta principal (<projeto>/previa), instala as dependências e liga o comando
 *   do projeto numa porta livre, com um banco de teste próprio. Desliga sozinho depois de 2 h sem uso.
 *
 * O "portão" da prévia é um servidor HTTP em porta própria (NIVOO_PREVIA_PORT, padrão 3100, só 127.0.0.1), publicado
 * num endereço PRÓPRIO (NIVOO_PREVIA_URL, ex.: https://previa-nivoo.empresa.com.br pelo túnel da Cloudflare). Origem
 * separada do Nivoo: o sistema do projeto roda na raiz (rotas e telas funcionam) e o código dele não alcança o token do
 * Nivoo. O acesso é por um código aleatório (cookie), entregue pelo Nivoo.
 *
 * Como rodar: nivoo-previa.json na raiz do projeto ({"tipo":"servidor"|"estatico","pasta":"…","instalar":"…",
 * "comando":"… usando $PORT","caminho":"/"}) ou detecção (index.html; package.json com start/dev).
 */
export interface ComoRodar {
  tipo: 'estatico' | 'servidor';
  pasta: string;
  instalar?: string;
  comando?: string;
  caminho: string;
  origem: string;
  /** The upstream server understands the session prefix (e.g. Vite --base). */
  manterPrefixo?: boolean;
}

type Estado = 'parada' | 'ligando' | 'no-ar' | 'erro';

interface Previa {
  projectId: string;
  token: string;
  estado: Estado;
  mensagem: string;
  como?: ComoRodar;
  porta?: number;
  processo?: ChildProcess;
  dir?: string;
  log: string;
  ultimoUso: number;
  ligadaEm?: Date;
  trabalhoEmAndamento?: boolean;
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

/** HTTPS embeds need a cookie that is accepted in cross-site contexts.
 * Keep it host-only and HttpOnly; never move the project to the origin of the manager. */
export function cookieDaPrevia(token: string, https: boolean): string {
  return `nivoo_previa=${token}; Path=/; HttpOnly; ${https ? 'SameSite=None; Secure' : 'SameSite=Lax'}`;
}
export function caminhoDaPrevia(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw)) return '/';
  return raw;
}

const OCIOSA_MS = Number(process.env.NIVOO_PREVIA_OCIOSA_MIN ?? 120) * 60_000;

@Injectable()
export class PreviaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Previa');
  private readonly previas = new Map<string, Previa>();
  private portao?: http.Server;
  private porta = 0;
  private faxina?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NIVOO_PREVIA_DESLIGADA === '1') return;
    this.portao = http.createServer((req, res) => void this.atender(req, res));
    this.portao.on('upgrade', (req, socket, cabeca) => this.atenderUpgrade(req, socket as net.Socket, cabeca));
    const pedida = Number(process.env.NIVOO_PREVIA_PORT ?? 3100);
    await new Promise<void>((ok) => {
      this.portao!.once('error', (e) => {
        this.logger.warn(`portão da prévia não abriu na porta ${pedida}: ${e.message}`);
        this.portao = undefined;
        ok();
      });
      this.portao!.listen(pedida, '127.0.0.1', () => {
        this.porta = (this.portao!.address() as net.AddressInfo).port;
        ok();
      });
    });
    this.faxina = setInterval(() => void this.desligarOciosas(), 60_000);
    this.faxina.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.faxina) clearInterval(this.faxina);
    for (const p of this.previas.values()) await this.parar(p).catch(() => undefined);
    await new Promise<void>((ok) => (this.portao ? this.portao.close(() => ok()) : ok()));
  }

  /** Porta do portão (testes). */
  portaDoPortao(): number {
    return this.porta;
  }

  private urlPublica(): string {
    return (process.env.NIVOO_PREVIA_URL ?? `http://localhost:${this.porta}`).replace(/\/+$/, '');
  }

  private async repoDo(projectId: string): Promise<string> {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { dirKey: true } });
    if (!p) throw new BadRequestException('Projeto não encontrado');
    return this.workspace.projectDirs(p.dirKey).repo;
  }

  /** Como rodar o projeto (arquivo nivoo-previa.json ou detecção). Null se não há nada para mostrar. */
  static comoRodar(dir: string, base?:string): ComoRodar | null {
    const cfgArq = path.join(dir, 'nivoo-previa.json');
    if (fs.existsSync(cfgArq)) {
      let c: any;
      try {
        c = JSON.parse(fs.readFileSync(cfgArq, 'utf8'));
      } catch {
        throw new BadRequestException('nivoo-previa.json inválido (não é JSON)');
      }
      const pasta = String(c.pasta ?? '.').replace(/^\/+/, '') || '.';
      const tipo = c.tipo === 'estatico' || (!c.comando && c.tipo !== 'servidor') ? 'estatico' : 'servidor';
      return { tipo, pasta, instalar: c.instalar ? String(c.instalar) : undefined, comando: c.comando ? String(c.comando) : undefined, caminho: String(c.caminho ?? '/'), origem: 'nivoo-previa.json', manterPrefixo: !!base && c.manterPrefixo === true };
    }
    const pacote = path.join(dir, 'package.json');
    if (fs.existsSync(pacote)) {
      let pj: any = {};
      try {
        pj = JSON.parse(fs.readFileSync(pacote, 'utf8'));
      } catch {
        /* package.json quebrado: segue para o site estático */
      }
      const scripts = pj.scripts ?? {};
      const nome = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
      if (nome) {
        const s = String(scripts[nome]);
        // Servidores de desenvolvimento que não leem $PORT: a porta vai como argumento.
        const vite = /\bvite\b/.test(s);
        const extra = vite ? ' -- --port $PORT --host 127.0.0.1 --strictPort' + (base ? ' --base '+base : '') : /\bnext\b/.test(s) ? ' -- -p $PORT -H 127.0.0.1' : '';
        const gerenciador = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
        const instalar = gerenciador === 'pnpm' ? 'pnpm install --frozen-lockfile || pnpm install' : gerenciador === 'yarn' ? 'yarn install' : fs.existsSync(path.join(dir, 'package-lock.json')) ? 'npm ci || npm install' : 'npm install';
        return { tipo: 'servidor', pasta: '.', instalar, comando: `${gerenciador} run ${nome}${extra}`, caminho: '/', origem: `package.json (script "${nome}")`, manterPrefixo: !!base && vite };
      }
    }
    for (const pasta of ['.', 'public', 'dist', 'build', 'site', 'docs', 'www']) {
      if (fs.existsSync(path.join(dir, pasta, 'index.html'))) return { tipo: 'estatico', pasta, caminho: '/', origem: `${pasta === '.' ? '' : `${pasta}/`}index.html` };
    }
    return null;
  }

  estado(projectId: string) {
    const p = this.previas.get(projectId);
    if (!p) return { estado: 'parada' as Estado, mensagem: '', url: null, log: '' };
    p.ultimoUso = Date.now();
    return {
      estado: p.estado,
      mensagem: p.mensagem,
      tipo: p.como?.tipo ?? null,
      origem: p.como?.origem ?? null,
      url: p.estado === 'no-ar' ? (modoCaminho() ? caminhoPublico(baseSessao(p.token),p.como?.caminho??'/') : `${this.urlPublica()}/__nivoo_previa/abrir?t=${p.token}&caminho=${encodeURIComponent(p.como?.caminho ?? '/')}`) : null,
      modoCaminho: modoCaminho(),
      enderecoConfigurado: !!process.env.NIVOO_PREVIA_URL,
      trabalhoEmAndamento: !!p.trabalhoEmAndamento,
      ligadaEm: p.ligadaEm ?? null,
      log: p.log.slice(-6000),
    };
  }

  /** Liga (ou religa, com a última versão da pasta principal). Volta logo; o estado diz quando está no ar. */
  async ligar(projectId: string) {
    if (!this.portao) throw new BadRequestException('A prévia está desligada neste servidor (portão não abriu; veja os logs da API)');
    const antiga = this.previas.get(projectId);
    if (antiga) await this.parar(antiga);
    const p: Previa = { projectId, token: randomBytes(24).toString('hex'), estado: 'ligando', mensagem: 'preparando a cópia do projeto', log: '', ultimoUso: Date.now() };
    this.previas.set(projectId, p);
    void this.subir(p).catch((e) => {
      p.estado = 'erro';
      p.mensagem = String(e?.message ?? e).slice(0, 1000);
    });
    return this.estado(projectId);
  }

  async desligar(projectId: string) {
    const p = this.previas.get(projectId);
    if (p) await this.parar(p);
    this.previas.delete(projectId);
    return this.estado(projectId);
  }

  private registrar(p: Previa, texto: string) {
    p.log = `${p.log}${texto}`.slice(-200_000);
  }

  private async subir(p: Previa): Promise<void> {
    const repo = await this.repoDo(p.projectId);
    // Cópia da pasta principal só para a prévia (o trabalho da IA nunca roda aqui).
    const dir = path.join(path.dirname(repo), 'previa');
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.rmSync(dir, { recursive: true, force: true });
      await this.git(repo, ['worktree', 'prune']);
      const r = await this.git(repo, ['worktree', 'add', '--detach', '--force', dir, 'main']);
      if (r.exitCode !== 0) throw new Error(`não consegui copiar o projeto: ${r.stderr.trim().slice(0, 300)}`);
    } else {
      await this.git(dir, ['checkout', '--detach', '--force', 'main']);
      await this.git(dir, ['reset', '--hard', 'main']);
      await this.git(dir, ['clean', '-fdx', '-e', 'node_modules', '-e', '.venv']); // dependências ficam (mais rápido)
    }
    p.dir = dir;
    const como = PreviaService.comoRodar(dir,modoCaminho()?baseSessao(p.token):undefined);
    if (!como) {
      // A prévia mostra a PASTA PRINCIPAL: se um trabalho em andamento vai criar a prévia, ela só aparece quando ele concluir.
      const rodando = await this.prisma.job.findFirst({ where: { projectId: p.projectId, status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO'] } }, select: { title: true } });
      p.trabalhoEmAndamento = !!rodando;
      throw new Error(
        rodando
          ? `a prévia mostra a pasta principal do projeto, que ainda não tem como ligar o sistema. O trabalho "${rodando.title}" está em andamento: o que ele faz (inclusive a prévia, se estiver no plano) entra na pasta principal quando ele concluir. Depois, clique em "Ligar a prévia".`
          : 'não achei o que mostrar: o projeto não tem index.html nem package.json com "dev"/"start". Peça à IA para criar o nivoo-previa.json (como ligar o sistema).',
      );
    }
    p.como = como;
    const pastaAbs = resolveInside(dir, como.pasta);
    if (como.tipo === 'estatico') {
      p.estado = 'no-ar';
      p.mensagem = `site estático (${como.origem})`;
      p.ligadaEm = new Date();
      return;
    }
    p.porta = await portaLivre();
    const banco = await prepararBancoDeTeste(p.projectId, this.nomeDoBanco(p.projectId)).catch(() => null);
    const env = ambienteDaConferencia({ PORT: String(p.porta), HOST: '127.0.0.1', NIVOO_PORTA_TESTE: String(p.porta), NODE_ENV: 'development', ...(modoCaminho()?{NIVOO_PREVIA_BASE_PATH:baseSessao(p.token)}:{}), ...(banco?.env ?? {}) });
    delete env.CI; // prévia não é teste
    if (como.instalar) {
      p.mensagem = `instalando as dependências (${como.instalar})`;
      const r = await runProcess('bash', ['-o', 'pipefail', '-c', como.instalar], { cwd: pastaAbs, env, timeoutMs: 15 * 60_000, maxBuffer: 5 * 1024 * 1024, encerrarGrupoAoSair: true });
      this.registrar(p, `$ ${como.instalar}\n${r.stdout}${r.stderr}\n`);
      if (r.exitCode !== 0) throw new Error(`a instalação das dependências falhou (exit ${r.exitCode}); veja o registro abaixo`);
    }
    p.mensagem = `ligando o sistema (${como.comando})`;
    this.registrar(p, `$ ${como.comando}\n`);
    const filho = spawn('bash', ['-c', como.comando!], { cwd: pastaAbs, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    p.processo = filho;
    filho.stdout?.on('data', (d) => this.registrar(p, String(d)));
    filho.stderr?.on('data', (d) => this.registrar(p, String(d)));
    let saiu: number | null | undefined;
    filho.on('error', (err) => {
      saiu = null;
      this.registrar(p, `\nFalha ao iniciar processo: ${err.message}\n`);
      if (p.estado !== 'parada') { p.estado = 'erro'; p.mensagem = `Não consegui iniciar o processo: ${err.message}`; }
    });
    filho.on('exit', (code) => {
      saiu = code;
      if (p.estado !== 'parada') {
        p.estado = 'erro';
        p.mensagem = `o sistema parou (código ${code}); veja o registro abaixo`;
      }
    });
    const esperaSeg = Number(process.env.NIVOO_PREVIA_ESPERA_SEG ?? 180);
    const limite = Date.now() + esperaSeg * 1000;
    while (Date.now() < limite) {
      if (saiu !== undefined) throw new Error(`o sistema parou antes de responder (código ${saiu}); veja o registro abaixo`);
      if (await this.responde(p.porta)) {
        p.estado = 'no-ar';
        p.mensagem = `sistema no ar (${como.origem})`;
        p.ligadaEm = new Date();
        return;
      }
      await new Promise((ok) => setTimeout(ok, 700));
    }
    throw new Error(`o sistema não respondeu na porta ${p.porta} em ${esperaSeg} s. Ele precisa ouvir na porta $PORT; se não ouve, peça à IA para ajustar o nivoo-previa.json`);
  }

  private nomeDoBanco(projectId: string): string {
    return `previa_${projectId.replace(/[^a-f0-9]/gi, '').slice(0, 20).toLowerCase()}`;
  }

  private responde(porta: number): Promise<boolean> {
    return new Promise((ok) => {
      const r = http.get({ host: '127.0.0.1', port: porta, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        ok(true);
      });
      r.on('error', () => ok(false));
      r.on('timeout', () => {
        r.destroy();
        ok(false);
      });
    });
  }

  private async parar(p: Previa): Promise<void> {
    p.estado = 'parada';
    if (p.processo?.pid) {
      try {
        process.kill(-p.processo.pid, 'SIGTERM');
      } catch {
        /* já parou */
      }
      const pid = p.processo.pid;
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* já parou */
        }
      }, 3000).unref();
    }
    p.processo = undefined;
    if (p.como?.tipo === 'servidor') await descartarBancoDeTeste(p.projectId, this.nomeDoBanco(p.projectId));
  }

  private async desligarOciosas(): Promise<void> {
    for (const p of [...this.previas.values()]) {
      if (Date.now() - p.ultimoUso > OCIOSA_MS) await this.desligar(p.projectId).catch(() => undefined);
    }
  }

  private git(cwd: string, args: string[]) {
    return runProcess('git', ['-c', 'safe.directory=*', ...args], { cwd, env: ambienteDaConferencia(), timeoutMs: 120_000 });
  }

  /** Mounted before the administrative SPA/API parsers, only when path mode is configured. */
  async atenderCaminho(req:http.IncomingMessage,res:http.ServerResponse):Promise<void>{
    if(!modoCaminho())return this.pagina(res,404,'Prévia por caminho desativada.');
    const route=separarCaminho(req.url??'');
    if(!route)return this.pagina(res,404,'Abra a prévia pelo botão Ver o projeto no Nivoo.');
    const p=[...this.previas.values()].find(x=>x.token===route.token&&x.estado==='no-ar');
    if(!p)return this.pagina(res,404,'Esta sessão de prévia não está mais no ar.');
    if(!headersCaminho(res,req,route.base))return this.pagina(res,400,'Endereço de prévia inválido.');
    p.ultimoUso=Date.now();
    if(req.method==='OPTIONS'){res.writeHead(204);return void res.end();}
    try{
      if(p.como?.tipo==='estatico'){
        if(req.method!=='GET'&&req.method!=='HEAD')return this.pagina(res,405,'Método indisponível para site estático.');
        return this.servirArquivo(p,new URL(route.local,'http://previa').pathname,req,res,true);
      }
      const upstream=p.como?.manterPrefixo?(req.url??'/'):route.local;
      const destino=http.request({host:'127.0.0.1',port:p.porta,method:req.method,path:upstream,headers:{...headersProjeto(req),host:`127.0.0.1:${p.porta}`}},r=>{
        const h=headersRespostaProjeto(r.headers);
        if(r.headers.location){
          // Only redirects within the preview; never redirect to the manager or another origin.
          const loc=r.headers.location;
          if(!loc.startsWith('/')||loc.startsWith('//')||/[\\\r\n]/.test(loc)){r.resume();return this.pagina(res,502,'Redirecionamento externo não permitido na prévia por caminho.');}
          if(loc.startsWith(route.base))h.location=loc;
          else h.location=caminhoPublico(route.base,loc);
        }
        res.writeHead(r.statusCode??502,h);r.pipe(res);
      });
      destino.on('error',e=>this.pagina(res,502,'O sistema da prévia não respondeu: '+e.message));
      req.on('aborted',()=>destino.destroy());
      req.pipe(destino);
    }catch(e:any){this.pagina(res,500,'Erro na prévia: '+String(e?.message??e));}
  }

  atenderUpgradeCaminho(req:http.IncomingMessage,socket:net.Socket,cabeca:Buffer){
    const route=modoCaminho()?separarCaminho(req.url??''):null;
    const p=route&&[...this.previas.values()].find(x=>x.token===route.token&&x.estado==='no-ar');
    if(!route||!p||!p.porta||p.como?.tipo!=='servidor')return void socket.destroy();
    p.ultimoUso=Date.now();
    const alvo=net.connect(p.porta,'127.0.0.1',()=>{
      const h=headersProjeto(req);h.host=`127.0.0.1:${p.porta}`;
      const linhas=[`${req.method} ${p.como?.manterPrefixo?req.url:route.local} HTTP/${req.httpVersion}`];
      for(const [k,v] of Object.entries(h))for(const x of Array.isArray(v)?v:[v])if(x!==undefined)linhas.push(`${k}: ${x}`);
      alvo.write(linhas.join('\r\n')+'\r\n\r\n');
      if(cabeca.length)alvo.write(cabeca);
      alvo.pipe(socket);socket.pipe(alvo);
    });
    alvo.on('error',()=>socket.destroy());socket.on('error',()=>alvo.destroy());
  }

  // ---------------- portão ----------------

  private porCookie(req: http.IncomingMessage): Previa | null {
    const cookies = String(req.headers.cookie ?? '').split(';').map(c => c.trim());
    // Prefer the partitioned session when supplied; never fall back to a different project.
    const selected = cookies.find(c => /^nivoo_previa_part=[a-f0-9]{48}$/.test(c)) ?? cookies.find(c => /^nivoo_previa=[a-f0-9]{48}$/.test(c));
    if (!selected) return null;
    const token=selected.split('=')[1];
    for (const p of this.previas.values()) if (p.token===token && p.estado==='no-ar') return p;
    return null;
  }

  private async atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://previa');
      if (url.pathname === '/__nivoo_previa/abrir') {
        const t = url.searchParams.get('t') ?? '';
        const p = [...this.previas.values()].find((x) => x.token === t && x.estado === 'no-ar');
        if (!p) return this.pagina(res, 404, 'Esta prévia não está mais no ar. Ligue de novo pelo Nivoo.');
        const seguro = this.urlPublica().startsWith('https://') || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
        res.writeHead(302, {
          'Set-Cookie': [cookieDaPrevia(t, seguro), ...(seguro ? [`nivoo_previa_part=${t}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned`] : [])],
          Location: caminhoDaPrevia(url.searchParams.get('caminho')),
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'no-store',
        });
        return void res.end();
      }
      const p = this.porCookie(req);
      if (!p) return this.pagina(res, 404, 'Prévia fechada. Abra a prévia pelo Nivoo (botão "Ver o projeto"). Se já estiver no ar, use "nova aba" no painel da prévia: o navegador pode ter bloqueado o cookie do quadro incorporado.');
      p.ultimoUso = Date.now();
      if (p.como?.tipo === 'estatico') return this.servirArquivo(p, url.pathname, req, res);
      return this.encaminhar(p, req, res);
    } catch (e: any) {
      this.pagina(res, 500, `Erro na prévia: ${e?.message ?? e}`);
    }
  }

  private pagina(res: http.ServerResponse, status: number, texto: string) {
    if (res.headersSent) return void res.end();
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Prévia</title><body style="font-family:system-ui;padding:24px;color:#333">${texto.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</body>`);
  }

  private servirArquivo(p: Previa, caminho: string, req: http.IncomingMessage, res: http.ServerResponse, caminhoIsolado=false) {
    const base = resolveInside(p.dir!, p.como!.pasta);
    let rel = decodeURIComponent(caminho).replace(/^\/+/, '');
    let arq: string;
    try {
      arq = rel ? resolveInside(base, rel) : base;
    } catch {
      return this.pagina(res, 404, 'Arquivo fora da pasta do site.');
    }
    if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, 'index.html');
    if (!fs.existsSync(arq)) {
      // Site de uma página só (rotas no navegador): o que não é arquivo cai no index.html.
      const querHtml = String(req.headers.accept ?? '').includes('text/html');
      if (!querHtml || path.extname(rel)) return this.pagina(res, 404, `Não encontrado: /${rel}`);
      arq = path.join(base, 'index.html');
      rel = 'index.html';
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': caminhoIsolado?'no-store':'no-cache' });
    if(req.method==='HEAD')return void res.end();
    fs.createReadStream(arq).pipe(res);
  }

  private semNossoCookie(cabecalhos: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const h: http.OutgoingHttpHeaders = { ...cabecalhos };
    const c = String(h.cookie ?? '').split(/;\s*/).filter((x) => x && !x.startsWith('nivoo_previa=') && !x.startsWith('nivoo_previa_part=')).join('; ');
    if (c) h.cookie = c;
    else delete h.cookie;
    return h;
  }

  private encaminhar(p: Previa, req: http.IncomingMessage, res: http.ServerResponse) {
    const destino = http.request(
      { host: '127.0.0.1', port: p.porta, method: req.method, path: req.url, headers: { ...this.semNossoCookie(req.headers), host: `127.0.0.1:${p.porta}` } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    destino.on('error', (e) => this.pagina(res, 502, `O sistema da prévia não respondeu: ${e.message}`));
    req.pipe(destino);
  }

  /** WebSocket e afins (chat ao vivo, recarga automática): encaminha a conexão inteira. */
  private atenderUpgrade(req: http.IncomingMessage, socket: net.Socket, cabeca: Buffer) {
    const p = this.porCookie(req);
    if (!p || p.como?.tipo !== 'servidor' || !p.porta) return void socket.destroy();
    p.ultimoUso = Date.now();
    const alvo = net.connect(p.porta, '127.0.0.1', () => {
      const h = this.semNossoCookie(req.headers);
      h.host = `127.0.0.1:${p.porta}`;
      const linhas = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (const [k, v] of Object.entries(h)) for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined) linhas.push(`${k}: ${x}`);
      alvo.write(`${linhas.join('\r\n')}\r\n\r\n`);
      if (cabeca?.length) alvo.write(cabeca);
      alvo.pipe(socket);
      socket.pipe(alvo);
    });
    alvo.on('error', () => socket.destroy());
    socket.on('error', () => alvo.destroy());
  }
}
