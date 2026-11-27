import { assessModel,selectedModel } from '../../src/providers/model-capabilities';
import { projectModel } from '../../src/providers/project-model';
describe('Model eligibility before a session',()=>{
  const api={kind:'api' as const,capabilities:['editar-codigo'],agentModels:['poolside/laguna-xs-2.1','nvidia/nemotron-3.5-bolt-e4b']};
  it('keeps the exact connection-specific selection and valid step override',()=>{
    const m=projectModel({aiModels:{'nvidia-api--aabbccdd':'poolside/laguna-xs-2.1','nvidia-api':'nvidia/nemotron-3.5-bolt-e4b'}},'nvidia-api--aabbccdd');
    expect(m).toBe('poolside/laguna-xs-2.1');
    expect(selectedModel(m,{model:undefined})).toBe(m);
    expect(selectedModel(m,{model:'nvidia/nemotron-3.5-bolt-e4b'})).toBe('nvidia/nemotron-3.5-bolt-e4b');
    expect(()=>selectedModel(m,{model:12})).toThrow();
    expect(()=>selectedModel(m,{model:' model '})).toThrow();
  });
  it('distinguishes documented eligibility, absent catalog entry and unknown metadata',()=>{
    expect(assessModel('nvidia-api--aabbccdd','poolside/laguna-xs-2.1',api).state).toBe('eligible');
    expect(assessModel('nvidia-api','poolside/laguna-xs-2.1',{...api,agentModels:[]}).state).toBe('incompatible');
    expect(assessModel('nvidia-api','poolside/laguna-xs-2.1',{kind:'api',capabilities:[]}).state).toBe('unknown');
    expect(assessModel('nvidia-api','nvidia/nemotron-3.5-rerank-8b',api).state).toBe('incompatible');
    expect(assessModel('nvidia-api','other/nemotron-3.5-bolt-e4b',api).state).toBe('incompatible');
  });
  it('rejects paid routes and Groq models with no documented local agent contract',()=>{
    expect(assessModel('openrouter-free-api','openrouter/auto',api).state).toBe('incompatible');
    expect(assessModel('openrouter-free-api','openrouter/free',{...api,agentModels:['openrouter/free']}).state).toBe('eligible');
    expect(assessModel('groq-free-api','groq/compound',api).state).toBe('incompatible');
    expect(assessModel('groq-free-api','openai/gpt-oss-120b',{...api,agentModels:['openai/gpt-oss-120b']}).state).toBe('eligible');
  });
  it('does not infer model-level CLI support from a login or a connector capability',()=>{
    expect(assessModel('codex-cli','gpt-example',{kind:'cli',capabilities:['editar-codigo']}).state).toBe('unknown');
    expect(assessModel('claude-api','claude-example',{kind:'cli',capabilities:['editar-codigo']}).state).toBe('unknown');
    expect(assessModel('gemini-api',undefined,{kind:'cli',capabilities:['editar-codigo']}).state).toBe('unknown');
  });
  it('checks actual adapter requirements rather than marketing claims of multimodality',()=>{
    expect(assessModel('nvidia-api','poolside/laguna-xs-2.1',api,{images:['image.png']}).state).toBe('incompatible');
    expect(assessModel('codex-api','model',{kind:'cli',capabilities:['imagegen-native-adapter']},{visualAsset:{arquivo:'image.png'}}).state).toBe('incompatible');
    expect(assessModel('codex-cli','model',{kind:'cli',capabilities:[]},{visualAsset:{arquivo:'image.png'}}).state).toBe('incompatible');
    expect(assessModel('codex-cli','model',{kind:'cli',capabilities:['imagegen-native-adapter']},{visualAsset:{arquivo:'image.png'}}).state).toBe('unknown');
  });
});
