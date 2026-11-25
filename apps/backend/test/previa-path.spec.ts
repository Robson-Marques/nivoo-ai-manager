import { baseSessao,separarCaminho,caminhoPublico,headersProjeto,headersRespostaProjeto,bloquearApiDaPrevia } from '../src/previa/previa-path';
import type { IncomingMessage } from 'node:http';
describe('Prévia por caminho',()=>{
  const t='a'.repeat(48), base=baseSessao(t);
  it('routes only temporary capability paths',()=>{
    expect(separarCaminho(base+'assets/app.js?q=1')).toEqual({token:t,local:'/assets/app.js?q=1',base});
    expect(separarCaminho(base+'../api')).toBeNull();
    expect(separarCaminho(base+'%2e%2e/api')).toBeNull();
    expect(separarCaminho('/previa/api')).toBeNull();
    expect(caminhoPublico(base,'//outside')).toBe(base);
  });
  it('does not forward administrative credentials or privileged response headers',()=>{
    expect(headersProjeto({headers:{authorization:'Bearer secret',cookie:'admin=secret','cf-access-jwt-assertion':'secret',accept:'text/html'}} as unknown as IncomingMessage)).toEqual({accept:'text/html'});
    expect(headersRespostaProjeto({'set-cookie':['admin=x'],'clear-site-data':'"*"', 'content-security-policy':'unsafe','content-type':'text/html'})).toEqual({'content-type':'text/html'});
    expect(bloquearApiDaPrevia({headers:{origin:'null'}})).toBe(true);
    expect(bloquearApiDaPrevia({headers:{'sec-fetch-site':'cross-site'}})).toBe(true);
    expect(bloquearApiDaPrevia({headers:{'sec-fetch-site':'same-origin'}})).toBe(false);
  });
});
