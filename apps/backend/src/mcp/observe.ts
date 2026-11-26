import type { McpResolvido } from './mcp';
export type McpLog=(line:string,level?:'INFO'|'WARN'|'ERROR')=>void;
/** Native CLI receipts describe calls reported by the process, not proof
 * of an external side effect. Log names and status only; never arguments
 * or returned payloads. */
export function observeMcpCalls(cli:'codex'|'claude'|'gemini',servers:readonly McpResolvido[],log:McpLog):(line:string)=>void{
  const configured=new Set(servers.map(s=>s.nome)),pending=new Map<string,{server:string;tool:string}>(),done=new Set<string>();
  const safe=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
  const match=(name:unknown)=>{
    if(typeof name!=='string')return null;
    for(const server of configured){
      const prefix='mcp__'+server+'__';
      if(name.startsWith(prefix)&&safe(name.slice(prefix.length)))return {server,tool:name.slice(prefix.length)};
    }
    return null;
  };
  function start(id:unknown,call:{server:string;tool:string}|null){
    if(typeof id!=='string'||!call||done.has(id)||pending.has(id)||pending.size>=1000)return;
    pending.set(id,call);log('MCP chamada iniciada: '+call.server+'/'+call.tool+' (CLI '+cli+')');
  }
  function finish(id:unknown,outcome:'success'|'error'|'unknown'){
    if(typeof id!=='string'||done.has(id))return;
    const call=pending.get(id);if(!call)return;
    pending.delete(id);if(done.size<10000)done.add(id);
    log('MCP resultado informado: '+call.server+'/'+call.tool+' — '+(outcome==='success'?'sucesso':outcome==='error'?'erro':'estado não comprovado')+' (CLI '+cli+')',outcome==='error'?'WARN':'INFO');
  }
  return line=>{
    let e:any;try{e=JSON.parse(line);}catch{return;}
    if(cli==='codex'){
      const item=e.item;
      if(!['item.started','item.completed'].includes(e.type)||item?.type!=='mcp_tool_call'||!configured.has(item.server)||!safe(item.tool))return;
      start(item.id,{server:item.server,tool:item.tool});
      if(e.type==='item.completed')finish(item.id,item.error||item.status==='failed'||item.result?.isError===true?'error':item.status==='completed'?'success':'unknown');
    }else if(cli==='claude'){
      if(e.type==='assistant'&&Array.isArray(e.message?.content))for(const c of e.message.content)if(c.type==='tool_use')start(c.id,match(c.name));
      if(e.type==='user'&&Array.isArray(e.message?.content))for(const c of e.message.content)if(c.type==='tool_result')finish(c.tool_use_id,c.is_error===true?'error':c.content!==undefined?'success':'unknown');
    }else{
      if(e.type==='tool_use')start(e.tool_id,match(e.tool_name));
      if(e.type==='tool_result')finish(e.tool_id,e.status==='success'?'success':e.status==='error'?'error':'unknown');
    }
  };
}
/** Remove known MCP credential values before forwarding raw CLI diagnostics.
 * This is not general DLP; tool outputs may contain other sensitive data. */
export function redactMcpLog(servers:readonly McpResolvido[],log:McpLog):McpLog{
  const values=new Set<string>();
  for(const s of servers)for(const v of [...Object.values(s.env??{}),...Object.values(s.headers??{})]){
    if(!v)continue;values.add(v);const b=/^Bearer\s+(.+)$/i.exec(v)?.[1];if(b)values.add(b);
  }
  const ordered=[...values].sort((a,b)=>b.length-a.length);
  return (line,level)=>{for(const v of ordered)line=line.split(v).join('[ocultado]');log(line,level);};
}
