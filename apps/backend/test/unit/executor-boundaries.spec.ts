import { prepareExecutionPrompt } from '../../src/worker/executor/prompt';
import { normalizeSessionResult,classifyExecutionResult } from '../../src/worker/executor/outcome';
import { dispatchExecution,executionTimeoutMs } from '../../src/worker/executor/dispatch';
import { softwareInterfaceEnabled } from '../../src/specialties/scope';
import { mcpDoProjeto } from '../../src/mcp/mcp';

jest.mock('../../src/mcp/mcp',()=>({mcpDoProjeto:jest.fn(()=>[{nome:'tool'}])}));
// O dispatch encaminha o MCP da SESSÃO (política por fase), não o catálogo cru:
// mockamos essa camada para verificar que o request recebe exatamente o que ela
// devolve, sem depender de o provedor de teste estar na lista de suportados.
jest.mock('../../src/mcp/session-policy',()=>({projectSessionMcp:jest.fn(()=>[{nome:'tool'}])}));
jest.mock('../../src/diagnostico/erros',()=>({registrarErro:jest.fn()}));

describe('Fronteiras do executor',()=>{
  it('não carrega perfil, memória ou documentos para execução determinística',async()=>{
    const fail=jest.fn(()=>{throw Error('não deve chamar');});
    expect(await prepareExecutionPrompt(false,fail,fail,fail)).toEqual({profileText:'',context:'',stats:null});
    expect(fail).not.toHaveBeenCalled();
  });
  it('preserva contexto e documentos da IA',async()=>{
    const stats={totalChars:10} as any;
    const load=jest.fn(async()=>({text:'fatos',stats}));
    const result=await prepareExecutionPrompt(true,async()=> 'perfil',load,()=>['AGENTS.md']);
    expect(load).toHaveBeenCalledWith('perfil');
    expect(result.context).toContain('fatos');
    expect(result.context).toContain('AGENTS.md');
    expect(result.stats).toMatchObject({totalChars:result.context.length,profileChars:6});
  });
  it.each([
    [{exitCode:0,output:''},false,true,'SUCESSO'],
    [{exitCode:0,output:'',interrupted:true},true,true,'INTERROMPIDA'],
    [{exitCode:1,output:'',resourceUnavailable:true},true,false,'RECURSO_INDISPONIVEL'],
    [{exitCode:0,output:''},true,false,'SESSAO_ENCERRADA'],
    [{exitCode:1,output:''},false,false,'FALHA'],
    [{exitCode:-1,output:'',error:'timeout após 100 ms'},true,false,'SESSAO_ENCERRADA'],
    [{exitCode:-1,output:'',error:'timeout após 100 ms'},false,false,'FALHA'],
  ] as const)('classifica resultado operacional %j',(result,isAi,verified,status)=>{
    const normalized=normalizeSessionResult(result,isAi);
    expect(classifyExecutionResult(normalized.result,isAi,verified,normalized.sessionClosedNormally).attemptStatus).toBe(status);
  });
  it('distingue render real de texto citado e respeita limite explícito',()=>{
    const job={maxDurationSec:0,activeSeconds:0,stepTimeoutSec:900};
    const render='nivoo-renderizar-motion motion/a --saida midia/saida/a.mp4';
    expect(executionTimeoutMs(job,'local-shell',render)).toBe(3600000);
    expect(executionTimeoutMs({...job,maxDurationSec:1000,activeSeconds:900},'local-shell',render)).toBe(100000);
    expect(executionTimeoutMs(job,'local-shell',"echo 'nivoo-renderizar-motion motion/a'")).toBe(900000);
  });
  it('usa o mesmo escopo de ferramentas no planejador e executor',()=>{
    expect(['software','studio-workflow','atendimento','design-video','geral'].map(template=>softwareInterfaceEnabled({template}))).toEqual([true,true,false,false,true]);
  });
  const job={id:'j',projectId:'p',project:{aiModels:{custom:'model-default'}}} as any;
  const step={id:'s',key:'work',instructions:'execute',providerOptions:{model:'model-override',maxTurns:33}} as any;
  const signal=new AbortController().signal;
  function fixtures(){
    const events:any[]=[];
    const prisma={attempt:{updateMany:jest.fn(async(x:any)=>events.push(['pid',x.data.pid]))},step:{updateMany:jest.fn(async()=>undefined)}};
    const logs={log:jest.fn(async(_id:any,line:any,opts:any)=>{events.push(['log',line,opts.source]);})};
    const registry={registrarResultado:jest.fn((...args:any[])=>events.push(['auth',...args]))};
    const call=(provider:any,id:string)=>dispatchExecution(prisma as any,logs as any,registry as any,provider,id,job,step,{id:'a'},'/w','/out','/media','ctx','profile',900,signal,Date.now());
    return {events,registry,call};
  }
  it('despacha uma única vez e preserva identidade, modelo, MCP, logs e sinal',async()=>{
    const {events,call}=fixtures();
    const execute=jest.fn(async(req:any)=>{
      expect(req.options.model).toBe('model-override');
      expect(req.options.maxTurns).toBe(33);
      expect(req.systemPrompt).toBe('profile');
      expect(req.mcp).toEqual([{nome:'tool'}]);
      expect(req.signal).toBe(signal);
      req.onSpawn(123);req.onLog('line');
      return {exitCode:0,output:'ok'};
    });
    expect((await call({id:'base',kind:'cli',execute},'custom')).output).toBe('ok');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events).toEqual([['pid',123],['log','line','provider:custom'],['auth','custom',true,undefined]]);
  });
  it('não chama MCP ou registra login no executor local',async()=>{
    const {events,call}=fixtures();
    jest.clearAllMocks();
    const execute=jest.fn(async(req:any)=>{
      expect(req.systemPrompt).toBeUndefined();
      expect(req.mcp).toBeUndefined();
      expect(req.projectMediaDir).toBe('/media');
      return {exitCode:0,output:'local'};
    });
    expect((await call({kind:'executor',execute},'local-shell')).output).toBe('local');
    expect(mcpDoProjeto).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
  it('converte exceção do conector em resultado sem criar nova execução',async()=>{
    const {call}=fixtures();
    const execute=jest.fn(async()=>{throw Error('falha');});
    const result=await call({kind:'cli',execute},'custom');
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain('falha');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
