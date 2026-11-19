const TOKEN_KEY = 'nivoo_api_token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* sem storage */
  }
}

/**
 * Servidor com acesso protegido (NIVOO_API_TOKEN) e sem o login da Cloudflare configurado: a tela de
 * entrada (TelaDeEntrada) pede o token UMA vez e ele fica guardado neste navegador. Vários pedidos ao mesmo
 * tempo esperam a mesma entrada (nunca uma pergunta atrás da outra).
 */
type Ouvinte = (pedindo: boolean, erro?: string) => void;
const ouvintes = new Set<Ouvinte>();
let entrada: { promessa: Promise<boolean>; resolver: (ok: boolean) => void } | null = null;

export function ouvirEntrada(f: Ouvinte): () => void {
  ouvintes.add(f);
  if (entrada) f(true);
  return () => ouvintes.delete(f);
}

function pedirToken(): Promise<boolean> {
  if (!entrada) {
    let resolver!: (ok: boolean) => void;
    const promessa = new Promise<boolean>((r) => (resolver = r));
    entrada = { promessa, resolver };
    ouvintes.forEach((f) => f(true));
  }
  return entrada.promessa;
}

/** Chamado pela tela de entrada: confere o token no servidor antes de guardar. */
export async function entrarComToken(t: string): Promise<boolean> {
  const res = await fetch('/api/system/workers', { headers: { authorization: `Bearer ${t.trim()}` } });
  if (!res.ok) {
    ouvintes.forEach((f) => f(true, 'Token não confere. Copie de novo a linha NIVOO_API_TOKEN do servidor.'));
    return false;
  }
  setToken(t.trim());
  const e = entrada;
  entrada = null;
  ouvintes.forEach((f) => f(false));
  e?.resolver(true);
  return true;
}

/** O que o servidor oferece para entrar (login por senha, Cloudflare). A tela de entrada decide o que mostrar. */
export async function statusDeEntrada(): Promise<{ loginDisponivel: boolean; cloudflare: boolean }> {
  try {
    const res = await fetch('/api/login/status');
    return res.ok ? await res.json() : { loginDisponivel: false, cloudflare: false };
  } catch {
    return { loginDisponivel: false, cloudflare: false };
  }
}

/** Entra com usuário e senha (domínio próprio, sem Cloudflare): troca por um crachá de sessão. */
export async function entrarComLogin(usuario: string, senha: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario, senha }) });
  } catch {
    ouvintes.forEach((f) => f(true, 'Sem resposta do servidor.'));
    return false;
  }
  if (!res.ok) {
    let m = 'Usuário ou senha incorretos.';
    try {
      const d = await res.json();
      m = (Array.isArray(d?.message) ? d.message.join('; ') : d?.message) ?? m;
    } catch {
      /* corpo não-JSON */
    }
    ouvintes.forEach((f) => f(true, m));
    return false;
  }
  const { token } = await res.json();
  setToken(String(token ?? ''));
  const e = entrada;
  entrada = null;
  ouvintes.forEach((f) => f(false));
  e?.resolver(true);
  return true;
}

/**
 * 401: se o token mudou enquanto o pedido ia (o usuário acabou de entrar), tenta de novo com o novo, sem
 * pedir outra vez; só pede quando o token recusado é o atual.
 */
