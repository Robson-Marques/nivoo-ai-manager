import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RunResult } from '../../src/common/exec';
import { goldfishCliArgs,checkGoldfishCliContext,parseGoldfishCliResult } from '../../src/providers/goldfish-cli';
import { createGoldfishDispatch,goldfishTransportSupported } from '../../src/specialties/software/egm/review-http';
import type { AiProvider,ExecutionRequest } from '../../src/providers/provider.interface';
import type { GoldfishReviewerRequest } from '../../src/specialties/software/egm/review-pipeline';

function result(events:unknown[],overrides:Partial<RunResult>={}):RunResult{
  return {exitCode:0,stdout:events.map(e=>JSON.stringify(e)).join('\n'),stderr:'',timedOut:false,aborted:false,durationMs:50,...overrides};
}
const codexEvents=[
  {type:'thread.started',thread_id:'native-thread'},
  {type:'turn.started'},
  {type:'item.completed',item:{type:'agent_message',text:'Review findings'}},
  {type:'turn.completed',usage:{input_tokens:100,output_tokens:30,cached_input_tokens:10}},
];
const claudeEvents=[
  {type:'system',subtype:'init',session_id:'native-session',tools:[],mcp_servers:[]},
  {type:'assistant',message:{content:[{type:'text',text:'Review findings'}]}},
  {type:'result',subtype:'success',session_id:'native-session',result:'Review findings',total_cost_usd:0.002,usage:{input_tokens:100,output_tokens:30}},
];

describe('Goldfish dedicated CLI transport',()=>{
  it('builds only new nonpersistent read-only Codex sessions with no author tools',()=>{
    const args=goldfishCliArgs('codex','/tmp/review','model');
    expect(args).toEqual(expect.arrayContaining(['--ephemeral','--ignore-user-config','--ignore-rules','read-only','project_doc_max_bytes=0','features.memories=false','memories.use_memories=false','features.shell_tool=false','features.unified_exec=false','features.apps=false','features.multi_agent=false','features.hooks=false','mcp_servers={}']));
    expect(args).not.toContain('workspace-write');expect(args).not.toContain('resume');expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args.at(-1)).toBe('-');
  });
  it('builds restricted Claude sessions without tools, skills, chrome or history',()=>{
    const args=goldfishCliArgs('claude','/tmp/review');
    expect(args).toEqual(expect.arrayContaining(['--restricted','--strict-mcp-config','--no-session-persistence','--disable-slash-commands','--no-chrome','--disallowedTools','*']));
    expect(args[args.indexOf('--tools')+1]).toBe('');
    expect(args[args.indexOf('--max-turns')+1]).toBe('1');
    expect(args).not.toContain('--resume');expect(args).not.toContain('acceptEdits');
  });
  it('refuses inherited instructions without altering account files',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-egm-cli-test-'));
    try{
      const account=path.join(dir,'account'),cwd=path.join(dir,'review');
      fs.mkdirSync(account);fs.mkdirSync(cwd);
      fs.writeFileSync(path.join(account,'AGENTS.md'),'PRIVATE_PARENT');
      expect(checkGoldfishCliContext('codex',{CODEX_HOME:account,HOME:dir},cwd)).toMatch(/globais/);
      expect(fs.readFileSync(path.join(account,'AGENTS.md'),'utf8')).toBe('PRIVATE_PARENT');
      fs.writeFileSync(path.join(dir,'CLAUDE.md'),'PARENT');
      expect(checkGoldfishCliContext('claude',{HOME:dir},cwd)).toMatch(/árvore/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('requires actual native thread and turn completion for Codex',()=>{
    expect(parseGoldfishCliResult('codex',result(codexEvents))).toMatchObject({exitCode:0,sessionId:'native-thread',reviewIsolation:'cli-inline-v1',inputTokens:100});
    expect(parseGoldfishCliResult('codex',result(codexEvents.slice(1))).reviewIsolation).toBeUndefined();
    expect(parseGoldfishCliResult('codex',result(codexEvents.slice(0,-1))).reviewIsolation).toBeUndefined();
    expect(parseGoldfishCliResult('codex',result([...codexEvents,{type:'item.started',item:{type:'command_execution'}}]))).toMatchObject({resourceUnavailable:true});
    expect(parseGoldfishCliResult('codex',result(codexEvents,{aborted:true})).interrupted).toBe(true);
  });
  it('requires Claude init with empty tools and matching final session',()=>{
    expect(parseGoldfishCliResult('claude',result(claudeEvents))).toMatchObject({exitCode:0,sessionId:'native-session',reviewIsolation:'cli-inline-v1',costUsd:0.002});
    const offered=[{...claudeEvents[0],tools:['Read']},...claudeEvents.slice(1)];
    expect(parseGoldfishCliResult('claude',result(offered))).toMatchObject({resourceUnavailable:true});
    const mcp=[{...claudeEvents[0],mcp_servers:[{name:'external'}]},...claudeEvents.slice(1)];
    expect(parseGoldfishCliResult('claude',result(mcp)).reviewIsolation).toBeUndefined();
    expect(parseGoldfishCliResult('claude',result([...claudeEvents.slice(0,-1),{...claudeEvents[2],session_id:'other'}])).reviewIsolation).toBeUndefined();
    expect(parseGoldfishCliResult('claude',result(claudeEvents,{timedOut:true})).reviewIsolation).toBeUndefined();
  });
  it('routes CLI reviewers to their real native receipt, with no synthetic session identity',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-egm-cli-dispatch-'));
    try{
      const provider={id:'codex-cli',kind:'cli'} as AiProvider;
      const req:GoldfishReviewerRequest={stage:5,role:'egm-zoom-out',attempt:1,revision:'abc',persona:'Review',target:{path:'docs/spec.md',ranges:[{start:1,end:1,text:'# Spec'}]},baseline:[{path:'src/code.ts',content:'const x=1;'}],priorReports:[],access:'authorized-baseline',signal:new AbortController().signal};
      const base={provider,providerType:'codex-cli',root,jobId:'conversa',stepId:'c',deadline:Date.now()+60000,maxTurns:10,onLog:()=>undefined,onUsage:async()=>undefined,canContinue:()=>true};
      const missing=createGoldfishDispatch({...base,invoke:async()=>({exitCode:0,output:'not proof'})});
      expect((await missing(req)).status).toBe('unavailable');
      const dispatch=createGoldfishDispatch({...base,invoke:async(r:ExecutionRequest)=>{
        expect(r.context).toBe('');expect(r.mcp).toEqual([]);
        expect(r.options?.goldfishIsolatedReview).toBe(true);expect(r.instructions).toContain('const x=1;');
        return parseGoldfishCliResult('codex',result(codexEvents));
      }});
      expect(await dispatch(req)).toMatchObject({status:'completed',receipt:{sessionId:'native-thread'}});
      for(const id of ['codex-cli','codex-api','claude-code-cli','claude-api'])expect(goldfishTransportSupported(id)).toBe(true);
      expect(goldfishTransportSupported('gemini-api')).toBe(false);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
