/**
 * Política de resfriamento para APIs com limites de requisições e de créditos.
 * Não contorna cotas: mantém a tarefa na fila até o provedor permitir.
 */
export function retryAfterHeaderMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const raw = header.trim();
  let delay: number;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    delay = Number(raw) * 1000;
  } else {
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return undefined;
    delay = at - now;
  }
  if (!Number.isFinite(delay)) return undefined;
  return Math.min(24 * 60 * 60_000, Math.max(0, Math.ceil(delay)));
}

export function isTransientRateLimit(detail: string): boolean {
  return /(?:\bHTTP\s*429\b|\btoo many requests\b|\brate.?limit(?:ed|ing)?\b)/i.test(detail);
}

/**
 * Recuo persistente pela fila. Sem Retry-After, vai de 2 min a 2 h para
 * não consumir uma cota diária inteira em tentativas de recuperação.
 */
export function resourceRateLimitDelayMs(resourceWaits: number, retryAfterMs?: number): number {
  const steps = [2, 5, 15, 30, 60, 120];
  const idx = Math.min(steps.length - 1, Math.max(0, Math.floor(Number(resourceWaits) || 0)));
  const backoff = steps[idx] * 60_000;
  const hint = Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs ?? 0) : 0;
  return Math.min(24 * 60 * 60_000, Math.max(backoff, hint));
}
