import { BadRequestException, ConflictException } from '@nestjs/common';
import { GitAccount } from './git-accounts';

/**
 * API dos servidores Git (GitHub, GitHub Enterprise e GitLab próprio) para o que o git não faz:
 * listar os repositórios e grupos da conta e criar um repositório novo. Sempre com o token da conta.
 */

export interface Namespace {
  id: string;
  nome: string;
  tipo: 'usuario' | 'grupo';
}

export interface RepoRemoto {
  nome: string;
  url: string;
  branch: string;
  privado: boolean;
}

function apiBase(c: GitAccount): string {
  if (c.tipo === 'github') return c.host === 'https://github.com' ? 'https://api.github.com' : `${c.host}/api/v3`;
  return `${c.host}/api/v4`;
}

async function chamar(c: GitAccount, metodo: 'GET' | 'POST', rota: string, corpo?: unknown): Promise<any> {
  const headers: Record<string, string> =
    c.tipo === 'github'
      ? { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nivoo-ai-manager' }
      : { 'PRIVATE-TOKEN': c.token };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${apiBase(c)}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(30_000) });
  } catch (e: any) {
    throw new BadRequestException(`Não foi possível falar com ${c.host} (${e?.cause?.code ?? e?.message ?? 'erro de rede'})`);
  }
  const json: any = await res.json().catch(() => ({}));
  if (res.ok) return json;
  const msg = JSON.stringify(json?.errors ?? json?.message ?? json?.error ?? '').slice(0, 300);
  if (res.status === 401) throw new BadRequestException(`${c.nome}: o servidor recusou o token (inválido ou expirado)`);
  if (res.status === 403) throw new BadRequestException(`${c.nome}: o token não tem permissão para isto. ${msg}`);
  if ((res.status === 422 || res.status === 400) && /already|taken|existe/i.test(msg)) throw new ConflictException('Já existe um repositório com esse nome nesse lugar');
  throw new BadRequestException(`${c.nome} respondeu ${res.status}: ${msg}`);
}

/** Onde a conta pode criar repositórios: o próprio usuário e os grupos/organizações. */
export async function listarNamespaces(c: GitAccount): Promise<Namespace[]> {
  if (c.tipo === 'github') {
    const [u, orgs] = await Promise.all([chamar(c, 'GET', '/user'), chamar(c, 'GET', '/user/orgs?per_page=100')]);
    return [{ id: String(u.login), nome: String(u.login), tipo: 'usuario' as const }, ...(orgs as any[]).map((o) => ({ id: String(o.login), nome: String(o.login), tipo: 'grupo' as const }))];
  }
  const ns = (await chamar(c, 'GET', '/namespaces?per_page=100')) as any[];
  return ns.map((n) => ({ id: String(n.id), nome: String(n.full_path), tipo: n.kind === 'user' ? ('usuario' as const) : ('grupo' as const) }));
}

/** Repositórios a que a conta tem acesso (mais recentes primeiro), com filtro opcional pelo nome. */
export async function listarRepos(c: GitAccount, busca = ''): Promise<RepoRemoto[]> {
  const b = busca.trim().toLowerCase();
  if (c.tipo === 'github') {
    const todos: any[] = [];
    for (let pagina = 1; pagina <= 3; pagina++) {
      const lote = (await chamar(c, 'GET', `/user/repos?per_page=100&sort=updated&page=${pagina}`)) as any[];
      todos.push(...lote);
      if (lote.length < 100) break;
    }
    return todos
      .filter((r) => !b || String(r.full_name).toLowerCase().includes(b))
      .map((r) => ({ nome: String(r.full_name), url: String(r.clone_url), branch: String(r.default_branch || 'main'), privado: !!r.private }));
  }
  const lista = (await chamar(c, 'GET', `/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at${b ? `&search=${encodeURIComponent(b)}` : ''}`)) as any[];
  return lista.map((r) => ({ nome: String(r.path_with_namespace), url: String(r.http_url_to_repo), branch: String(r.default_branch || 'main'), privado: r.visibility !== 'public' }));
}

export function nomeDeRepo(raw: unknown): string {
  const n = String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  if (!n) throw new BadRequestException('Nome do repositório inválido');
  return n;
}

/** Cria um repositório VAZIO (sem README) e devolve o endereço https para clonar/enviar. */
export async function criarRepo(c: GitAccount, opts: { namespace?: string; tipoNamespace?: 'usuario' | 'grupo'; nome: string; privado: boolean; descricao?: string }): Promise<RepoRemoto> {
  const nome = nomeDeRepo(opts.nome);
  if (c.tipo === 'github') {
    const rota = opts.tipoNamespace === 'grupo' && opts.namespace ? `/orgs/${encodeURIComponent(opts.namespace)}/repos` : '/user/repos';
    const r = await chamar(c, 'POST', rota, { name: nome, private: opts.privado, description: opts.descricao?.slice(0, 300) ?? '', auto_init: false });
    return { nome: String(r.full_name), url: String(r.clone_url), branch: 'main', privado: !!r.private };
  }
  const corpo: Record<string, unknown> = { name: nome, path: nome, visibility: opts.privado ? 'private' : 'public', initialize_with_readme: false, description: opts.descricao?.slice(0, 300) ?? '' };
  if (opts.tipoNamespace === 'grupo' && opts.namespace) corpo.namespace_id = Number(opts.namespace);
  const r = await chamar(c, 'POST', '/projects', corpo);
  return { nome: String(r.path_with_namespace), url: String(r.http_url_to_repo), branch: 'main', privado: r.visibility !== 'public' };
}
