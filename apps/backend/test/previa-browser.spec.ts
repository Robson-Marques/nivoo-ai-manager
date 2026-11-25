import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { alvoPermitido, proxyDoNavegador, validarComando, VisualizadoresPrevia } from '../src/previa/previa-browser';

describe('Visualizador isolado',()=>{
  it('preserva o endereço original do software e restringe o proxy à sua porta',async()=>{
    const upstream=http.createServer((req,res)=>res.end(JSON.stringify({rota:req.url,cookie:req.headers.cookie})));
    await new Promise<void>(ok=>upstream.listen(0,'127.0.0.1',ok));
    const port=(upstream.address() as AddressInfo).port;
    const proxy=await proxyDoNavegador(port);
    const via=(url:string)=>new Promise<{status:number;body:string}>((resolve,reject)=>{
      const p=new URL(proxy.url);
      const r=http.get({hostname:p.hostname,port:p.port,path:url,headers:{cookie:'projeto=1'}},res=>{
        let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode??0,body}));
      });
      r.on('error',reject);
    });
    try{
      const api=await via('http://127.0.0.1:'+port+'/api/clientes?pagina=1');
      expect(api.status).toBe(200);
      expect(JSON.parse(api.body)).toEqual({rota:'/api/clientes?pagina=1',cookie:'projeto=1'});
      expect((await via('http://127.0.0.1:3001/api/health')).status).toBe(403);
      expect((await via('https://example.com/')).status).toBe(403);
      expect(alvoPermitido('ws://127.0.0.1:'+port+'/ws',port)).toBe(true);
      expect(alvoPermitido('http://127.0.0.1.evil.example:'+port+'/',port)).toBe(false);
    }finally{proxy.close();upstream.closeAllConnections();await new Promise<void>(ok=>upstream.close(()=>ok()));}
  });
  it('valida apenas comandos declarados e coordenadas normalizadas',()=>{
    expect(validarComando({tipo:'clique',x:.5,y:.5})).toMatchObject({tipo:'clique'});
    expect(()=>validarComando({tipo:'clique',x:2,y:0})).toThrow();
    expect(()=>validarComando({tipo:'navegar',url:'http://127.0.0.1:3001'})).toThrow();
    expect(()=>validarComando({tipo:'texto',texto:'x'.repeat(4001)})).toThrow();
  });
});

// Real browser regression, using the installed Chromium. Run explicitly on an environment
// with user namespaces enabled; never substitute a mocked browser for this evidence.
const browserTest=process.env.NIVOO_TESTE_PREVIA_BROWSER==='1'?it:it.skip;
browserTest('navigates an absolute /clientes link and mutates data via /api/clientes',async()=>{
  let clienteRecebido='';
  let visitouClientes=false;
  const html=(req:http.IncomingMessage)=>req.url==='/clientes'
    ? '<h1>Clientes</h1><input id="nome" aria-label="Nome" style="position:fixed;left:20px;top:80px;width:200px;height:40px"><button style="position:fixed;left:20px;top:150px;width:150px;height:40px" onclick="fetch(\'/api/clientes\',{method:\'POST\',body:document.getElementById(\'nome\').value})">Cadastrar</button>'
    : '<a style="position:fixed;left:20px;top:20px;width:150px;height:40px" href="/clientes">Clientes</a>';
  const app=http.createServer((req,res)=>{
    if(req.url==='/api/clientes'&&req.method==='POST'){req.on('data',d=>clienteRecebido+=String(d));req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end('{}');});return;}
    if(req.url==='/clientes')visitouClientes=true;
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(req));
  });
  await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok));
  const port=(app.address() as AddressInfo).port;
  const v=new VisualizadoresPrevia(),id='teste-visualizador-01';
  try{
    const first=await v.quadro('p','g',port,'/',id,'computador');
    expect(first[0]).toBe(255);expect(first[1]).toBe(216);
    await v.acao('p','g',id,{tipo:'clique',x:70/1366,y:40/900});
    for(let i=0;i<40&&!visitouClientes;i++)await new Promise(ok=>setTimeout(ok,100));
    expect(visitouClientes).toBe(true);
    await v.quadro('p','g',port,'/',id,'computador');
    await v.acao('p','g',id,{tipo:'clique',x:70/1366,y:100/900});
    await v.acao('p','g',id,{tipo:'texto',texto:'Cliente de teste'});
    await v.acao('p','g',id,{tipo:'clique',x:70/1366,y:165/900});
    for(let i=0;i<40&&!clienteRecebido;i++)await new Promise(ok=>setTimeout(ok,100));
    expect(clienteRecebido).toBe('Cliente de teste');
  }finally{await v.fechar('p');app.closeAllConnections();await new Promise<void>(ok=>app.close(()=>ok()));}
},60000);
