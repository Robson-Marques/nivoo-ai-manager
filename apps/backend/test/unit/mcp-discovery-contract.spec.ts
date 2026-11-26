import { nomesTecnicos,ocultarSegredosMcp,paginaMcp,protocoloMcp,type McpResolvido } from '../../src/mcp/mcp';
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
