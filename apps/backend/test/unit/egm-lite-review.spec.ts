import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { liteRequest,litePlanTarget,liteDiffTarget,parseLiteResult,runLiteReview } from '../../src/specialties/software/egm/lite-review';
import type { GoldfishReviewerRequest } from '../../src/specialties/software/egm/review-pipeline';
import { goldfishMessageWriter } from '../../src/specialties/software/egm/review-persistence';
import type { PrismaService } from '../../src/prisma/prisma.service';

const id='12345678-1234-1234-1234-123456789abc';
const signal=new AbortController().signal;
const plan={objective:'Correct invoice calculation',steps:[{key:'fix',instructions:'Modify invoice.ts',verifyCommand:'npm test'}],criteria:[{key:'tests',kind:'COMMAND',config:{command:'npm test'}}],authorMemory:'PRIVATE_HISTORY'};
const target=litePlanTarget(plan,'One invoice per card.');
describe('EGM Lite independent review contract',()=>{
  it('accepts explicit source IDs and refuses missing targets',()=>{
    expect(liteRequest('/goldfish-lite spec '+id)).toEqual({mode:'lite-spec',id});
    expect(liteRequest('/goldfish-lite diff '+id)).toEqual({mode:'lite-diff',id});
    expect(liteRequest('ordinary task')).toBeNull();
    expect(()=>liteRequest('/goldfish-lite spec')).toThrow();
    expect(()=>liteRequest('/goldfish-lite diff ../repo')).toThrow();
  });
  it('includes only the declared checklist and requirement, not author memory',()=>{
    expect(target.content).toContain('One invoice per card.');
    expect(target.content).toContain('npm test');
    expect(target.content).not.toContain('PRIVATE_HISTORY');
    expect(()=>litePlanTarget(plan,'x'.repeat(110*1024))).toThrow(/100 KiB/);
  });
  it('enforces mutually exclusive LGTM, material findings and incomplete coverage',()=>{
    expect(parseLiteResult('[✅ LGTM]')).toBe('lgtm');
    expect(parseLiteResult('[P1] '+JSON.stringify({scope:'invoice.ts:12',description:'duplicate charge',evidence:'join repeated',recommendation:'aggregate'}))).toBe('findings');
    expect(parseLiteResult('[P1] invoice.ts: duplicate charge')).toBe('incomplete');
    expect(parseLiteResult('[✅ LGTM]\n[P1] defect')).toBe('incomplete');
    expect(parseLiteResult('NIVOO_LITE_INCOMPLETE missing diff')).toBe('incomplete');
    expect(parseLiteResult('Everything looks fine')).toBe('incomplete');
  });
  it('dispatches exactly one fresh review, with no author transcript or repository access',async()=>{
    const calls:GoldfishReviewerRequest[]=[];
    const result=await runLiteReview({mode:'lite-spec',sourceId:id,revision:'a'.repeat(40),target},async req=>{
      calls.push(req);
      expect(req.access).toBe('document-only');expect(req.baseline).toEqual([]);expect(req.priorReports).toEqual([]);
      expect(req.persona).toContain('Spec Review');
      return {status:'completed',report:'[✅ LGTM]',receipt:{sessionId:'native-session',freshContext:true,readOnly:true,access:'document-only'}};
    },signal);
    expect(calls).toHaveLength(1);expect(result.status).toBe('lgtm');
    const failure=await runLiteReview({mode:'lite-diff',sourceId:id,revision:'a'.repeat(40),target},async()=>({status:'failed',reason:'timeout'}),signal);
    expect(failure.status).toBe('incomplete');
  });
});
describe('EGM Lite committed change coverage',()=>{
  let repo:string;
  const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  beforeEach(()=>{
    repo=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-lite-review-'));
    git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    fs.writeFileSync(path.join(repo,'invoice.ts'),'const old=1;\n');git('add','.');git('commit','-qm','base');
  });
  afterEach(()=>fs.rmSync(repo,{recursive:true,force:true}));
  it('includes full textual changes, newly added and deleted files from exact clean parent',async()=>{
    const base=git('rev-parse','HEAD');
    fs.unlinkSync(path.join(repo,'invoice.ts'));fs.writeFileSync(path.join(repo,'replacement.ts'),'const fixed=2;\n');
    git('add','-A');git('commit','-qm','repair');
    const result=await liteDiffTarget(repo,{commit:base,dirty:[],complete:true},git('rev-parse','HEAD'),target,signal);
    expect(result.content).toContain('-const old=1;');expect(result.content).toContain('+const fixed=2;');
    expect(result.content).toContain('replacement.ts');expect(result.content).toContain('invoice.ts');
  });
  it('refuses dirty, missing and unrelated baselines, binary or protected changes',async()=>{
    const base=git('rev-parse','HEAD');
    fs.writeFileSync(path.join(repo,'invoice.ts'),'const fixed=2;\n');git('add','.');git('commit','-qm','repair');
    const head=git('rev-parse','HEAD');
    await expect(liteDiffTarget(repo,{commit:base,dirty:[' M invoice.ts'],complete:true},head,target,signal)).rejects.toThrow();
    await expect(liteDiffTarget(repo,{commit:null,dirty:[],complete:false},head,target,signal)).rejects.toThrow();
    fs.writeFileSync(path.join(repo,'image.bin'),Buffer.from([0,1,0,2]));git('add','.');git('commit','-qm','binary');
    await expect(liteDiffTarget(repo,{commit:base,dirty:[],complete:true},git('rev-parse','HEAD'),target,signal)).rejects.toThrow(/pai único/);
    await expect(liteDiffTarget(repo,{commit:head,dirty:[],complete:true},git('rev-parse','HEAD'),target,signal)).rejects.toThrow(/binárias/);
  });
});
describe('Lite duplicate admission',()=>{
  it('does not write a second checkpoint for a recorded review',async()=>{
    const query=jest.fn().mockResolvedValue([{id:'conversation'}]);
    const findFirst=jest.fn().mockResolvedValue({id:'existing',status:'PRONTA'}),updateMany=jest.fn();
    const prisma={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:query,conversationMessage:{findFirst,updateMany}})} as unknown as PrismaService;
    const writer=goldfishMessageWriter(prisma,{messageId:'new',taskId:'t',workerId:'w',claims:1},signal);
    await expect(writer({content:'checkpoint'},{conversationId:'conversation',preset:'lite-spec',sourceId:id,targetHash:'hash',revision:'a'.repeat(40)})).rejects.toThrow(/já registrada/);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