async function renovar(usado: string | null): Promise<boolean> {
  const atual = getToken();
  if (atual && atual !== usado) return true;
  return pedirToken();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const ir = async () => {
    try {
      return await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      // Sem resposta (servidor fora do ar, ou o acesso da Cloudflare expirou e redirecionou para o login dela).
      throw new ApiError(0, 'Sem resposta do servidor. Se você entra pela Cloudflare, recarregue a página para entrar de novo.');
    }
  };
  let res = await ir();
  if (res.status === 401 && (await renovar(token))) {
    headers.authorization = `Bearer ${getToken()}`;
    res = await ir();
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Página de erro em HTML (ex.: 502 da Cloudflare com o servidor parado).
    if (!res.ok) throw new ApiError(res.status, `O servidor respondeu ${res.status} ${res.statusText || ''}`.trim() + (res.status >= 500 ? ' (o Nivoo pode estar reiniciando; tente de novo em instantes).' : '.'));
    throw new ApiError(res.status, 'Resposta inesperada do servidor.');
  }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** Variante para áudio/imagem binários protegidos pelo mesmo login da API. */
export async function apiBlob(path: string, method = 'GET', body?: unknown): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const ir = () => fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let res: Response;
  try {
    res = await ir();
    if (res.status === 401 && (await renovar(token))) {
      headers.authorization = `Bearer ${getToken()}`;
      res = await ir();
    }
  } catch {
    throw new ApiError(0, 'Sem resposta do servidor.');
  }
  if (!res.ok) {
    let msg = res.statusText || `Erro ${res.status}`;
    try {
      const data = await res.json();
      msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? msg;
    } catch { /* resposta sem JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.blob();
}

/**
 * Envio por streaming (corpo bruto) com progresso E com "vigia de travamento": se o envio ficar PARADO (sem avançar
 * nem responder) por STALL_MS, aborta e avisa — em vez de ficar eternamente em "enviando 54%". Assim um upload que
 * emperra vira um erro claro com "tente de novo", não um congelamento.
 */
const STALL_MS = 45_000;
function enviarPorStreaming<T>(url: string, file: File, onProgresso: (pct: number) => void): Promise<T> {
  return new Promise<T>((ok, erro) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    let ultimoAvanco = Date.now();
    let travou = false;
    const vigia = window.setInterval(() => {
      if (Date.now() - ultimoAvanco > STALL_MS) {
        travou = true;
        window.clearInterval(vigia);
        try { xhr.abort(); } catch { /* já encerrado */ }
        erro(new ApiError(0, 'O envio travou (ficou parado). Verifique a conexão/servidor e tente de novo.'));
      }
    }, 5_000);
    const fim = () => window.clearInterval(vigia);
    xhr.upload.onprogress = (e) => {
      ultimoAvanco = Date.now();
      if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      fim();
      if (travou) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          ok(JSON.parse(xhr.responseText));
        } catch {
          erro(new ApiError(xhr.status, 'Resposta inesperada do servidor.'));
        }
      } else {
        let m = xhr.statusText;
        try {
          const d = JSON.parse(xhr.responseText);
          m = Array.isArray(d?.message) ? d.message.join('; ') : d?.message ?? m;
        } catch {
          /* corpo não-JSON */
        }
        erro(new ApiError(xhr.status, m));
      }
    };
    xhr.onerror = () => { fim(); if (!travou) erro(new ApiError(0, 'Sem resposta do servidor (o envio pode ter sido grande demais ou a conexão caiu).')); };
    xhr.send(file);
  });
}

/**
 * Envia UM pedaço com progresso real e vigia de INATIVIDADE. Um tempo total fixo penalizava conexão lenta: mesmo
 * avançando, o pedido era abortado aos 45 s. O XHR permite renovar a vigia a cada byte enviado e distinguir uma
 * conexão lenta de uma conexão realmente parada.
 */
