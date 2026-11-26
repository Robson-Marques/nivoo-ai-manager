import { codexMcpSession } from '../../src/mcp/para-ia';
import { selectSessionMcp,supportsProjectMcp } from '../../src/mcp/session-policy';
import { observeMcpCalls,redactMcpLog } from '../../src/mcp/observe';
import type { McpResolvido } from '../../src/mcp/mcp';

const tools:McpResolvido[]=[
  {nome:'first',tipo:'comando',comando:'node',args:['server.js'],env:{API_KEY:'private-one'}},
  {nome:'second',tipo:'comando',comando:'node',args:['server.js'],env:{API_KEY:'private-two'}},
  {nome:'docs',tipo:'http',url:'https://example.invalid/mcp',headers:{Authorization:'Bearer private-three'}},
  {nome:'servidores-ssh',tipo:'comando',comando:'node',args:['ssh-mcp.js']},
];
describe('MCP session routing and credential transport',()=>{
  it('keeps separate values for identically named credentials and does not include them on argv',()=>{
    const session=codexMcpSession(tools);
    const args=session.args.join(' ');
    for(const secret of ['private-one','private-two','private-three'])expect(args).not.toContain(secret);
    expect(session.env).toEqual({NIVOO_MCP_SESSION_1:'private-one',NIVOO_MCP_SESSION_2:'private-two',NIVOO_MCP_SESSION_3:'Bearer private-three'});
    expect(args).toContain('env_vars=[{"name"="API_KEY","source"="NIVOO_MCP_SESSION_1"}]');
    expect(args).toContain('env_vars=[{"name"="API_KEY","source"="NIVOO_MCP_SESSION_2"}]');
    expect(args).toContain('env_http_headers={"Authorization"="NIVOO_MCP_SESSION_3"}');
    expect(args).toContain('shell_environment_policy.exclude');
    expect(session.args).toContain('--ignore-user-config');
    expect(codexMcpSession([]).args).toContain('mcp_servers={}');
    expect(codexMcpSession([]).env).toEqual({});
  });
  it('forwards only tools usable by the adapter and permitted by the session phase',()=>{
    for(const id of ['codex-cli','codex-api','claude-code-cli','claude-api','gemini-api','codex-cli--abcdef12']){
      expect(supportsProjectMcp(id)).toBe(true);
      expect(selectSessionMcp(id,tools,'execution')).toEqual(tools);
      expect(selectSessionMcp(id,tools,'planning')).toEqual([tools[3]]);
      expect(selectSessionMcp(id,tools,'review')).toEqual([]);
    }
    for(const id of ['nvidia-api','groq-free-api','openrouter-free-api','local-shell','gemini-image']){
      expect(supportsProjectMcp(id)).toBe(false);
      expect(selectSessionMcp(id,tools,'execution')).toEqual([]);
    }
  });
  it('redacts known credential values and bearer tokens without changing log levels',()=>{
    const log=jest.fn(),safe=redactMcpLog(tools,log);
    safe('private-one private-two Bearer private-three private-three','WARN');
    expect(log).toHaveBeenCalledWith('[ocultado] [ocultado] [ocultado] [ocultado]','WARN');
  });
});
describe('native MCP observation',()=>{
  it('tracks Codex item identity without arguments and reports failed result only once',()=>{
    const log=jest.fn(),observe=observeMcpCalls('codex',tools,log);
    const item={id:'i',type:'mcp_tool_call',server:'docs',tool:'lookup',arguments:{private:'DATA'}};
    expect(observe(JSON.stringify({type:'item.started',item}))).toBe(true);
    const completed=JSON.stringify({type:'item.completed',item:{...item,status:'failed',error:{message:'SECRET_RESULT'}}});
    expect(observe(completed)).toBe(true);observe(completed);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain('erro');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/DATA|SECRET_RESULT/);
    expect(observe(JSON.stringify({type:'item.completed',item:{...item,server:'unconfigured'}}))).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
  });
  it('correlates Claude calls and results by native tool ID',()=>{
    const log=jest.fn(),observe=observeMcpCalls('claude',tools,log);
    expect(observe(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'x',name:'mcp__docs__lookup',input:{secret:'DATA'}}]}}))).toBe(true);
    expect(observe(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'y',content:'UNRELATED'}]}}))).toBe(false);
    expect(observe(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'x',content:'SECRET_RESULT'}]}}))).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain('sucesso');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/DATA|SECRET_RESULT/);
  });
  it('does not infer successful Gemini calls from invocation alone',()=>{
    const log=jest.fn(),observe=observeMcpCalls('gemini',tools,log);
    expect(observe(JSON.stringify({type:'tool_use',tool_name:'mcp__docs__lookup',tool_id:'x',parameters:{secret:'DATA'}}))).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(observe(JSON.stringify({type:'tool_result',tool_id:'x',status:'error',output:'SECRET_RESULT'}))).toBe(true);
    expect(log.mock.calls[1][0]).toContain('erro');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/DATA|SECRET_RESULT/);
  });
});
