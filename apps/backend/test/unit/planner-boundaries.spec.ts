import { extractJson, normalizarPerguntas } from '../../src/worker/planner/response';
import { selectPlannerCapabilities } from '../../src/worker/planner/capabilities';
import { plannerRules } from '../../src/worker/planner/contract';
import { validatedPlannerJob } from '../../src/worker/planner/validated-job';
import type { PlannerAttachment } from '../../src/worker/planner/types';

describe('Fronteiras do planejador', () => {
  it('interpreta o plano completo mesmo com código cercado no texto', () => {
    const response={tipo:'plano',texto:'\x60\x60\x60bash\nls\n\x60\x60\x60',job:{steps:[{instructions:'x'}]}};
    expect(extractJson('antes\n\x60\x60\x60json\n'+JSON.stringify(response)+'\n\x60\x60\x60')).toEqual(response);
  });
  it('corrige vírgula final sem alterar texto literal ou comando', () => {
    const broken='{"tipo":"plano","texto":"literal ,} e ,]","job":{"steps":[{"instructions":"printf \\"a,}\\"",},],},}';
    expect(extractJson(broken)).toEqual({tipo:'plano',texto:'literal ,} e ,]',job:{steps:[{instructions:'printf "a,}"'}]}});
  });
  it('preserva quebras de linha e normaliza perguntas', () => {
    expect(extractJson('{"tipo":"resposta","texto":"a\nb"}')).toEqual({tipo:'resposta',texto:'a\nb'});
    expect(normalizarPerguntas([{pergunta:' Escolha ',opcoes:[' A ',{label:'B',description:'opção'}]}])).toEqual([{pergunta:'Escolha',opcoes:[{rotulo:'A',descricao:''},{rotulo:'B',descricao:'opção'}],multipla:false}]);
    expect(extractJson('{"tipo":"FATO","texto":"a"}')).toBeNull();
  });
  it.each([
    ['software',false,true],
    ['studio-workflow',false,true],
    ['atendimento',false,false],
    ['design-video',true,false],
    ['geral',true,true],
  ] as const)('carrega somente capacidades da área %s',async(template,media,softwareInterface)=>{
    const registry={has:jest.fn(()=>true),status:jest.fn(async()=>({available:true}))};
    const c=await selectPlannerCapabilities({template},registry as any);
    expect(c).toEqual({media,softwareInterface,paidVideo:media});
    const prompt=plannerRules(c).join('\n');
    expect(prompt.includes('nivoo-roteiro')).toBe(softwareInterface);
    expect(prompt.includes('nivoo-renderizar-motion')).toBe(media);
    expect(registry.status).toHaveBeenCalledTimes(media?1:0);
  });
  it('mantém mídia local sem Gemini',async()=>{
    const registry={has:jest.fn(()=>false),status:jest.fn()};
    const c=await selectPlannerCapabilities({template:'design-video'},registry as any);
    const prompt=plannerRules(c).join('\n');
    expect(c.paidVideo).toBe(false);
    expect(prompt).toContain('juntar-videos');
    expect(prompt).toContain('nivoo-renderizar-motion');
    expect(registry.status).not.toHaveBeenCalled();
  });
  it('valida plano e anexos pela mesma fronteira',()=>{
    const jobs={validatePlan:jest.fn(()=>({title:'A',defaultProvider:'codex-cli'}))};
    const response={job:{title:'A',defaultProvider:'wrong',anexosNoProjeto:[{anexo:'contexto/a.png',para:'logo.png'},{anexo:'unknown.png',para:'x'},{anexo:'contexto/a.png',para:'../bad'}]}};
    const area={template:'software'};
    const result=validatedPlannerJob(jobs as any,response,'codex-cli',area,[{caminho:'contexto/a.png'} as PlannerAttachment]);
    expect(jobs.validatePlan).toHaveBeenCalledWith({...response.job,defaultProvider:'codex-cli'},area);
    expect(result).toEqual({title:'A',defaultProvider:'codex-cli',anexosNoProjeto:[{anexo:'contexto/a.png',para:'logo.png'}]});
  });
});