function enviarPedacoUmaVez(url: string, corpo: Blob, offset: number, total: number, onProgresso: (pct: number) => void): Promise<any> {
  return new Promise((ok, erro) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    let ultimoAvanco = Date.now();
    let ultimoCarregado = 0;
    let encerrado = false;
    const terminar = () => {
      if (encerrado) return false;
      encerrado = true;
      window.clearInterval(vigia);
      return true;
    };
    const vigia = window.setInterval(() => {
      if (Date.now() - ultimoAvanco <= STALL_MS || !terminar()) return;
      try { xhr.abort(); } catch { /* já encerrado */ }
      erro(new ApiError(0, 'Um pedaço do vídeo ficou sem avançar por 45 segundos. Tentando novamente.'));
    }, 5_000);
    xhr.upload.onprogress = (e) => {
      if (e.loaded > ultimoCarregado) {
        ultimoCarregado = e.loaded;
        ultimoAvanco = Date.now();
      }
      onProgresso(Math.min(99, Math.round(((offset + e.loaded) / Math.max(1, total)) * 100)));
    };
    xhr.onload = () => {
      if (!terminar()) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { ok(JSON.parse(xhr.responseText)); } catch { erro(new ApiError(xhr.status, 'Resposta inesperada do servidor.')); }
        return;
      }
      let m = xhr.statusText;
      try {
        const d = JSON.parse(xhr.responseText);
        m = Array.isArray(d?.message) ? d.message.join('; ') : d?.message ?? m;
      } catch { /* corpo não-JSON */ }
      erro(new ApiError(xhr.status, m));
    };
    xhr.onerror = () => { if (terminar()) erro(new ApiError(0, 'A conexão caiu durante este pedaço.')); };
    xhr.onabort = () => { if (terminar()) erro(new ApiError(0, 'O envio deste pedaço foi interrompido.')); };
    xhr.send(corpo);
  });
}

/** Envia um pedaço com novas tentativas; o servidor reconhece repetição do mesmo offset sem duplicar os bytes. */
async function enviarPedaco(url: string, corpo: Blob, offset: number, total: number, onProgresso: (pct: number) => void, tentativas = 3): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      return await enviarPedacoUmaVez(url, corpo, offset, total, onProgresso);
    } catch (e: any) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e; // erro do servidor sobre o conteúdo: não repete
      if (i >= tentativas) throw new ApiError(0, `O envio do vídeo falhou (${e?.message ?? e}). Tente de novo.`);
      await new Promise((r) => setTimeout(r, 800 * i)); // espera e reenvia o MESMO pedaço
    }
  }
}

/**
 * Envia um vídeo/áudio EM PEDAÇOS de ~4 MB: cada pedaço é uma requisição curta que termina rápido. Assim arquivo
 * grande não trava num único fluxo (flow-control do HTTP/2, timeouts, engasgo da rede) — um pedaço que falha é
 * reenviado sozinho, e o progresso anda de verdade. O último pedaço fecha o vídeo no servidor e devolve o caminho.
 */
export async function enviarVideo(projetoId: string, file: File, onProgresso: (pct: number) => void, standalone = false): Promise<{ id: string; nome: string; bytes: number; caminho: string; pasta: string }> {
  const PEDACO = 4 * 1024 * 1024;
  const id = ((crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40).padEnd(8, '0');
  const base = `/api/${standalone?'studio/projects':'projects'}/${projetoId}/videos/chunk?nome=${encodeURIComponent(file.name)}&id=${id}`;
  let offset = 0;
  let ultimo: any = null;
  do {
    const fim = Math.min(offset + PEDACO, file.size);
    const ehFinal = fim >= file.size;
    const tamanho = fim - offset;
    ultimo = await enviarPedaco(`${base}&offset=${offset}&tamanho=${tamanho}&final=${ehFinal ? 1 : 0}`, file.slice(offset, fim), offset, file.size, onProgresso);
    offset = fim;
    onProgresso(Math.min(100, Math.round((offset / Math.max(1, file.size)) * 100)));
  } while (offset < file.size);
  return ultimo; // resposta do último pedaço: { id, nome, bytes, caminho, pasta }
}

/** Envia um .zip por streaming (corpo bruto), com progresso; o servidor extrai todos os vídeos de dentro. */
export function enviarZipDeVideos(projetoId: string, file: File, onProgresso: (pct: number) => void): Promise<{ adicionados: any[]; ignorados: number; videos: any[] }> {
  return enviarPorStreaming(`/api/projects/${projetoId}/videos/zip?nome=${encodeURIComponent(file.name)}`, file, onProgresso);
}

export function fileToBase64(f: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => erro(r.error);
    r.readAsDataURL(f);
  });
}

const LOTE_BYTES = 25 * 1024 * 1024;
const MAX_ARQUIVO = 10 * 1024 * 1024;
const IGNORAR = /(^|\/)(node_modules|\.git|__pycache__|\.venv)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

