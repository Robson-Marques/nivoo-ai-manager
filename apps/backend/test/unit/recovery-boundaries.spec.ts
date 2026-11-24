import { decideFailedAttempt,decideSessionContinuation,repeatedSessionVerification,repairKey } from '../../src/worker/executor/recovery-policy';
import { durableMediaOutputs,captureMediaOutputs,publishAttemptMedia,recoverRenderedOutput } from '../../src/worker/executor/media-recovery';
import { conversaComoTexto } from '../../src/worker/executor/conversation';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sha256File } from '../../src/common/hash';
import { inspecionarVideoGerado } from '../../src/jobs/native-video-result';

jest.mock('../../src/jobs/native-video-result',()=>{
  const actual=jest.requireActual('../../src/jobs/native-video-result');
  return {...actual,inspecionarVideoGerado:jest.fn((dir:string,name:string)=>({ok:true,absolutePath:actual.caminhoRealDoVideo(dir,name),detail:'valid'}))};
});

describe('Recuperação de trabalho',()=>{
  const job={id:'j',projectId:'p',defaultProvider:'codex-cli',maxAttemptsPerStep:0,maxSessionsPerStep:0,repetitionWindow:2};
  const name='midia/saida/a.mp4';
  const step={id:'s',key:'render',provider:'local-shell',instructions:'nivoo-renderizar-motion motion/a --saida '+name,providerOptions:{},verifyCommand:null};
  const err='TypeError: renderer.mesh is not a function',other='ReferenceError: camera is not defined';
  const stagnant={error:null,treeBefore:'h',treeAfter:'h',notesIngested:0};
  it('repara causas distintas, limita apenas o mesmo erro',()=>{
    expect(decideFailedAttempt(job,[err,other],err,'','local-shell',false,err).kind).toBe('repair');
    expect(decideFailedAttempt(job,[err,other,err,err],err,'','local-shell',false,err).kind).toBe('repeat');
    expect(decideFailedAttempt({...job,maxAttemptsPerStep:1},[err],err,'','local-shell',false,err).kind).toBe('limit');
    expect(decideFailedAttempt(job,['command not found'],'command not found','','local-shell',false,'command not found').kind).toBe('blocked');
    expect(decideFailedAttempt(job,['unrecognized arguments: --bad'],'unrecognized arguments: --bad','','local-shell',false,'unrecognized arguments: --bad').kind).toBe('blocked');
  });
  it('distingue progresso de repetição de sessão',()=>{
    const progress={...stagnant,treeAfter:'next'};
    expect(decideSessionContinuation(job,[progress,progress,progress]).kind).toBe('continue');
    expect(decideSessionContinuation(job,[stagnant,stagnant,stagnant]).kind).toBe('repeat');
    const e={...stagnant,error:'verificação da etapa falhou: assertion error'};
    expect(repeatedSessionVerification([e,e,e],'npm test')).toBeTruthy();
  });
  it('chave de reparo estável e sem colisão por truncamento de nomes longos',()=>{
    expect(repairKey('a'.repeat(35)+'1',3)).toBe(repairKey('a'.repeat(35)+'1',3));
    expect(repairKey('a'.repeat(35)+'1',3)).not.toBe(repairKey('a'.repeat(35)+'2',3));
  });
  it('não atribui vídeo citado em instrução ou critério à IA',()=>{
    expect(durableMediaOutputs(job,step)).toEqual([name]);
    expect(durableMediaOutputs(job,{...step,provider:'codex-cli',verifyCommand:'test -s '+name})).toEqual([]);
    expect(durableMediaOutputs(job,{...step,provider:'codex-cli',verifyCommand:'nivoo-renderizar-motion motion/a --saida out/a.mp4'})).toEqual([name]);
  });
  let dir:string,file:string;
  beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-recovery-'));fs.mkdirSync(path.join(dir,'saida'));file=path.join(dir,'saida','a.mp4');});
  afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
  it('arquivo antigo não é nova entrega; arquivo novo pertence à tentativa produtora',async()=>{
    const store={registrarVideosDoTrabalho:jest.fn(async(_meta:unknown,_dir:string,names:string[])=>names)};
    fs.writeFileSync(file,'old');
    const old=captureMediaOutputs(job,step,dir);
    expect(await publishAttemptMedia(store as any,job,step,'a',dir,old,{exitCode:0,output:''},true)).toEqual([]);
    expect(store.registrarVideosDoTrabalho).not.toHaveBeenCalled();
    fs.unlinkSync(file);
    const before=captureMediaOutputs(job,step,dir);
    fs.writeFileSync(file,'new');
    expect(await publishAttemptMedia(store as any,job,step,'a',dir,before,{exitCode:0,output:''},true)).toEqual([name]);
    expect(store.registrarVideosDoTrabalho).toHaveBeenCalledWith({projectId:'p',jobId:'j',stepId:'s',attemptId:'a'},dir,[name]);
  });
  it('não publica saída de tentativa falha, interrompida ou inválida',async()=>{
    const store={registrarVideosDoTrabalho:jest.fn()};
    const before=captureMediaOutputs(job,step,dir);
    fs.writeFileSync(file,'new');
    for(const [result,verified] of [[{exitCode:1,output:''},true],[{exitCode:0,output:''},false],[{exitCode:0,output:'',interrupted:true},true]] as const)
      expect(await publishAttemptMedia(store as any,job,step,'a',dir,before,result,verified)).toEqual([]);
    expect(store.registrarVideosDoTrabalho).not.toHaveBeenCalled();
  });
  it('recupera somente arquivo íntegro com produtor e tentativa do mesmo trabalho',async()=>{
    fs.writeFileSync(file,'valid');
    const prisma={artifact:{findFirst:jest.fn(async()=>({attemptId:'a',sha256:await sha256File(file)}))},attempt:{findFirst:jest.fn(async()=>({id:'a'}))}};
    expect((await recoverRenderedOutput(prisma as any,job,step,dir)).kind).toBe('recovered');
    expect(prisma.artifact.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({jobId:'j',projectId:'p',stepId:'s'})}));
    expect(prisma.attempt.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'a',jobId:'j',stepId:'s',provider:'local-shell'})}));
    const hash=await sha256File(file);
    prisma.artifact.findFirst.mockResolvedValue({attemptId:'a',sha256:hash});
    fs.writeFileSync(file,'changed');
    expect((await recoverRenderedOutput(prisma as any,job,step,dir)).kind).toBe('conflict');
    prisma.attempt.findFirst.mockResolvedValue(null as any);
    expect((await recoverRenderedOutput(prisma as any,job,step,dir)).kind).toBe('conflict');
    expect(inspecionarVideoGerado).toHaveBeenCalled();
  });
  it('preserva a solicitação mais recente em conversa longa',()=>{
    const m=(content:string,role='USUARIO')=>({role,content,kind:null,createdAt:new Date(0)});
    const msgs=[m('ORIGINAL'),...Array.from({length:35},(_,i)=>m('x'.repeat(39000)+i)),m('REFACA SEM REUSAR O VISUAL'),...Array.from({length:100},()=>m('a'.repeat(5900),'ASSISTENTE'))];
    const result=conversaComoTexto(msgs);
    expect(result).toContain('ORIGINAL');
    expect(result).toContain('REFACA SEM REUSAR O VISUAL');
    expect(result).toContain('omitido');
  });
});
