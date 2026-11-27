import { restrictedToolList,validateMcpToolNames } from './tool-policy';
import type { McpResolvido } from './mcp';
import * as path from 'node:path';

export function restrictHttpMcp(m:McpResolvido,names:readonly string[]):McpResolvido{
  if(m.tipo!=='http'||!m.url)throw Error('Filtro individual requer MCP HTTP.');
  const allowed=validateMcpToolNames(names);
  if(!allowed.length)throw Error('Nenhuma ferramenta MCP autorizada.');
  const headers=Object.entries(m.headers??{});
  const env:Record<string,string>={NIVOO_MCP_BRIDGE_URL:m.url,NIVOO_MCP_BRIDGE_TOOLS:JSON.stringify(allowed),NIVOO_MCP_BRIDGE_HEADER_NAMES:JSON.stringify(headers.map(([k])=>k))};
  headers.forEach(([,v],i)=>env['NIVOO_MCP_BRIDGE_HEADER_'+i]=v);
  return {nome:m.nome,tipo:'comando',comando:process.execPath,args:[path.join(__dirname,'restricted-http-main.js')],env,ferramentasPermitidas:allowed};
}
const VERSIONS=new Set(['2024-11-05','2025-03-26','2025-06-18','2025-11-25']);
type Json=Record<string,any>;
const obj=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const MAX_BYTES=8*1024*1024;
export class RestrictedHttpMcp{
  private session:string|undefined;
  private protocol:string|undefined;
  private nextId=0;
  private listed=new Set<string>();
  private allowed:Set<string>;
  private initialized=false;
  private base:Record<string,string>;
  constructor(private url:string,headers:Record<string,string>,names:readonly string[],private request:typeof fetch=fetch,private report:(line:string)=>void=()=>{}){
    const u=new URL(url);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('URL MCP inválida.');
    this.allowed=new Set(validateMcpToolNames(names));
    if(!this.allowed.size)throw Error('Nenhuma ferramenta autorizada.');
    this.base={...headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  }
  private headers(){return {...this.base,...(this.session?{'Mcp-Session-Id':this.session}:{}),...(this.protocol?{'MCP-Protocol-Version':this.protocol}:{})};}
  private async send(method:string,params:Json={},notification=false):Promise<Json>{
    const id=notification?undefined:++this.nextId;
    const res=await this.request(this.url,{method:'POST',headers:this.headers(),redirect:'error',signal:AbortSignal.timeout(90000),body:JSON.stringify({jsonrpc:'2.0',method,params,...(id===undefined?{}:{id})})});
    if(!res.ok){await res.body?.cancel();throw Error('MCP remoto respondeu HTTP '+res.status+'.');}
    const session=res.headers.get('mcp-session-id');if(session)this.session=session;
    if(notification){await res.body?.cancel();return {};}
    if(!res.body)throw Error('Resposta MCP sem corpo.');
    const reader=res.body.getReader(),decoder=new TextDecoder(),sse=res.headers.get('content-type')?.includes('text/event-stream');
    let buffer='',bytes=0;
    function parse(value:string):Json|null{
      const message:unknown=JSON.parse(value);
      if(!obj(message)||message.id!==id)return null;
      if(message.jsonrpc!=='2.0'||message.error||!obj(message.result))throw Error('Resposta MCP remota inválida ou com erro.');
      return message.result;
    }
    const event=(v:string)=>v.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    try{
      for(;;){
        const chunk=await reader.read();
        if(chunk.done){buffer+=decoder.decode();break;}
        bytes+=chunk.value.byteLength;
        if(bytes>MAX_BYTES)throw Error('Resposta MCP acima do limite.');
        buffer+=decoder.decode(chunk.value,{stream:true});
        if(sse){
          const events=buffer.split(/\r?\n\r?\n/);buffer=events.pop()??'';
          for(const e of events){const data=event(e);if(data){const result=parse(data);if(result)return result;}}
        }
      }
      const data=sse?event(buffer):buffer;
      const result=data?parse(data):null;
      if(!result)throw Error('Resposta MCP sem ID correspondente.');
      return result;
    }finally{await reader.cancel().catch(()=>undefined);}
  }
  private async connect(){
    if(this.initialized)return;
    const result=await this.send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'nivoo-mcp-filter',version:'1'}});
    if(!VERSIONS.has(result.protocolVersion)||!obj(result.capabilities?.tools)||typeof result.serverInfo?.name!=='string')throw Error('Servidor MCP sem protocolo/capacidade de ferramentas compatível.');
    this.protocol=result.protocolVersion;
    await this.send('notifications/initialized',{},true);
    this.initialized=true;
  }
  async list():Promise<Json[]>{
    this.listed.clear();
    await this.connect();
    const all:Json[]=[],seen=new Set<string>(),cursors=new Set<string>();
    let cursor:string|undefined;
    for(let i=0;i<20;i++){
      const page=await this.send('tools/list',cursor?{cursor}:{});
      for(const tool of restrictedToolList(page.tools,this.allowed)){
        const name=String(tool.name);
        if(seen.has(name))throw Error('Ferramenta MCP repetida na paginação.');
        seen.add(name);all.push(tool);
      }
      if(page.nextCursor===undefined){
        this.listed=seen;
        this.report('MCP filtro: ferramentas descobertas e autorizadas: '+([...seen].join(', ')||'nenhuma')+'; não localizadas: '+([...this.allowed].filter(x=>!seen.has(x)).join(', ')||'nenhuma'));
        return all;
      }
      if(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>4096||cursors.has(page.nextCursor))throw Error('Cursor MCP inválido ou repetido.');
      cursor=page.nextCursor;cursors.add(cursor);
    }
    throw Error('Paginação MCP acima do limite.');
  }
  async call(name:unknown,args:unknown):Promise<Json>{
    if(typeof name!=='string'||!this.allowed.has(name)||!this.listed.has(name))throw Error('Ferramenta não autorizada ou não descoberta na sessão.');
    if(args!==undefined&&!obj(args))throw Error('Argumentos MCP inválidos.');
    const result=await this.send('tools/call',{name,arguments:args??{}});
    if(!Array.isArray(result.content)&&!obj(result.structuredContent))throw Error('Resultado MCP sem conteúdo válido.');
    return result;
  }
  async close(){
    if(!this.session||!this.protocol)return;
    try{const res=await this.request(this.url,{method:'DELETE',headers:this.headers(),redirect:'error',signal:AbortSignal.timeout(2000)});await res.body?.cancel();}catch{/* server may not support DELETE */}
  }
}
/** Local server only exposes the tools protocol; it never forwards arbitrary
 * methods, notifications, resources, prompts or server-initiated requests. */
export async function handleRestrictedMcp(client:RestrictedHttpMcp,msg:unknown):Promise<Json|null>{
  if(!obj(msg)||msg.jsonrpc!=='2.0'||msg.id===undefined)return null;
  const reply=(result:Json)=>({jsonrpc:'2.0',id:msg.id,result});
  try{
    switch(msg.method){
      case 'initialize':return reply({protocolVersion:VERSIONS.has(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'nivoo-mcp-filter',version:'1'}});
      case 'ping':return reply({});
      case 'tools/list':return reply({tools:await client.list()});
      case 'tools/call':return reply(await client.call(msg.params?.name,msg.params?.arguments));
      default:return {jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Método MCP não autorizado.'}};
    }
  }catch(e){return {jsonrpc:'2.0',id:msg.id,error:{code:-32000,message:e instanceof Error&&/^(Ferramenta não autorizada|Argumentos MCP inválidos)/.test(e.message)?e.message:'Falha de descoberta/chamada MCP filtrada; confira a conexão e o inventário.'}};}
}
