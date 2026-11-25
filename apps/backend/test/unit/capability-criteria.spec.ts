import {validateCapabilityCriteria,orderedCapabilityCriteria,deferredCapabilityCriterion} from '../../src/jobs/workflow/capability-criteria';
const c=(phase:string,kind:string,command?:string,id='erp.capability.clientes')=>({key:phase,kind,config:{capability:{id,contract:'docs/clientes.md',phase},...(command?{command}:{})}});
const structural=c('structural','COMMAND','npm run check:estrutura');
const acceptance=c('acceptance','COMMAND','npm run test:clientes');
const decision=c('decision','MANUAL_APPROVAL');
const construction=c('construction','COMMAND','npm run test:cadastro');
describe('Capability: construção e aceitação',()=>{
  it('permite construir slices sem homologação antecipada',()=>{expect(()=>validateCapabilityCriteria([construction])).not.toThrow();});
  it('exige estrutura, comportamento integrado e decisão para aceitar',()=>{
    expect(()=>validateCapabilityCriteria([structural,acceptance,decision])).not.toThrow();
    expect(()=>validateCapabilityCriteria([acceptance,decision])).toThrow();
    expect(()=>validateCapabilityCriteria([structural,acceptance])).toThrow();
    expect(()=>validateCapabilityCriteria([c('structural','FILE_EXISTS'),acceptance,decision])).toThrow();
    expect(()=>validateCapabilityCriteria([structural,c('acceptance','COMMAND','true'),decision])).toThrow();
    expect(()=>validateCapabilityCriteria([structural,acceptance,decision],[{verifyCommand:'npm run test:clientes'}])).toThrow();
  });
  it('não roda aceitação com estrutura pendente nem solicita decisão antes dos testes',()=>{
    const criteria=[decision,acceptance,construction,structural];
    expect(orderedCapabilityCriteria(criteria).map(x=>x.key)).toEqual(['construction','structural','acceptance','decision']);
    const results=new Map([['construction',true],['structural',false]]);
    expect(deferredCapabilityCriterion(acceptance,results,criteria)).toContain('completude estrutural');
    expect(deferredCapabilityCriterion(decision,results,criteria)).toContain('critérios técnicos');
    results.set('structural',true);
    expect(deferredCapabilityCriterion(acceptance,results,criteria)).toBeNull();
    results.set('acceptance',true);
    expect(deferredCapabilityCriterion(decision,results,criteria)).toBeNull();
  });
  it('mantém critérios legados e impede trocar contrato entre slices',()=>{
    const old=[{key:'a',kind:'FILE_EXISTS',config:{path:'a'}}];
    expect(orderedCapabilityCriteria(old)).toBe(old);
    expect(()=>validateCapabilityCriteria(old)).not.toThrow();
    expect(()=>validateCapabilityCriteria([structural,{...acceptance,config:{...acceptance.config,capability:{...acceptance.config.capability,contract:'docs/outro.md'}}},decision])).toThrow();
  });
});
