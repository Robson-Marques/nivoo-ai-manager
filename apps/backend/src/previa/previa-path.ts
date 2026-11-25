import * as http from 'node:http';

export const PREVIA_PATH = '/previa';
export function modoCaminho(): boolean {
  const raw = (process.env.NIVOO_PREVIA_URL ?? '').replace(/\/+$/, '');
  return raw === PREVIA_PATH || /^https?:\/\/[^/]+\/previa$/i.test(raw);
}
export function baseSessao(token:string):string { return PREVIA_PATH+'/'+token+'/'; }
export function separarCaminho(raw:string) {
  const match=/^\/previa\/([a-f0-9]{48})(\/[^#]*)$/.exec(raw);
  if(!match)return null;
  const local=match[2];
  // Reject traversal, encoded path separators, backslashes and control characters.
  const pathname=local.split('?')[0];
  if(/%(?:2e|2f|5c|00|0a|0d|25)|[\\\u0000-\u001f]|(?:^|\/)\.{1,2}(?:\/|$)/i.test(pathname))return null;
  return {token:match[1],local,base:baseSessao(match[1])};
}
export function caminhoPublico(base:string,local:string):string {
  if(!local.startsWith('/')||local.startsWith('//')||/[\\\r\n]/.test(local))return base;
  return base+local.slice(1);
}
/** Browser sandbox is mandatory, even when the preview is opened directly in a new tab. */
export function headersCaminho(res:http.ServerResponse, req:http.IncomingMessage, base:string) {
  const configured=process.env.NIVOO_PREVIA_URL??'';
  let origin='';
  try { origin=new URL(configured).origin; }catch {
    const host=String(req.headers.host??'');
    if(/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(host)){
      const proto=String(req.headers['x-forwarded-proto']??'').split(',')[0].trim()==='https'||!!(req.socket as {encrypted?:boolean}).encrypted?'https':'http';
      origin=proto+'://'+host;
    }
  }
  if(!origin)return false;
  const src=origin+base;
  const ws=src.replace(/^http/,'ws');
  res.setHeader('Content-Security-Policy',[
    'sandbox allow-scripts allow-forms',
    "default-src 'none'",
    "script-src "+src+" 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src "+src+" 'unsafe-inline'",
    "img-src "+src+" data: blob:",
    "font-src "+src+" data:",
    "media-src "+src+" blob:",
    "connect-src "+src+" "+ws,
    "form-action "+src,
    "base-uri "+src,
    "worker-src 'none'",
    "object-src 'none'",
    "frame-src 'none'"
  ].join('; '));
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  // Opaque origin from the sandbox: allow reading only capability-scoped responses, never admin API.
  res.setHeader('Access-Control-Allow-Origin','null');
  res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Accept, X-Requested-With');
  return true;
}
export function headersProjeto(req:http.IncomingMessage):http.OutgoingHttpHeaders {
  const out:http.OutgoingHttpHeaders={};
  for(const k of ['accept','accept-language','content-type','content-length','range','if-none-match','if-modified-since','user-agent','connection','upgrade','sec-websocket-key','sec-websocket-version','sec-websocket-protocol','sec-websocket-extensions']){
    const v=req.headers[k];if(v!==undefined)out[k]=v;
  }
  return out;
}
export function headersRespostaProjeto(headers:http.IncomingHttpHeaders):http.OutgoingHttpHeaders {
  const out:http.OutgoingHttpHeaders={};
  // Never let generated software set cookies, clear site data, register workers, or change CSP.
  for(const k of ['content-type','content-length','content-encoding','content-range','accept-ranges','etag','last-modified']){
    const v=headers[k];if(v!==undefined)out[k]=v;
  }
  return out;
}
export function bloquearApiDaPrevia(req:{headers:Record<string,unknown>}):boolean{
  const h=req.headers;
  if(h.origin==='null')return true;
  // Browser requests from an opaque-origin preview or cross-site forms must not borrow
  // ambient Cloudflare credentials. Explicit bearer callers can still use the API.
  return h['sec-fetch-site']==='cross-site' && !(typeof h.authorization==='string'&&h.authorization.startsWith('Bearer '));
}
