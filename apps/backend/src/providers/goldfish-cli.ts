import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runProcess } from '../common/exec';
import type { ExecutionRequest,ExecutionResult } from './provider.interface';
import { buildPrompt,looksLikeResourceProblem } from './provider.interface';

export type ReviewCli='codex'|'claude';
export const GOLD_FISH_CODEX_CONFIG=[
  'project_doc_max_bytes=0','approval_policy="never"','web_search="disabled"',
  'features.shell_tool=false','features.unified_exec=false','features.memories=false',
  'memories.use_memories=false','memories.generate_memories=false',
  'features.multi_agent=false','features.apps=false','features.hooks=false',
  'features.view_image=false','features.image_generation=false','features.plugins=false',
  'features.multi_agent_v2=false','features.code_mode=false','features.tool_search=false',
  'features.goals=false','features.skip_host_skill_discovery=true','features.omit_skill_descriptions=true',
  'features.skill_mcp_dependency_install=false','features.remote_plugin=false','features.standalone_web_search=false',
  'features.apply_patch_freeform=false','features.request_permissions_tool=false',
  'mcp_servers={}',
] as const;

export function goldfishCliArgs(type:ReviewCli,cwd:string,model?:string):string[]{
  if(type==='codex')return [
    'exec','--json','--ephemeral','--ignore-user-config','--ignore-rules',
    '--sandbox','read-only','--skip-git-repo-check','-C',cwd,
    ...GOLD_FISH_CODEX_CONFIG.flatMap(c=>['-c',c]),...(model?['--model',model]:[]),'-',
  ];
  return ['-p','--output-format','stream-json','--verbose','--restricted',
    '--strict-mcp-config','--permission-mode','default','--tools','',
    '--disallowedTools','*','--disable-slash-commands','--no-session-persistence','--no-chrome',
    '--max-turns','1',...(model?['--model',model]:[])];
}

function unavailable(reason:string):ExecutionResult{return {exitCode:1,output:'',resourceUnavailable:true,error:reason,stopReason:'goldfish_isolation',usagePartial:true};}

/** Reject inherited agent instructions, including global Codex instructions.
 * Do not move, delete, read or copy account files. Authentication remains
 * with the selected official CLI, never in the prompt or the reviewer cwd. */
