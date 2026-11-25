import * as http from 'node:http';
import * as net from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { minimalEnv } from '../common/exec';

type Tamanho = 'computador' | 'celular';
const DIMENSOES = { computador: { width: 1366, height: 900 }, celular: { width: 390, height: 844 } };
export type ComandoPrevia =
  | { tipo: 'clique'; x: number; y: number }
  | { tipo: 'rolar'; x: number; y: number; dx: number; dy: number }
  | { tipo: 'tecla'; tecla: string }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'recarregar' }
  | { tipo: 'voltar' };

export function alvoPermitido(raw: string, porta: number): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'ws:') && !url.username && !url.password && url.hostname === '127.0.0.1' && url.port === String(porta);
  } catch { return false; }
}

/** The browser uses an explicit loopback proxy; redirects and CONNECT are checked too.
 * No HTTP destination other than the current project's port is forwarded. */
export async function proxyDoNavegador(porta: number) {
  const sockets = new Set<net.Socket>();
  const guardar = (s: net.Socket) => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => s.destroy()); };
  const host = '127.0.0.1:' + porta;
  const servidor = http.createServer((req, res) => {
    if (!alvoPermitido(req.url ?? '', porta)) { res.writeHead(403); res.end('Destino fora da prévia'); return; }
    const url = new URL(req.url!);
    const headers = { ...req.headers, host };
    delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const upstream = http.request({ hostname: '127.0.0.1', port: porta, path: url.pathname + url.search, method: req.method, headers }, r => {
      res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  servidor.on('connection', guardar);
  servidor.on('connect', (req, socket, head) => {
    const cliente = socket as net.Socket;
    if (req.url !== host) { cliente.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const destino = net.connect(porta, '127.0.0.1', () => {
      cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) destino.write(head);
      destino.pipe(cliente); cliente.pipe(destino);
    });
    guardar(destino); destino.on('error', () => cliente.destroy());
    cliente.on('close', () => destino.destroy()); destino.on('close', () => cliente.destroy());
  });
  servidor.on('upgrade', (req, socket, head) => {
    const cliente = socket as net.Socket;
    const raw = req.url ?? '';
    const url = raw.startsWith('/') && req.headers.host === host ? 'http://' + host + raw : raw;
    if (!alvoPermitido(url, porta) || String(req.headers.upgrade).toLowerCase() !== 'websocket') { cliente.destroy(); return; }
    const u = new URL(url);
    const destino = net.connect(porta, '127.0.0.1', () => {
      const headers = { ...req.headers, host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const linhas = ['GET ' + u.pathname + u.search + ' HTTP/1.1'];
      for (const [k,v] of Object.entries(headers)) for (const val of Array.isArray(v) ? v : [v]) if (val !== undefined) linhas.push(k + ': ' + val);
      destino.write(linhas.join('\r\n') + '\r\n\r\n');
      if (head.length) destino.write(head);
      destino.pipe(cliente); cliente.pipe(destino);
    });
    guardar(destino); destino.on('error', () => cliente.destroy());
    cliente.on('close', () => destino.destroy()); destino.on('close', () => cliente.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => { servidor.removeListener('error', reject); resolve(); });
  });
  return {
    url: 'http://127.0.0.1:' + (servidor.address() as net.AddressInfo).port,
    close: () => { for (const s of sockets) s.destroy(); servidor.close(); }
  };
}

export function validarComando(raw: unknown): ComandoPrevia {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Comando de prévia inválido.');
  const a = raw as Record<string, unknown>;
  const coord = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (a.tipo === 'clique' && coord(a.x) && coord(a.y)) return a as ComandoPrevia;
  if (a.tipo === 'rolar' && coord(a.x) && coord(a.y) && typeof a.dx === 'number' && typeof a.dy === 'number' && Number.isFinite(a.dx) && Number.isFinite(a.dy) && Math.abs(a.dx) <= 2000 && Math.abs(a.dy) <= 2000) return a as ComandoPrevia;
  if (a.tipo === 'texto' && typeof a.texto === 'string' && a.texto.length <= 4000) return a as ComandoPrevia;
  if (a.tipo === 'tecla' && typeof a.tecla === 'string' && /^(?:(?:Control|Meta|Shift|Alt)\+){0,3}(?:[a-zA-Z0-9]|Enter|Tab|Backspace|Delete|Escape|Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown|Space)$/.test(a.tecla)) return a as ComandoPrevia;
  if (a.tipo === 'recarregar' || a.tipo === 'voltar') return { tipo: a.tipo };
  throw new BadRequestException('Comando de prévia inválido.');
}

class Sessao {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  proxy?: Awaited<ReturnType<typeof proxyDoNavegador>>;
  ultimoUso = Date.now();
  private fechada = false;
  private fila: Promise<unknown> = Promise.resolve();
  private pendentes = 0;
  constructor(readonly porta: number, readonly caminho: string, readonly tamanho: Tamanho) {}
  async abrir() {
    try {
      this.proxy = await proxyDoNavegador(this.porta);
      if (this.fechada) throw new Error('Sessão encerrada.');
      this.browser = await chromium.launch({
        chromiumSandbox: true, timeout: 20000,
        env: minimalEnv(),
        proxy: { server: this.proxy.url, bypass: '<-loopback>' },
        args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      });
      if (this.fechada) throw new Error('Sessão encerrada.');
      this.context = await this.browser.newContext({
        viewport: DIMENSOES[this.tamanho], isMobile: this.tamanho === 'celular',
        hasTouch: this.tamanho === 'celular', deviceScaleFactor: 1,
        acceptDownloads: false, serviceWorkers: 'block',
      });
      await this.context.route('**/*', r => alvoPermitido(r.request().url(), this.porta) ? r.continue() : r.abort('blockedbyclient'));
      await this.context.routeWebSocket('**/*', ws => {
        if (alvoPermitido(ws.url(), this.porta)) ws.connectToServer(); else ws.close();
      });
      this.page = await this.context.newPage();
      this.page.on('popup', popup => void popup.close().catch(() => undefined));
      this.page.on('dialog', dialog => void dialog.dismiss().catch(() => undefined));
      const base = 'http://127.0.0.1:' + this.porta;
      const url = new URL(this.caminho, base);
      if (url.origin !== base) throw new Error('Rota inicial inválida.');
      const resposta = await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (resposta && resposta.status() >= 400) throw new Error('Página inicial respondeu HTTP ' + resposta.status());
      if (this.fechada) throw new Error('Sessão encerrada.');
    } catch (e) { await this.fechar(); throw e; }
  }
  executar<T>(fn: (p: Page) => Promise<T>): Promise<T> {
    if (this.fechada || !this.page) throw new ConflictException('Visualizador encerrado. Reabra a prévia.');
    if (this.pendentes >= 8) throw new ConflictException('Aguarde o visualizador processar a interação anterior.');
    this.ultimoUso = Date.now();
    this.pendentes++;
    const r = this.fila.then(() => {
      if (this.fechada || !this.page) throw new ConflictException('Visualizador encerrado.');
      return fn(this.page);
    });
    this.fila = r.catch(() => undefined);
    return r.finally(() => { this.pendentes--; this.ultimoUso = Date.now(); });
  }
  quadro() { return this.executar(p => p.screenshot({ type: 'jpeg', quality: 78, timeout: 8000 })); }
  acao(a: ComandoPrevia) {
    return this.executar(async p => {
      const v = DIMENSOES[this.tamanho];
      if (a.tipo === 'clique') {
        const x = Math.min(v.width - 1, a.x * v.width), y = Math.min(v.height - 1, a.y * v.height);
        if (this.tamanho === 'celular') await p.touchscreen.tap(x,y); else await p.mouse.click(x,y);
      }
      else if (a.tipo === 'rolar') { await p.mouse.move(a.x * v.width, a.y * v.height); await p.mouse.wheel(a.dx, a.dy); }
      else if (a.tipo === 'texto') await p.keyboard.insertText(a.texto);
      else if (a.tipo === 'tecla') await p.keyboard.press(a.tecla);
      else if (a.tipo === 'recarregar') await p.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      else if (a.tipo === 'voltar') await p.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
    });
  }
  async fechar() {
    this.fechada = true;
    try { await this.browser?.close(); } catch { /* processo já saiu */ }
    finally { this.proxy?.close(); }
  }
}

interface Entrada { sessao: Sessao; pronta: Promise<void>; projeto: string; geracao: string; }
export class VisualizadoresPrevia {
  private entradas = new Map<string, Entrada>();
  async quadro(projeto: string, geracao: string, porta: number, caminho: string, id: string, tamanho: Tamanho) {
    const chave = projeto + ':' + id;
    let e = this.entradas.get(chave);
    if (e && (e.geracao !== geracao || e.sessao.tamanho !== tamanho)) {
      this.entradas.delete(chave); await e.sessao.fechar(); e = undefined;
    }
    if (!e) {
      if (this.entradas.size >= 4) throw new ConflictException('Há quatro visualizadores abertos. Feche um para continuar.');
      const sessao = new Sessao(porta, caminho, tamanho);
      const pronta = sessao.abrir();
      e = { sessao, pronta, projeto, geracao };
      this.entradas.set(chave, e);
    }
    try { await e.pronta; return await e.sessao.quadro(); }
    catch (err) {
      if (this.entradas.get(chave) === e) this.entradas.delete(chave);
      await e.sessao.fechar();
      throw new BadRequestException('Não consegui abrir ou capturar a prévia no Chromium: ' + String((err as Error)?.message ?? err).split('\n')[0].slice(0, 350));
    }
  }
  async acao(projeto: string, geracao: string, id: string, comando: unknown) {
    const e = this.entradas.get(projeto + ':' + id);
    if (!e || e.geracao !== geracao) throw new ConflictException('Visualizador ainda não conectado.');
    await e.pronta; await e.sessao.acao(validarComando(comando));
  }
  async fechar(projeto: string, id?: string) {
    const encontrados = [...this.entradas].filter(([k,e]) => e.projeto === projeto && (!id || k === projeto + ':' + id));
    for (const [k] of encontrados) this.entradas.delete(k);
    await Promise.all(encontrados.map(([,e]) => e.sessao.fechar()));
  }
  async limpar() {
    const vencidas = [...this.entradas].filter(([,e]) => Date.now() - e.sessao.ultimoUso > 90000);
    for (const [k] of vencidas) this.entradas.delete(k);
    await Promise.all(vencidas.map(([,e]) => e.sessao.fechar()));
  }
}
