import { tipoDe } from '../accounts/connections';
import { mcpDoProjeto,type McpResolvido } from './mcp';
import { restrictHttpMcp } from './restricted-http';
import { allowedMcpToolNames,defaultPlanningTools } from './tool-policy';

const supported=new Set(['codex-cli','codex-api','claude-code-cli','claude-api','gemini-api']);
export function supportsProjectMcp(providerId:string):boolean{return supported.has(tipoDe(providerId)??'');}
/** Planning and execution have distinct origins. Planning grants no new
 * approval to mutate external systems. Restricted HTTP servers are exposed
 * through a filtered bridge, not just a prompt or CLI allow rule.
 * The internal SSH server has a separate per-command approval gate. */
export function selectSessionMcp(providerId:string,tools:readonly McpResolvido[],phase:'planning'|'execution'|'review'):McpResolvido[]{
  if(!supportsProjectMcp(providerId)||phase==='review')return [];
  const selected:McpResolvido[]=[];
  for(const m of tools){
    if(m.nome==='servidores-ssh'){selected.push(m);continue;}
    if(phase==='execution'&&m.ferramentasExecucao===undefined){selected.push(m);continue;}
    if(m.tipo!=='http')continue;
    const raw=phase==='planning'?(m.ferramentasPlanejamento??defaultPlanningTools(m.url)):m.ferramentasExecucao;
    const allowed=allowedMcpToolNames(raw);
    if(allowed.length)selected.push(restrictHttpMcp(m,allowed));
  }
  return selected;
}
export function projectSessionMcp(providerId:string,projectId:string,phase:'planning'|'execution'|'review',origin:{jobId?:string;mensagemId?:string}={}):McpResolvido[]{
  if(!supportsProjectMcp(providerId)||phase==='review')return [];
  return selectSessionMcp(providerId,mcpDoProjeto(projectId,origin),phase);
}