export function checkGoldfishCliContext(type:ReviewCli,env:NodeJS.ProcessEnv,cwd:string):string|null{
  const home=env.HOME||os.homedir();
  const global=type==='codex'?(env.CODEX_HOME||path.join(home,'.codex')):(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'));
  if(type==='codex'){
    for(const file of ['/etc/codex/config.toml','/etc/codex/requirements.toml']){
      if(fs.existsSync(file))return 'Configuração gerenciada do Codex presente; precedência das restrições de revisão não validada.';
    }
    for(const file of ['AGENTS.md','AGENTS.override.md']){
      if(fs.existsSync(path.join(global,file)))return 'Instruções globais do Codex presentes; exclusão ainda não comprovada neste ambiente.';
    }
  }
  // The reviewer is given a fresh empty directory outside the project tree.
  // Reject inherited instructions in any ancestor, not merely the current dir.
  let parent=path.resolve(cwd);
  for(;;){
    for(const file of ['AGENTS.md','AGENTS.override.md','CLAUDE.md','CLAUDE.local.md']){
      if(fs.existsSync(path.join(parent,file)))return 'Instruções de agente encontradas na árvore de diretórios do revisor.';
    }
    const next=path.dirname(parent);if(next===parent)break;parent=next;
  }
  return null;
}

type ProcessResult=Awaited<ReturnType<typeof runProcess>>;
/** Parse native JSON events only. Never use a fallback transcript as a report.
 * A tool event invalidates the run: inline input requires no tool execution. */
export function parseGoldfishCliResult(type:ReviewCli,r:ProcessResult):ExecutionResult{
  if(r.aborted)return {exitCode:-1,output:'',interrupted:true,error:'interrompido',usagePartial:true};
  if(r.spawnError)return unavailable('CLI de revisão indisponível.');
  const events:Record<string,any>[]=[];
  for(const line of r.stdout.split('\n')){
    if(!line.trim())continue;
    try{const v=JSON.parse(line);if(v&&typeof v==='object'&&!Array.isArray(v))events.push(v);}
    catch{return unavailable('Fluxo de eventos do revisor inválido.');}
  }
  if(type==='codex'){
    const ids=new Set(events.filter(e=>e.type==='thread.started').map(e=>e.thread_id).filter(x=>typeof x==='string'&&x));
    const completed=events.filter(e=>e.type==='turn.completed');
    const messages=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message');
    const tools=events.some(e=>/^item\./.test(e.type??'')&&e.item&&!['agent_message','reasoning'].includes(e.item.type));
    const usage=completed.at(-1)?.usage;
    const accounting={inputTokens:usage?.input_tokens,outputTokens:usage?.output_tokens,cacheReadInputTokens:usage?.cached_input_tokens,usagePartial:completed.length!==1||r.timedOut};
    if(tools)return {...unavailable('Codex apresentou evento de ferramenta em revisão sem ferramentas.'),...accounting};
    if(r.timedOut)return {exitCode:1,output:'',error:'Tempo do revisor esgotado.',...accounting};
    const error=events.some(e=>e.type==='error'||e.type==='turn.failed');
    if(r.exitCode!==0||error)return {exitCode:1,output:'',error:'Codex não concluiu a revisão.',resourceUnavailable:looksLikeResourceProblem(r.stderr),...accounting};
    const output=messages.at(-1)?.item?.text;
    if(ids.size!==1||completed.length!==1||typeof output!=='string'||!output.trim())return {...unavailable('Codex não comprovou thread nova e encerramento completo.'),...accounting};
    return {exitCode:0,output,sessionId:[...ids][0] as string,reviewIsolation:'cli-inline-v1',stopReason:'completed',...accounting};
  }
  const final=events.filter(e=>e.type==='result').at(-1);
  const init=events.filter(e=>e.type==='system'&&e.subtype==='init');
  const tools=events.some(e=>e.type==='assistant'&&Array.isArray(e.message?.content)&&e.message.content.some((x:any)=>x.type==='tool_use'||x.type==='server_tool_use'));
  const offered=init.some(e=>Array.isArray(e.tools)&&e.tools.length>0||Array.isArray(e.mcp_servers)&&e.mcp_servers.length>0);
  const accounting={costUsd:typeof final?.total_cost_usd==='number'?final.total_cost_usd:undefined,
    inputTokens:final?.usage?.input_tokens,outputTokens:final?.usage?.output_tokens,
    cacheReadInputTokens:final?.usage?.cache_read_input_tokens,cacheWriteInputTokens:final?.usage?.cache_creation_input_tokens,
    inputExcludesCache:true,usagePartial:!final||r.timedOut};
  if(tools||offered)return {...unavailable('Claude apresentou ferramentas ou servidores MCP em revisão sem ferramentas.'),...accounting};
  if(r.timedOut)return {exitCode:1,output:'',error:'Tempo do revisor esgotado.',...accounting};
  if(r.exitCode!==0||final?.is_error||final?.subtype!=='success')return {exitCode:1,output:'',error:'Claude não concluiu a revisão.',resourceUnavailable:looksLikeResourceProblem(r.stderr),...accounting};
  if(init.length!==1||!Array.isArray(init[0].tools)||!Array.isArray(init[0].mcp_servers)||typeof final.session_id!=='string'||!final.session_id||init[0].session_id!==final.session_id||typeof final.result!=='string'||!final.result.trim())return {...unavailable('Claude não comprovou sessão nova, ferramentas vazias e encerramento completo.'),...accounting};
  return {exitCode:0,output:final.result,sessionId:final.session_id,reviewIsolation:'cli-inline-v1',stopReason:'completed',...accounting};
}

/** CLI-only transport with inline, bounded inputs, no project files exposed.
 * Version compatibility is checked without opening a model session. No fallback
 * to a permissive CLI mode. The real-host isolation probe is still required. */
export async function executeGoldfishCli(type:ReviewCli,bin:string,env:NodeJS.ProcessEnv,req:ExecutionRequest):Promise<ExecutionResult>{
  if(req.mcp?.length||req.options?.images?.length||req.options?.visualAsset||req.context||req.projectMediaDir)return unavailable('Entrada indevida no transporte isolado.');
  const prompt=buildPrompt(req);
  if(Buffer.byteLength(prompt)>160*1024)return unavailable('Entrada integral acima do limite do transporte CLI; não foi truncada.');
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-goldfish-cli-'));
  const deadline=Date.now()+req.timeoutMs;
  try{
    const contextError=checkGoldfishCliContext(type,env,cwd);
    if(contextError)return unavailable(contextError);
    const help=await runProcess(bin,type==='codex'?['exec','--help']:['--help'],{cwd,env,timeoutMs:Math.max(1,Math.min(15000,deadline-Date.now())),signal:req.signal});
    if(req.signal.aborted||help.aborted)return {exitCode:-1,output:'',interrupted:true,error:'interrompido',usagePartial:true};
    const required=type==='codex'?['--ephemeral','--ignore-user-config','--ignore-rules','--sandbox','--json']:['--restricted','--strict-mcp-config','--no-session-persistence','--tools','--disable-slash-commands','--no-chrome'];
    if(help.exitCode!==0||!required.every(flag=>help.stdout.includes(flag)))return unavailable('Versão do CLI não anuncia todas as opções de isolamento necessárias.');
    if(Date.now()>=deadline)return unavailable('Tempo de revisão esgotado antes da chamada.');
    const args=goldfishCliArgs(type,cwd,req.options?.model);
    req.onLog('Goldfish CLI: sessão nova, entrada inline, sem ferramentas, '+type);
    const r=await runProcess(bin,args,{cwd,env,input:prompt,timeoutMs:Math.max(1,deadline-Date.now()),signal:req.signal,onSpawn:req.onSpawn});
    return parseGoldfishCliResult(type,r);
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
