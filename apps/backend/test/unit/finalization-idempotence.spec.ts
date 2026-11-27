import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactStoreService } from '../../src/storage/artifact-store.service';
import { ingestNotes,saveCheckpoint } from '../../src/worker/executor/recovery-store';
import { resetConfigCache } from '../../src/config';

jest.mock('../../src/memory/camadas',()=>({escreverArquivosDaMemoria:jest.fn(async()=>undefined)}));
const lease:any={task:{id:'q',claims:4,jobId:'j',stepId:'s'},workerId:'w'};
const meta={projectId:'p',jobId:'j',stepId:'s',attemptId:'a',name:'log.txt',kind:'LOG'};
function fixture(){
  const artifacts:any[]=[],notes:any[]=[],checkpoints:any[]=[];
  const match=(row:any,where:any)=>Object.entries(where).every(([k,v])=>v===undefined||row[k]===v);
  const step={id:'s',status:'EXECUTANDO',attemptCount:2,resumeFromAttempt:0};
  const tx:any={
    $queryRaw:jest.fn().mockResolvedValue([{id:'q'}]),
    attempt:{findFirst:jest.fn(async()=>({id:'a',job:{projectId:'p'}}))},
    artifact:{
      findFirst:jest.fn(async({where})=>artifacts.find(a=>match(a,where))??null),
      create:jest.fn(async({data})=>{const a={...data,id:'art'+artifacts.length};artifacts.push(a);return a;}),
      findMany:jest.fn(async()=>[]),
    },
    memoryEntry:{
      findMany:jest.fn(async()=>notes),
      create:jest.fn(async({data})=>{notes.push(data);return data;}),
    },
    step:{
      findUnique:jest.fn(async()=>step),
      findMany:jest.fn(async()=>[{key:'s',status:step.status}]),
      update:jest.fn(async({data})=>Object.assign(step,data)),
    },
    checkpoint:{
      findFirst:jest.fn(async()=>checkpoints.find(c=>c.state.concluido&&c.state.tentativa===2)??null),
      count:jest.fn(async()=>checkpoints.length),
      create:jest.fn(async({data})=>{checkpoints.push(data);return data;}),
    },
  };
  const prisma:any={...tx,$transaction:async(fn:any)=>fn(tx)};
  return {tx,prisma,artifacts,notes,checkpoints};
}
describe('idempotent finalization',()=>{
  let dir:string,oldRoot:string|undefined;
  beforeEach(()=>{
    dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-finalization-'));
    oldRoot=process.env.NIVOO_ARTIFACTS_ROOT;
    process.env.NIVOO_ARTIFACTS_ROOT=dir;
    resetConfigCache(); // o diretório de artefatos é por-teste: forçar releitura do env
  });
  afterEach(()=>{
    if(oldRoot===undefined)delete process.env.NIVOO_ARTIFACTS_ROOT;else process.env.NIVOO_ARTIFACTS_ROOT=oldRoot;
    resetConfigCache();
    fs.rmSync(dir,{recursive:true,force:true});
  });
  it('reuses an exact artifact on a repeated publication by the same attempt',async()=>{
    const f=fixture(),store=new ArtifactStoreService(f.prisma);
    const a=await store.storeContent(meta,'same',lease),b=await store.storeContent(meta,'same',lease);
    expect(a.id).toBe(b.id);
    expect(f.tx.artifact.create).toHaveBeenCalledTimes(1);
    expect((await store.storeContent(meta,'changed',lease)).id).not.toBe(a.id);
  });
  it('returns the original output IDs after partial catalog publication',async()=>{
    const f=fixture(),store=new ArtifactStoreService(f.prisma);
    const out=path.join(dir,'out');fs.mkdirSync(out);fs.writeFileSync(path.join(out,'report.md'),'report');
    const first=await store.collectOutputs(meta,out,lease),second=await store.collectOutputs(meta,out,lease);
    expect(first.map(a=>a.id)).toEqual(second.map(a=>a.id));
    expect(first).toHaveLength(1);
    expect(f.tx.artifact.create).toHaveBeenCalledTimes(1);
  });
  it('rejects stale lease before writing a catalog record',async()=>{
    const f=fixture(),store=new ArtifactStoreService(f.prisma);
    f.tx.$queryRaw.mockResolvedValueOnce([{id:'lock'}]).mockResolvedValueOnce([]);
    await expect(store.storeContent(meta,'same',lease)).rejects.toThrow('Lease');
    expect(f.tx.artifact.create).not.toHaveBeenCalled();
  });
  it('replays notes without duplicates or losing the attempt note count',async()=>{
    const f=fixture();
    fs.mkdirSync(path.join(dir,'.nivoo'));fs.writeFileSync(path.join(dir,'.nivoo','notas.jsonl'),'{"tipo":"PROGRESSO","titulo":"Done","conteudo":"Work"}\n');
    const workspace:any={headCommit:async()=> 'head'},logs:any={log:jest.fn(async()=>undefined)};
    const run=()=>ingestNotes(f.prisma,workspace,logs,{id:'j',projectId:'p'} as any,{id:'s'} as any,'a',dir,'codex-cli','session',[],lease);
    expect(await run()).toBe(1);expect(await run()).toBe(1);
    expect(f.tx.memoryEntry.create).toHaveBeenCalledTimes(1);
  });
  it('reuses a successful checkpoint even with a different recovery label',async()=>{
    const f=fixture(),workspace:any={commitCheckpoint:jest.fn(async()=> 'git-head')};
    const run=(label:string)=>saveCheckpoint(f.prisma,workspace,'j',{id:'s',key:'s'} as any,dir,label,{tentativa:2},true,lease);
    expect(await run('normal')).toBe('git-head');expect(await run('recuperado')).toBe('git-head');
    expect(workspace.commitCheckpoint).toHaveBeenCalledTimes(1);
    expect(f.tx.checkpoint.create).toHaveBeenCalledTimes(1);
  });
});
