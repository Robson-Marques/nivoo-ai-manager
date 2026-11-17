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

/** Envia um vídeo por streaming (corpo bruto), com progresso — para arquivo grande que não cabe no JSON. */
export function enviarVideo(projetoId: string, file: File, onProgresso: (pct: number) => void): Promise<{ id: string; nome: string; bytes: number; caminho: string; pasta: string }> {
  return new Promise((ok, erro) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${projetoId}/videos?nome=${encodeURIComponent(file.name)}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
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
    xhr.onerror = () => erro(new ApiError(0, 'Sem resposta do servidor (o envio pode ter sido grande demais ou a conexão caiu).'));
    xhr.send(file);
  });
}

/** Envia um .zip por streaming (corpo bruto), com progresso; o servidor extrai todos os vídeos de dentro. */
export function enviarZipDeVideos(projetoId: string, file: File, onProgresso: (pct: number) => void): Promise<{ adicionados: any[]; ignorados: number; videos: any[] }> {
  return new Promise((ok, erro) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${projetoId}/videos/zip?nome=${encodeURIComponent(file.name)}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
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
    xhr.onerror = () => erro(new ApiError(0, 'Sem resposta do servidor (o envio pode ter sido grande demais ou a conexão caiu).'));
    xhr.send(file);
  });
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
