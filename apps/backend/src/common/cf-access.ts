import { createPublicKey, KeyObject, verify } from 'node:crypto';

/**
 * Login da Cloudflare (Cloudflare Access) como entrada do Nivoo: quem passou pelo código por e-mail da
 * Cloudflare chega com o cabeçalho `Cf-Access-Jwt-Assertion`, um JWT assinado pela Cloudflare. Ele só é
 * aceito se a assinatura (RS256) bater com as chaves públicas da SUA equipe na Cloudflare, se for para a SUA
 * aplicação (AUD) e se não estiver vencido — não dá para falsificar mandando o cabeçalho na mão.
 * Configuração: NIVOO_CF_ACCESS_TEAM (ex.: minhaequipe ou minhaequipe.cloudflareaccess.com) e
 * NIVOO_CF_ACCESS_AUD (Application Audience Tag da aplicação no painel).
 */
let cache: { url: string; at: number; chaves: Map<string, KeyObject> } | null = null;
let ultimaBusca = 0;

function equipe(): { iss: string; certs: string } | null {
  const t = (process.env.NIVOO_CF_ACCESS_TEAM ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!t) return null;
  const host = t.includes('.') ? t : `${t}.cloudflareaccess.com`;
  return { iss: `https://${host}`, certs: process.env.NIVOO_CF_ACCESS_CERTS_URL ?? `https://${host}/cdn-cgi/access/certs` };
}

export function acessoCloudflareConfigurado(): boolean {
  return !!equipe() && !!process.env.NIVOO_CF_ACCESS_AUD;
}

let buscando: Promise<void> | null = null;

async function buscarChaves(url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const j: any = await res.json();
    const chaves = new Map<string, KeyObject>();
    for (const k of j.keys ?? []) if (k.kid && k.kty === 'RSA') chaves.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
    if (chaves.size) cache = { url, at: Date.now(), chaves };
  } catch {
    /* fora do ar: segue com as chaves que já temos */
  }
}

async function chave(kid: string): Promise<KeyObject | null> {
  const e = equipe()!;
  const mesma = cache && cache.url === e.certs ? cache : null;
  const fresco = mesma && Date.now() - mesma.at < 3_600_000;
  if (fresco && mesma!.chaves.has(kid)) return mesma!.chaves.get(kid)!;
  // Chave nova ou lista velha (a Cloudflare troca as chaves de tempos em tempos): busca de novo, no máximo
  // 1x por minuto e uma busca por vez, venha o pedido de quem vier.
  if (Date.now() - ultimaBusca >= 60_000) {
    ultimaBusca = Date.now();
    buscando ??= buscarChaves(e.certs).finally(() => (buscando = null));
  }
  if (buscando) await buscando;
  // Se a busca falhou, uma chave já conhecida continua valendo (a Cloudflare a publica por semanas).
  const atual = cache && cache.url === e.certs ? cache : null;
  return atual?.chaves.get(kid) ?? null;
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

export async function acessoCloudflareValido(jwt: string | undefined): Promise<boolean> {
  const e = equipe();
  const aud = process.env.NIVOO_CF_ACCESS_AUD?.trim();
  if (!e || !aud || !jwt) return false;
  const partes = jwt.split('.');
  if (partes.length !== 3) return false;
  let cab: any;
  let corpo: any;
  try {
    cab = JSON.parse(b64(partes[0]).toString('utf8'));
    corpo = JSON.parse(b64(partes[1]).toString('utf8'));
  } catch {
    return false;
  }
  if (!cab || typeof cab !== 'object' || !corpo || typeof corpo !== 'object') return false;
  if (cab.alg !== 'RS256' || typeof cab.kid !== 'string') return false;
  if (corpo.iss !== e.iss) return false;
  const auds = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!auds.includes(aud)) return false;
  const agora = Date.now() / 1000;
  if (typeof corpo.exp !== 'number' || corpo.exp < agora) return false;
  if (typeof corpo.nbf === 'number' && corpo.nbf > agora + 60) return false;
  const k = await chave(cab.kid);
  if (!k) return false;
  return verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), k, b64(partes[2]));
}
