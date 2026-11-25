/** /previa now selects the authenticated remote viewer, not a path rewrite. */
export function modoCaminho(): boolean {
  const raw = (process.env.NIVOO_PREVIA_URL ?? '').replace(/\/+$/, '');
  return raw === '/previa' || /^https?:\/\/[^/]+\/previa$/i.test(raw);
}
export function bloquearApiDaPrevia(req:{headers:Record<string,unknown>}):boolean{
  const h=req.headers;
  if(h.origin==='null')return true;
  return h['sec-fetch-site']==='cross-site' && !(typeof h.authorization==='string'&&h.authorization.startsWith('Bearer '));
}
