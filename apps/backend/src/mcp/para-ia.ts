import type { McpResolvido } from './mcp';

/** Ferramentas MCP do projeto no formato de cada IA. */
export function assertMcpNames(mcp:readonly McpResolvido[]):void{
  const seen=new Set<string>();
  for(const m of mcp){
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(m.nome)||m.nome==='constructor'||m.nome==='prototype'||seen.has(m.nome))throw Error('Identificador MCP inválido ou duplicado.');
    seen.add(m.nome);
  }
}

/** Claude Code: arquivo passado em --mcp-config (com --strict-mcp-config, só estes valem). */
export function configClaude(mcp: McpResolvido[]): { mcpServers: Record<string, unknown> } {
  assertMcpNames(mcp);
  const mcpServers: Record<string, unknown> = {};
  for (const m of mcp) {
    mcpServers[m.nome] = m.tipo === 'comando' ? { command: m.comando, args: m.args ?? [], env: m.env ?? {} } : { type: 'http', url: m.url, headers: m.headers ?? {} };
  }
  return { mcpServers };
}

/** Claude Code: libera todas as ferramentas de cada servidor (mcp__<nome>). */
export function permissoesClaude(mcp: McpResolvido[]): string[] {
  return mcp.map((m) => `mcp__${m.nome}`);
}

const toml=(v:string)=>JSON.stringify(v);
const tabela=(o:Record<string,string>)=>'{'+Object.entries(o).map(([k,v])=>toml(k)+'='+toml(v)).join(',')+'}';
export type CodexMcpSession={args:string[];env:Record<string,string>};
/** Codex 0.172.0 RawMcpServerConfig/McpServerEnvVar accepts env_vars
 * {name,source} and env_http_headers. Never put resolved credential
 * values on argv. Per-server aliases avoid collisions on API_KEY, etc. */
export function codexMcpSession(mcp:McpResolvido[]):CodexMcpSession{
  assertMcpNames(mcp);
  const env:Record<string,string>={},entries:string[]=[];
  let index=0;
  const alias=(value:string)=>{
    const key='NIVOO_MCP_SESSION_'+(++index);
    env[key]=value;return key;
  };
  for(const m of mcp){
    const fields:string[]=[];
    if(m.tipo==='comando'){
      fields.push('command='+toml(m.comando!),'args=['+(m.args??[]).map(toml).join(',')+']');
      if(m.env&&Object.keys(m.env).length)fields.push('env_vars=['+Object.entries(m.env).map(([name,value])=>tabela({name,source:alias(value)})).join(',')+']');
    }else{
      fields.push('url='+toml(m.url!));
      if(m.headers&&Object.keys(m.headers).length)fields.push('env_http_headers='+tabela(Object.fromEntries(Object.entries(m.headers).map(([name,value])=>[name,alias(value)]))));
    }
    entries.push(toml(m.nome)+'={'+fields.join(',')+'}');
  }
  // Ignore user-level configuration (including MCP) and restrict the shell's
  // inherited environment. System-managed configuration may still apply.
  // Keep account authentication in its existing CODEX_HOME.
  return {args:['--ignore-user-config','-c','mcp_servers={'+entries.join(',')+'}','-c','shell_environment_policy.exclude=["NIVOO_MCP_SESSION_*"]'],env};
}
/** Gemini CLI: `mcpServers` do settings.json (num HOME só desta sessão). */
export function serversGemini(mcp: McpResolvido[]): Record<string, unknown> {
  assertMcpNames(mcp);
  const s: Record<string, unknown> = {};
  for (const m of mcp) s[m.nome] = m.tipo === 'comando' ? { command: m.comando, args: m.args ?? [], env: m.env ?? {}, trust: true } : { httpUrl: m.url, headers: m.headers ?? {}, trust: true };
  return s;
}
