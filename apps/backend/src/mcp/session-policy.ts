import { tipoDe } from '../accounts/connections';
import { mcpDoProjeto,type McpResolvido } from './mcp';

const supported=new Set(['codex-cli','codex-api','claude-code-cli','claude-api','gemini-api']);
export function supportsProjectMcp(providerId:string):boolean{return supported.has(tipoDe(providerId)??'');}
/** Planning and execution have distinct origins. Planning grants no new
 * approval to mutate external systems; configured servers can nevertheless
 * expose side effects. Until an explicit tool-level policy exists, do not
 * expose arbitrary external servers to an unapproved planning session.
 * The internal SSH server has a separate per-command approval gate. */
export function selectSessionMcp(providerId:string,tools:readonly McpResolvido[],phase:'planning'|'execution'|'review'):McpResolvido[]{
  if(!supportsProjectMcp(providerId)||phase==='review')return [];
  return tools.filter(m=>phase==='execution'||m.nome==='servidores-ssh');
}
export function projectSessionMcp(providerId:string,projectId:string,phase:'planning'|'execution'|'review',origin:{jobId?:string;mensagemId?:string}={}):McpResolvido[]{
  if(!supportsProjectMcp(providerId)||phase==='review')return [];
  return selectSessionMcp(providerId,mcpDoProjeto(projectId,origin),phase);
}
