import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Login simples por usuário e senha, para servir o Nivoo num domínio próprio (sem depender do login da Cloudflare).
 * Configuração: NIVOO_LOGIN_USUARIO e NIVOO_LOGIN_SENHA (no ambiente do serviço). Ao logar, o servidor devolve um
 * "crachá" (token de sessão) assinado (HMAC) que a tela guarda e manda em cada chamada; o guard de API o aceita.
 * Sem multiusuário: é uma instância única, um login. A senha nunca sai do servidor; só o crachá assinado circula.
 */
function eqConst(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Segredo para assinar o crachá: a própria senha (estável e secreta no servidor) + o token de API se houver. */
function segredoDaSessao(): string {
  return `${process.env.NIVOO_LOGIN_SENHA ?? ''}|${process.env.NIVOO_API_TOKEN ?? ''}|nivoo-sessao`;
}

export function loginConfigurado(): boolean {
  return !!(process.env.NIVOO_LOGIN_USUARIO && process.env.NIVOO_LOGIN_SENHA);
}

/** Usuário e senha conferem com o configurado? (comparação em tempo constante) */
export function conferirCredenciais(usuario: unknown, senha: unknown): boolean {
  const u = process.env.NIVOO_LOGIN_USUARIO ?? '';
  const s = process.env.NIVOO_LOGIN_SENHA ?? '';
  if (!u || !s) return false;
  // Confere os dois sempre (sem curto-circuito) para não vazar qual dos dois errou pelo tempo.
  const okU = eqConst(String(usuario ?? ''), u);
  const okS = eqConst(String(senha ?? ''), s);
  return okU && okS;
}

const HORAS_PADRAO = Number(process.env.NIVOO_LOGIN_HORAS ?? 24 * 30);

/** Emite um crachá de sessão assinado, válido por algumas horas. */
export function emitirSessao(horas = HORAS_PADRAO): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + horas * 3600 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', segredoDaSessao()).update(payload).digest('hex');
  return `s1.${payload}.${sig}`;
}

/** O crachá é válido (assinatura bate e não venceu)? */
export function sessaoValida(token: unknown): boolean {
  const m = /^s1\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(String(token ?? ''));
  if (!m) return false;
  const esperado = createHmac('sha256', segredoDaSessao()).update(m[1]).digest('hex');
  if (!eqConst(m[2], esperado)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}
