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
 * Servidor com acesso protegido (NIVOO_API_TOKEN): pede o token uma vez e guarda neste navegador.
 * O token está em /etc/nivoo/nivoo.env no servidor (linha NIVOO_API_TOKEN).
 */
let ultimoPedido = 0;
function pedirToken(): boolean {
  // Sem insistir: as telas atualizam sozinhas e não podem abrir uma pergunta atrás da outra.
  if (Date.now() - ultimoPedido < 30_000) return false;
  ultimoPedido = Date.now();
  const t = window.prompt('Este servidor pede o token de acesso (está no arquivo /etc/nivoo/nivoo.env, linha NIVOO_API_TOKEN):');
  if (!t?.trim()) return false;
  setToken(t.trim());
  return true;
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
  let res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && pedirToken()) {
    headers.authorization = `Bearer ${getToken()}`;
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
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
  let ignorados = 0;
  let lote: Array<{ path: string; contentBase64: string }> = [];
  let bytes = 0;
  const flush = async () => {
    if (!lote.length) return;
    const r = await api(rota, 'POST', { files: lote });
    enviados += lote.length;
    ignorados += r.ignorados.length;
    lote = [];
    bytes = 0;
  };
  for (const { f, path } of lista) {
    if (f.size > MAX_ARQUIVO) {
      ignorados++;
      continue;
    }
    if (bytes + f.size > LOTE_BYTES || lote.length >= 500) await flush();
    lote.push({ path, contentBase64: await fileToBase64(f) });
    bytes += f.size;
    onProgresso(`Enviando… ${enviados + lote.length} de ${lista.length}`);
  }
  await flush();
  return `${enviados} arquivo(s) guardados.${ignorados ? ` ${ignorados} ignorado(s) (pastas de sistema ou maiores que 10 MB).` : ''}`;
}

/** Converte PDF, Word ou texto em texto puro no servidor. */
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
  if (res.status === 401 && pedirToken()) res = await fetch(`/api${url}`, { headers: { authorization: `Bearer ${getToken()}` } });
  return res.ok ? res.text() : 'Não foi possível abrir este arquivo.';
}
