import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { nomesTecnicos,ocultarSegredosMcp,paginaMcp,protocoloMcp,testarMcp,mcpDoProjeto,salvarMcp,type McpResolvido } from '../../src/mcp/mcp';
import { argsCodex,configClaude,serversGemini } from '../../src/mcp/para-ia';

describe('MCP inventory identity and discovery',()=>{
  it('allocates unique names for repeated labels, explicit suffixes and the reserved SSH name',()=>{
    const names=nomesTecnicos([{id:'1',nome:'GitHub'},{id:'2',nome:'GitHub'},{id:'3',nome:'GitHub'},{id:'4',nome:'GitHub 2'},{id:'5',nome:'Servidores SSH'}]);
    expect([...names.values()]).toEqual(['github','github-2','github-3','github-2-2','servidores-ssh-2']);
    expect(new Set(names.values()).size).toBe(5);
  });
  it('rejects duplicate or unsafe technical names before transport serialization',()=>{
    const a:McpResolvido={nome:'github',tipo:'http',url:'https://example.invalid/mcp'};
    for(const encode of [argsCodex,configClaude,serversGemini]){
      expect(()=>encode([a,a])).toThrow(/duplicado/);
      expect(()=>encode([{...a,nome:'constructor'}])).toThrow();
      expect(()=>encode([{...a,nome:'github.bad'}])).toThrow();
      expect(()=>encode([a,{...a,nome:'github-2'}])).not.toThrow();
    }
  });
  it('requires a valid initialize response with a supported protocol and tools capability',()=>{
    const init={jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}};
    expect(protocoloMcp(init)).toBe('2025-06-18');
    expect(()=>protocoloMcp({...init,id:2})).toThrow();
    expect(()=>protocoloMcp({...init,result:{...init.result,protocolVersion:'invalid'}})).toThrow();
    expect(()=>protocoloMcp({...init,result:{...init.result,capabilities:{}}})).toThrow();
    expect(()=>protocoloMcp({jsonrpc:'2.0',id:1,error:{code:-32601,message:'missing'}})).toThrow();
  });
  it('validates the requested response ID, tools array, schema and cursor rather than fabricating an empty list',()=>{
    const page={jsonrpc:'2.0',id:2,result:{tools:[{name:'lookup',description:'Read a record',inputSchema:{type:'object'}}],nextCursor:'page2'}};
    expect(paginaMcp(page,2)).toEqual({ferramentas:[{nome:'lookup',descricao:'Read a record'}],cursor:'page2'});
    expect(()=>paginaMcp(page,3)).toThrow();
    expect(()=>paginaMcp(null,2)).toThrow();
    expect(()=>paginaMcp({...page,result:{}},2)).toThrow();
    expect(()=>paginaMcp({...page,result:{tools:[{name:'lookup'}]}},2)).toThrow();
    expect(()=>paginaMcp({...page,result:{...page.result,nextCursor:4}},2)).toThrow();
    expect(paginaMcp({...page,result:{tools:[]}},2).ferramentas).toEqual([]);
  });
  it('redacts resolved environment and HTTP credentials, including bare bearer values',()=>{
    const r:McpResolvido={nome:'test',tipo:'http',url:'https://example.invalid',env:{API_KEY:'private-key-123'},headers:{Authorization:'Bearer private-token-456'}};
    const message=ocultarSegredosMcp('failed private-key-123 Bearer private-token-456 private-token-456',r);
    expect(message).not.toContain('private-key-123');
    expect(message).not.toContain('private-token-456');
    expect(message).toContain('[ocultado]');
  });
});

describe('MCP discovery transport and project scope',()=>{
  let root:string,previous:string|undefined;
  const server={id:'test',nome:'Docs',tipo:'http',url:'https://example.invalid/mcp',projetos:['p1'],ativo:true,criadaEm:'2026-11-25T00:00:00Z'};
  beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-mcp-discovery-'));
    previous=process.env.NIVOO_MCP_FILE;process.env.NIVOO_MCP_FILE=path.join(root,'mcp.json');
    fs.writeFileSync(process.env.NIVOO_MCP_FILE,JSON.stringify([server]));
  });
  afterEach(()=>{
    jest.restoreAllMocks();
    if(previous===undefined)delete process.env.NIVOO_MCP_FILE;else process.env.NIVOO_MCP_FILE=previous;
    fs.rmSync(root,{recursive:true,force:true});
  });
  it('does not broaden an invalid project scope to every project',()=>{
    for(const projetos of [null,'p2',{},[7]])expect(()=>salvarMcp({projetos},server.id)).toThrow(/Escopo/);
    expect(mcpDoProjeto('p1').some(s=>s.nome==='docs')).toBe(true);
    expect(mcpDoProjeto('p2').some(s=>s.nome==='docs')).toBe(false);
  });
  it('negotiates version, preserves session, paginates SSE and closes the session',async()=>{
    const json=(data:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json',...headers}});
    const tool=(name:string)=>({name,inputSchema:{type:'object'}});
    const spy=jest.spyOn(globalThis,'fetch')
      .mockResolvedValueOnce(json({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}},{'mcp-session-id':'s1'}))
      .mockResolvedValueOnce(new Response(null,{status:202}))
      .mockResolvedValueOnce(new Response('data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\ndata: '+JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[tool('first')],nextCursor:'next'}})+'\n\n',{headers:{'content-type':'text/event-stream'}}))
      .mockResolvedValueOnce(json({jsonrpc:'2.0',id:3,result:{tools:[tool('second')]}}))
      .mockResolvedValueOnce(new Response(null,{status:204}));
    const result=await testarMcp(server.id,5000);
    expect(result).toEqual({ok:true,ferramentas:[{nome:'first',descricao:''},{nome:'second',descricao:''}]});
    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy.mock.calls[1][1]?.headers).toMatchObject({'Mcp-Session-Id':'s1','MCP-Protocol-Version':'2025-06-18'});
    expect(JSON.parse(String(spy.mock.calls[3][1]?.body))).toMatchObject({id:3,params:{cursor:'next'}});
    expect(spy.mock.calls[4][1]).toMatchObject({method:'DELETE',redirect:'error'});
  });
  it('does not report a malformed successful HTTP response as a connected tool',async()=>{
    jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}));
    const result=await testarMcp(server.id,5000);
    expect(result).toMatchObject({ok:false,ferramentas:[]});
  });
});
