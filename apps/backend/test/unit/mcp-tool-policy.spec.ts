import { defaultPlanningTools,validateMcpToolNames,restrictedToolList } from '../../src/mcp/tool-policy';
import { RestrictedHttpMcp,handleRestrictedMcp,restrictHttpMcp } from '../../src/mcp/restricted-http';
import { selectSessionMcp } from '../../src/mcp/session-policy';
import { codexMcpSession,configClaude,serversGemini } from '../../src/mcp/para-ia';
import type { McpResolvido } from '../../src/mcp/mcp';

const docs:McpResolvido={nome:'docs',tipo:'http',url:'https://mcp.context7.com/mcp',headers:{CONTEXT7_API_KEY:'private-token'}};
const catalog:McpResolvido={nome:'catalog',tipo:'http',url:'https://21st.dev/api/mcp'};
const tool=(name:string)=>({name,inputSchema:{type:'object',properties:{query:{type:'string'}}}});
describe('MCP tool permissions and defaults',()=>{
  it('enables only documented consultative names at exact known endpoints',()=>{
    expect(defaultPlanningTools(docs.url)).toEqual(['resolve-library-id','query-docs']);
    expect(defaultPlanningTools(catalog.url)).toEqual(['search']);
    for(const url of ['https://example.invalid/mcp','https://mcp.context7.com/mcp?other=1','http://mcp.context7.com/mcp','https://mcp.context7.com.evil.invalid/mcp'])expect(defaultPlanningTools(url)).toEqual([]);
    expect(validateMcpToolNames(['search','search'])).toEqual(['search']);
    expect(()=>validateMcpToolNames(['search*'])).toThrow();
    expect(()=>validateMcpToolNames('search')).toThrow();
  });
  it('filters all three CLIs via a local stdio bridge, not model instructions',()=>{
    for(const id of ['codex-cli','claude-code-cli','gemini-api']){
      const result=selectSessionMcp(id,[docs,catalog],'planning');
      expect(result.map(m=>m.ferramentasPermitidas)).toEqual([['resolve-library-id','query-docs'],['search']]);
      expect(result.every(m=>m.tipo==='comando'&&m.args?.[0].endsWith('restricted-http-main.js'))).toBe(true);
      expect(selectSessionMcp(id,[{...docs,ferramentasPlanejamento:[]}],'planning')).toEqual([]);
      expect(selectSessionMcp(id,[docs],'execution')).toEqual([docs]);
      expect(selectSessionMcp(id,[{...docs,ferramentasExecucao:[]}],'execution')).toEqual([]);
      expect(selectSessionMcp(id,[{...docs,ferramentasExecucao:['query-docs']}],'execution')[0].ferramentasPermitidas).toEqual(['query-docs']);
      expect(selectSessionMcp(id,[docs],'review')).toEqual([]);
    }
    const bridge=restrictHttpMcp(docs,['query-docs']);
    expect(JSON.stringify(bridge.args)).not.toContain('private-token');
    expect(codexMcpSession([bridge]).args.join(' ')).not.toContain('private-token');
    expect(configClaude([bridge]).mcpServers.docs).toMatchObject({command:process.execPath});
    expect(serversGemini([bridge]).docs).toMatchObject({command:process.execPath});
    expect(bridge.env?.NIVOO_MCP_BRIDGE_HEADER_0).toBe('private-token');
  });
  it('does not expose arbitrary stdio servers in planning or unimplemented HTTP adapters',()=>{
    const stdio:McpResolvido={nome:'other',tipo:'comando',comando:'node',ferramentasPlanejamento:['read']};
    expect(selectSessionMcp('codex-cli',[stdio],'planning')).toEqual([]);
    expect(selectSessionMcp('nvidia-api',[docs],'execution')).toEqual([]);
    expect(restrictedToolList([tool('query-docs'),tool('delete')],new Set(['query-docs']))).toEqual([tool('query-docs')]);
    expect(()=>restrictedToolList([tool('query-docs'),tool('query-docs')],new Set(['query-docs']))).toThrow();
  });
});
describe('MCP runtime call authorization',()=>{
  const fixture=()=>{
    const request=jest.fn(async (_url:any,init:any)=>{
      if(init.method==='DELETE')return new Response(null,{status:204});
      const m=JSON.parse(init.body);
      if(m.method==='notifications/initialized')return new Response(null,{status:202});
      let result:any;
      if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture'}};
      else if(m.method==='tools/list')result=m.params.cursor?{tools:[tool('query-docs')]}:{tools:[tool('delete_record'),tool('search')],nextCursor:'next'};
      else if(m.method==='tools/call')result={content:[{type:'text',text:'actual docs'}]};
      else throw Error('unexpected method');
      const msg={jsonrpc:'2.0',id:m.id,result};
      return m.method==='tools/list'&&!m.params.cursor?new Response('data: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/message'})+'\n\ndata: '+JSON.stringify(msg)+'\n\n',{headers:{'content-type':'text/event-stream'}}):new Response(JSON.stringify(msg),{headers:{'content-type':'application/json','mcp-session-id':'s1'}});
    });
    const report=jest.fn();
    const client=new RestrictedHttpMcp(docs.url!,docs.headers!,['search','query-docs','missing'],request as unknown as typeof fetch,report);
    const call=(id:number,method:string,params:unknown={})=>handleRestrictedMcp(client,{jsonrpc:'2.0',id,method,params});
    return {client,request,call,report};
  };
  it('discovers only permitted tools, forwards real results and uses the negotiated session',async()=>{
    const {client,request,call,report}=fixture();
    expect(await call(1,'initialize',{protocolVersion:'2025-06-18'})).toMatchObject({result:{capabilities:{tools:{}}}});
    expect(request).not.toHaveBeenCalled();
    expect(await call(2,'tools/list')).toMatchObject({result:{tools:[tool('search'),tool('query-docs')]}});
    expect(report).toHaveBeenCalledWith(expect.stringContaining('não localizadas: missing'));
    expect(await call(3,'tools/call',{name:'query-docs',arguments:{query:'schema'}})).toMatchObject({result:{content:[{text:'actual docs'}]}});
    const last=request.mock.calls[request.mock.calls.length-1][1];
    expect(JSON.parse(last.body)).toMatchObject({method:'tools/call',params:{name:'query-docs',arguments:{query:'schema'}}});
    expect(last.headers).toMatchObject({'Mcp-Session-Id':'s1','MCP-Protocol-Version':'2025-06-18',CONTEXT7_API_KEY:'private-token'});
    await client.close();
    expect(request.mock.calls[request.mock.calls.length-1][1].method).toBe('DELETE');
  });
  it('rejects undiscovered, unauthorized or arbitrary methods before sending any remote call',async()=>{
    const {request,call}=fixture();
    expect(await call(1,'tools/call',{name:'query-docs'})).toHaveProperty('error');
    expect(request).not.toHaveBeenCalled();
    await call(2,'tools/list');
    const count=request.mock.calls.length;
    for(const name of ['delete_record','missing','query-docs-extra'])expect(await call(3,'tools/call',{name})).toHaveProperty('error');
    expect(await call(4,'resources/read',{uri:'secret'})).toHaveProperty('error');
    expect(await call(5,'tools/call',{name:'search',arguments:'bad'})).toHaveProperty('error');
    expect(request).toHaveBeenCalledTimes(count);
  });
  it('does not turn an invalid remote response into an available inventory',async()=>{
    const request=jest.fn(async()=>new Response('{}'));
    const client=new RestrictedHttpMcp(docs.url!,{},['search'],request as unknown as typeof fetch);
    expect(await handleRestrictedMcp(client,{jsonrpc:'2.0',id:1,method:'tools/list'})).toHaveProperty('error');
    await expect(client.call('search',{})).rejects.toThrow(/não autorizada/);
  });
});
