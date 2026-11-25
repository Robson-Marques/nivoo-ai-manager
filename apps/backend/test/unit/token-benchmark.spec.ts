import { benchmarkVariant,measuredUsage,tokenCount,measureAiCall } from '../../src/worker/token-benchmark';
import { selectSkills } from '../../src/specialties/skills';

describe('Benchmark de execução enxuta',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  it('isola somente a skill, por UUID explícito do operador',()=>{
    expect(benchmarkVariant(id,id)).toBe('reference');
    expect(benchmarkVariant(id,'*')).toBe('optimized');
    expect(benchmarkVariant(id,'')).toBe('optimized');
    const args={phase:'execution' as const,text:'Criar dashboard Liquid Glass com testes',media:false,software:true};
    const on=selectSkills(args).map(s=>s.id);
    expect(on).toContain('execucao-enxuta');
    expect(selectSkills({...args,omitLeanSkill:true}).map(s=>s.id)).toEqual(on.filter(s=>s!=='execucao-enxuta'));
  });
  it('preserva ausência, zero, cache e parcialidade',()=>{
    for(const v of [undefined,null,-1,1.5,NaN,'3'])expect(tokenCount(v)).toBeNull();
    const base={exitCode:0,output:''};
    expect(measuredUsage(base)).toMatchObject({inputTotal:null,outputTokens:null,complete:false,costUsd:null});
    expect(measuredUsage({...base,inputTokens:0,outputTokens:0})).toMatchObject({inputTotal:0,outputTokens:0,complete:true});
    expect(measuredUsage({...base,inputTokens:10,outputTokens:5,inputExcludesCache:true,cacheReadInputTokens:80,cacheWriteInputTokens:10})).toMatchObject({inputTotal:100,complete:true});
    expect(measuredUsage({...base,inputTokens:10,outputTokens:5,inputExcludesCache:true})).toMatchObject({inputTotal:null,complete:false});
    expect(measuredUsage({...base,inputTokens:100,outputTokens:5,cacheReadInputTokens:80})).toMatchObject({inputTotal:100,complete:true});
    expect(measuredUsage({...base,inputTokens:100,outputTokens:5,costEstimated:true})).toMatchObject({partial:true,complete:false});
  });
  it('mede uma única chamada e registra exceção sem inventar tokens',async()=>{
    const log=jest.spyOn(console,'info').mockImplementation(()=>{});
    try{
      const meta={projectId:id,provider:'codex-cli',phase:'planner' as const,skillsVersion:'1.5.0'};
      const run=jest.fn().mockResolvedValue({exitCode:0,output:'privado',inputTokens:3,outputTokens:2});
      await measureAiCall(meta,run);
      expect(run).toHaveBeenCalledTimes(1);
      const records=log.mock.calls.map(c=>JSON.parse(String(c[0]).split('[NIVOO_TOKEN_BENCH] ')[1]));
      expect(records.map(r=>r.event)).toEqual(['start','finish']);
      expect(records[0].callId).toBe(records[1].callId);
      expect(records[1]).toMatchObject({inputTotal:3,outputTokens:2,complete:true});
      expect(JSON.stringify(records)).not.toContain('privado');
      await expect(measureAiCall(meta,async()=>{throw Error('segredo');})).rejects.toThrow('segredo');
      expect(JSON.stringify(log.mock.calls)).not.toContain('segredo');
    }finally{log.mockRestore();}
  });
});
