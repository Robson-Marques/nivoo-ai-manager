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

const toml = (v: string) => JSON.stringify(v); // string básica TOML (mesmas regras de escape do JSON)
const tabela = (o: Record<string, string>) => `{${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}`;

/** Codex: sobrescritas `-c mcp_servers.<nome>.…` (só para esta execução; o config.toml não muda). */
export function argsCodex(mcp: McpResolvido[]): string[] {
  assertMcpNames(mcp);
  const out: string[] = [];
  for (const m of mcp) {
    const p = `mcp_servers.${m.nome}`;
    if (m.tipo === 'comando') {
      out.push('-c', `${p}.command=${toml(m.comando!)}`, '-c', `${p}.args=[${(m.args ?? []).map(toml).join(',')}]`);
      if (m.env && Object.keys(m.env).length) out.push('-c', `${p}.env=${tabela(m.env)}`);
    } else {
      out.push('-c', `${p}.url=${toml(m.url!)}`);
      if (m.headers && Object.keys(m.headers).length) out.push('-c', `${p}.http_headers=${tabela(m.headers)}`);
    }
  }
  return out;
}

/** Gemini CLI: `mcpServers` do settings.json (num HOME só desta sessão). */
export function serversGemini(mcp: McpResolvido[]): Record<string, unknown> {
  assertMcpNames(mcp);
  const s: Record<string, unknown> = {};
  for (const m of mcp) s[m.nome] = m.tipo === 'comando' ? { command: m.comando, args: m.args ?? [], env: m.env ?? {}, trust: true } : { httpUrl: m.url, headers: m.headers ?? {}, trust: true };
  return s;
}
