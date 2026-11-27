/** Exact tool names, not prefixes or wildcards. The server operator must
 * still be trusted: MCP names/annotations do not prove absence of effects. */
export function validateMcpToolNames(raw:unknown):string[]{
  if(!Array.isArray(raw)||raw.length>100||raw.some(n=>typeof n!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(n)))throw Error('Selecione nomes exatos de ferramentas MCP (máximo 100; sem curingas).');
  return [...new Set(raw as string[])];
}
export function defaultPlanningTools(url:string|undefined):string[]{
  // Only exact known HTTPS endpoints. No credentials, custom hosts, query
  // parameters or guesses based on the user-visible server name.
  if(url==='https://mcp.context7.com/mcp')return ['resolve-library-id','query-docs'];
  if(url==='https://21st.dev/api/mcp')return ['search'];
  return [];
}
export function allowedMcpToolNames(value:unknown):string[]{
  try{return validateMcpToolNames(value);}catch{return [];}
}
export function restrictedToolList(tools:unknown,allowed:ReadonlySet<string>):Record<string,unknown>[]{
  if(!Array.isArray(tools))throw Error('tools/list inválido.');
  const seen=new Set<string>(),result:Record<string,unknown>[]=[];
  for(const t of tools){
    if(!t||typeof t.name!=='string'||!t.name||!t.inputSchema||t.inputSchema.type!=='object')throw Error('Esquema de ferramenta MCP inválido.');
    if(!allowed.has(t.name))continue;
    if(seen.has(t.name))throw Error('Ferramenta MCP duplicada.');
    seen.add(t.name);result.push(t);
  }
  return result;
}