/**
 * Envia arquivos ou uma pasta inteira para `rota` (base de um modelo ou conhecimento de um projeto),
 * em lotes. Pastas mantêm a estrutura (sem o nome da pasta escolhida). Devolve um resumo para a tela.
 */
export async function enviarArquivos(rota: string, arquivos: FileList, onProgresso: (t: string) => void): Promise<string> {
  const lista = Array.from(arquivos)
    .map((f) => {
      const rel = (f as any).webkitRelativePath as string | undefined;
      return { f, path: rel ? rel.split('/').slice(1).join('/') : f.name };
    })
    .filter((x) => x.path && !IGNORAR.test(x.path));
  let enviados = 0;
  let guardados = 0;
  let convertidos = 0;
  const ignorados: string[] = [];
  let lote: Array<{ path: string; contentBase64: string }> = [];
  let bytes = 0;
  const flush = async () => {
    if (!lote.length) return;
    const r = await api(rota, 'POST', { files: lote });
    enviados += lote.length;
    guardados += r.importados;
    convertidos += r.convertidos?.length ?? 0;
    ignorados.push(...r.ignorados);
    lote = [];
    bytes = 0;
  };
  for (const { f, path } of lista) {
    if (f.size > MAX_ARQUIVO) {
      ignorados.push(`${path} (maior que 10 MB)`);
      continue;
    }
    if (bytes + f.size > LOTE_BYTES || lote.length >= 500) await flush();
    lote.push({ path, contentBase64: await fileToBase64(f) });
    bytes += f.size;
    onProgresso(`Enviando… ${enviados + lote.length} de ${lista.length}`);
  }
  await flush();
  const partes = [`${guardados} arquivo(s) guardados.`];
  if (convertidos) partes.push(`${convertidos} documento(s) (PDF, Word, Excel…) guardados como texto para a IA ler.`);
  if (ignorados.length) partes.push(`Não entraram: ${ignorados.slice(0, 5).join('; ')}${ignorados.length > 5 ? ` e mais ${ignorados.length - 5}` : ''}.`);
  return partes.join(' ');
}

/** Converte PDF, Office/LibreOffice ou texto em texto puro no servidor. */
export async function textoDoArquivo(f: File): Promise<string> {
  const r = await api<{ texto: string }>('/extract-text', 'POST', { name: f.name, contentBase64: await fileToBase64(f) });
  return r.texto;
}

export function nomeUsuario(): string {
  try {
    return localStorage.getItem('nivoo_nome') || 'usuário';
  } catch {
    return 'usuário';
  }
}

/** Abre um arquivo de texto servido pela API (com o token, se houver). */
export async function lerArquivo(url: string): Promise<string> {
  const token = getToken();
  let res = await fetch(`/api${url}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (res.status === 401 && (await renovar(token))) res = await fetch(`/api${url}`, { headers: { authorization: `Bearer ${getToken()}` } });
  return res.ok ? res.text() : 'Não foi possível abrir este arquivo.';
}

/** Arquivo binário servido pela API (com o token, se houver), como endereço local do navegador. */
export async function urlDoArquivo(url: string, tipo?: string): Promise<string | null> {
  const token = getToken();
  let res = await fetch(`/api${url}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (res.status === 401 && (await renovar(token))) res = await fetch(`/api${url}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return null;
  return URL.createObjectURL(tipo ? new Blob([await res.arrayBuffer()], { type: tipo }) : await res.blob());
}

/** URL para player/download nativo. O guard já aceita token na query para elementos que não permitem cabeçalho. */
export function urlAutenticada(url: string): string {
  const token = getToken();
  return `/api${url}${token ? `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : ''}`;
}

/** Copia texto (também em http sem HTTPS, onde o navegador não libera a área de transferência moderna). */
export async function copiarTexto(texto: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      return await navigator.clipboard.writeText(texto);
    } catch {
      /* permissão negada: usa o método antigo abaixo */
    }
  }
  const t = document.createElement('textarea');
  t.value = texto;
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  document.execCommand('copy');
  t.remove();
}
