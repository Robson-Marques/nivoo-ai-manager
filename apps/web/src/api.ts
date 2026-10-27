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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export function eventsUrl(pid: string, jid: string): string {
  const token = getToken();
  return `/api/projects/${pid}/jobs/${jid}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function artifactUrl(pid: string, aid: string): string {
  const token = getToken();
  return `/api/projects/${pid}/artifacts/${aid}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
