import { chooseReserve,reservePin,reserveCompatibility } from '../../src/providers/reserve-policy';
import { markModelIncompatible,modelCooling } from '../../src/projects/mover-trabalho';
import type { ProviderStatus } from '../../src/providers/provider.interface';
const status=(id:string,override:Partial<ProviderStatus>={}):ProviderStatus=>({id,label:id,kind:id.endsWith('-api')?'api':'cli',isAi:true,available:true,installed:true,authenticated:true,capabilities:['editar-codigo'],limits:{},errors:[],checkedAt:'2026-11-25T12:00:00Z',...override});
const from='claude-code-cli',ids=[from,'nvidia-api','codex-cli','groq-free-api','openrouter-free-api'];
const project={provider:from,aiReserva:['nvidia-api','codex-cli','groq-free-api'],aiModels:{'nvidia-api':'poolside/laguna-xs-2.1','codex-cli':'configured-codex','groq-free-api':'openai/gpt-oss-120b'}};
function fixture(){
  const get=jest.fn(async(id:string)=>status(id,id==='nvidia-api'?{agentModels:['poolside/laguna-xs-2.1']}:id==='groq-free-api'?{agentModels:['openai/gpt-oss-120b']}:{}));
  const registry={has:(id:string)=>ids.includes(id),status:get};
  const input={from,project,registry,knownIds:ids,cooling:()=>false,requirements:{}};
  return {get,input};
}
describe('Reserve selection by actual contract',()=>{
  it('preserves configured order and uses the selected connection model',async()=>{
    const {input,get}=fixture();
    expect(await chooseReserve(input)).toMatchObject({id:'nvidia-api',model:'poolside/laguna-xs-2.1'});
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('skips an incompatible model even when its connection is logged in',async()=>{
    const {input,get}=fixture();
    get.mockResolvedValueOnce(status('nvidia-api',{agentModels:[]}));
    const skip=jest.fn();
    expect(await chooseReserve({...input,onSkip:skip})).toMatchObject({id:'codex-cli',model:'configured-codex'});
    expect(skip).toHaveBeenCalledWith('nvidia-api',expect.stringContaining('catálogo'));
  });
  it('does not probe an adapter that cannot preserve MCP or direct image transport',async()=>{
    for(const requirements of [{preserveMcp:true},{hasImages:true}]){
      const {input,get}=fixture();
      expect(await chooseReserve({...input,requirements})).toMatchObject({id:'codex-cli'});
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith('codex-cli',15000);
    }
  });
  it('never substitutes a pinned model, native visual operation, or Goldfish repair',async()=>{
    for(const requirements of [{pinnedReview:true},{options:{model:'fixed'}},{options:{visualAsset:{arquivo:'out/a.png'}}},{options:{visualReferences:['out/a.png']}}]){
      const {input,get}=fixture();
      expect(reservePin(requirements)).not.toBeNull();
      expect(await chooseReserve({...input,requirements})).toBeNull();
      expect(get).not.toHaveBeenCalled();
    }
  });
  it('skips recently exhausted connections, invalid and duplicated IDs, and unavailable reserves',async()=>{
    const {input,get}=fixture();
    get.mockResolvedValueOnce(status('codex-cli',{available:false}));
    const candidates={...project,aiReserva:['unknown','nvidia-api','codex-cli','codex-cli','groq-free-api']};
    expect(await chooseReserve({...input,project:candidates,cooling:id=>id==='nvidia-api'})).toMatchObject({id:'groq-free-api'});
    expect(get.mock.calls.map(c=>c[0])).toEqual(['codex-cli','groq-free-api']);
  });
  it('keeps model incompatibility separate from connection-wide exhaustion',async()=>{
    const now=100000;
    markModelIncompatible('codex-cli','configured-codex',now);
    expect(modelCooling('codex-cli','configured-codex',now+1)).toBe(true);
    expect(modelCooling('codex-cli','other',now+1)).toBe(false);
    expect(modelCooling('codex-cli','configured-codex',now+30*60_000)).toBe(false);
    const {input}=fixture();
    expect(await chooseReserve({...input,modelCooling:(id,model)=>id==='nvidia-api'&&model==='poolside/laguna-xs-2.1'})).toMatchObject({id:'codex-cli'});
  });
  it('does not claim an unknown CLI model is incompatible, or accept an executor as a reserve',()=>{
    expect(reserveCompatibility('codex-cli',project,status('codex-cli'),{})).toBeNull();
    expect(reserveCompatibility('codex-cli',project,status('codex-cli',{kind:'executor',isAi:false}),{})).not.toBeNull();
  });
});
