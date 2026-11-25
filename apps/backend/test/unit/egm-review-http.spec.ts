import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AiProvider,ExecutionRequest,ExecutionResult } from '../../src/providers/provider.interface';
import { executeFileTool } from '../../src/providers/agent-file-tools';
import { createHttpGoldfishDispatch,goldfishHttpSupported,loadGoldfishTarget,parseGoldfishTarget,renderGoldfishRun } from '../../src/specialties/software/egm/review-http';
import type { GoldfishReviewerRequest,GoldfishRunResult } from '../../src/specialties/software/egm/review-pipeline';

const provider={id:'nvidia-api',label:'NVIDIA',kind:'api'} as AiProvider;
const signal=new AbortController().signal;
function request(overrides:Partial<GoldfishReviewerRequest>={}):GoldfishReviewerRequest{
  return {stage:6,role:'egm-comprehension',attempt:1,revision:'abc',persona:'Read the document',target:{path:'docs/design.md',ranges:[{start:1,end:2,text:'# Design\nOnly document'}]},baseline:[],priorReports:[],access:'document-only',signal,...overrides};
}
const success:ExecutionResult={exitCode:0,output:'Actual reviewer report',inputTokens:20,outputTokens:10};

describe('Goldfish HTTP integration',()=>{
  let dir:string;
  beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-egm-http-'));});
  afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const put=(p:string,content:string)=>{const file=path.join(dir,p);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);};

  it('admits a committed markdown target and only safe linked text, not external links or session state',()=>{
    put('docs/design.md','# Design\n[code](../src/f.ts)\n[private](../.nivoo/memoria.md)\n[external](https://example.org/file)\n[missing](missing.md)\n## Implementation Plan\nChange f.');
    put('src/f.ts','export const f=1;');put('.nivoo/memoria.md','PARENT_ONLY');
    fs.symlinkSync(path.join(dir,'.nivoo/memoria.md'),path.join(dir,'docs/alias.md'));
    fs.appendFileSync(path.join(dir,'docs/design.md'),'\n[alias](alias.md)');
    const loaded=loadGoldfishTarget(dir,'docs/design.md');
    expect(loaded.preset).toBe('uninterrupted');
    expect(loaded.baseline).toEqual([{path:'src/f.ts',content:'export const f=1;'}]);
    expect(loaded.omitted).toEqual(['../.nivoo/memoria.md','https://example.org/file','missing.md','alias.md']);
    expect(parseGoldfishTarget('--mode feature_spec "docs/my design.md"')).toEqual({path:'docs/my design.md',preset:'feature_spec'});
    expect(()=>parseGoldfishTarget('../outside.md')).toThrow();
    expect(()=>parseGoldfishTarget('.nivoo/memoria.md')).toThrow();
    expect(()=>parseGoldfishTarget('--mode 8 docs/design.md')).toThrow();
    expect(()=>loadGoldfishTarget(dir,'docs/alias.md')).toThrow(/simbólico/);
  });
  it('uses a fresh directory with no parent memory, only the selected document and read-only tools',async()=>{
    put('parent.txt','PARENT_ONLY');
    const sessions:string[]=[],dirs:string[]=[];
    const usage:ExecutionResult[]=[];
    const invoke=async(req:ExecutionRequest)=>{
      sessions.push(req.attemptId);dirs.push(req.cwd);
      expect(req.context).toBe('');
      expect(req.instructions).not.toContain('PARENT_ONLY');
      expect(req.systemPrompt).not.toContain('PARENT_ONLY');
      expect(req.mcp).toEqual([]);
      expect(req.options?.readOnlyReview).toBe(true);
      expect(req.options?.images).toEqual([]);
      expect(fs.readdirSync(req.cwd)).toEqual(['docs']);
      expect(fs.readFileSync(path.join(req.cwd,'docs/design.md'),'utf8')).toBe('# Design\nOnly document');
      expect(()=>executeFileTool(req.cwd,'ler_arquivo',{caminho:'../parent.txt'},true)).toThrow();
      expect(()=>executeFileTool(req.cwd,'escrever_arquivo',{caminho:'docs/design.md',conteudo:'bad'},true)).toThrow();
      return success;
    };
    const dispatch=createHttpGoldfishDispatch({provider,providerType:'nvidia-api',root:dir,jobId:'conversa',stepId:'c',deadline:Date.now()+60000,maxTurns:10,onLog:()=>undefined,invoke,onUsage:async r=>{usage.push(r);},canContinue:()=>true});
    const result=await Promise.all([dispatch(request()),dispatch(request({attempt:2}))]);
    expect(result.every(r=>r.status==='completed')).toBe(true);
    expect(new Set(sessions).size).toBe(2);
    expect(new Set(dirs).size).toBe(2);
    expect(dirs.every(d=>!fs.existsSync(d))).toBe(true);
    expect(usage).toEqual([success,success]);
  });
  it('preserves source line numbers and only admits authorized baseline files in design phases',async()=>{
    const dispatch=createHttpGoldfishDispatch({provider,providerType:'nvidia-api',root:dir,jobId:'conversa',stepId:'c',deadline:Date.now()+60000,maxTurns:10,onLog:()=>undefined,onUsage:async()=>undefined,canContinue:()=>true,invoke:async req=>{
      expect(fs.readFileSync(path.join(req.cwd,'docs/design.md'),'utf8')).toBe('\n\n## Implementation Plan\nDo work');
      expect(fs.readFileSync(path.join(req.cwd,'src/f.ts'),'utf8')).toBe('export const f=1;');
      expect(req.instructions).toContain('## Pareceres anteriores autorizados');
      return success;
    }});
    expect((await dispatch(request({stage:9,access:'authorized-baseline',target:{path:'docs/design.md',ranges:[{start:3,end:4,text:'## Implementation Plan\nDo work'}]},baseline:[{path:'src/f.ts',content:'export const f=1;'}],priorReports:[{path:'report.md',content:'review'}]}))).status).toBe('completed');
  });
  it('does not replay queued reviewers after provider unavailability or admit an unsupported CLI',async()=>{
    let calls=0;
    const opts={provider,root:dir,jobId:'conversa',stepId:'c',deadline:Date.now()+60000,maxTurns:10,onLog:()=>undefined,onUsage:async()=>undefined,canContinue:()=>true,invoke:async()=>{calls++;return {exitCode:1,output:'',resourceUnavailable:true,error:'quota'};}};
    const dispatch=createHttpGoldfishDispatch({...opts,providerType:'nvidia-api'});
    const results=await Promise.all([dispatch(request()),dispatch(request())]);
    expect(results.map(r=>r.status)).toEqual(['unavailable','unavailable']);
    expect(calls).toBe(1);
    expect((await createHttpGoldfishDispatch({...opts,providerType:'codex-cli'})(request())).status).toBe('unavailable');
    expect(calls).toBe(1);
    expect(goldfishHttpSupported('groq-free-api')).toBe(true);
    expect(goldfishHttpSupported('openrouter-free-api')).toBe(true);
    expect(goldfishHttpSupported('claude-code-cli')).toBe(false);
  });
  it('explicitly reports missing review coverage and unknown monetary usage',()=>{
    const run:GoldfishRunResult={status:'incomplete',preset:5,revision:'abc',phases:[],pendingStages:[5],coverage:'single-stage',approved:false};
    const result=renderGoldfishRun(run,['missing.md'],false);
    expect(result).toContain('Fases não concluídas: 5');
    expect(result).toContain('missing.md');
    expect(result).toContain('Custo integral não informado');
  });
});
