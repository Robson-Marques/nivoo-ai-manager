import {compileLiquidGlassAdoption} from '../../src/jobs/workflow/compile-liquid-glass-adoption';
import {validateCapabilityCriteria} from '../../src/jobs/workflow/capability-criteria';
import {adoptionOf,nativeAdoptionInventory,requireAdoptionContract} from '../../src/jobs/workflow/adoption-contract';
import {parseCriteria} from '../../src/jobs/workflow/criteria-contract';

const area={template:'studio-workflow'};
const profile={schemaVersion:1,mode:'guided',styleId:'liquid-glass'};
const plan={title:'Corrigir identidade visual',objective:'Adotar integralmente Liquid Glass na interface',steps:[]};
const ref={id:'app.capability.ui',contract:'docs/ui.md',phase:'acceptance'};
const acceptance={key:'aceitacao-integrada',kind:'COMMAND',description:'Testar os fluxos reais de interface',config:{command:'npm run test:acceptance',capability:ref}};
const map={key:'mapa-de-adocao',kind:'FILE_EXISTS',description:'Mapa de adoção',config:{path:'docs/mapa.json',adoption:{artifact:'liquid-glass',packagePath:'frontend/src/design'}}};
function compile(raw:unknown,request?:string){
  const criteria=parseCriteria(compileLiquidGlassAdoption(raw,plan,area,profile,request),[],false);
  validateCapabilityCriteria(criteria);
  requireAdoptionContract({...plan,criteria},area,profile,request);
  return criteria;
}
describe('Compilação determinística de adoção Liquid Glass',()=>{
  it('compila mapa incompleto FILE_EXISTS sem nova sessão de IA, com aceitação real preservada',()=>{
    const criteria=compile([map,acceptance]);
    const structural=criteria.find(c=>c.key==='mapa-de-adocao')!;
    const a=adoptionOf(structural.config)!;
    expect(nativeAdoptionInventory(structural)).toBe(true);
    expect(a.manifest).toBe('docs/mapa.json');
    expect(a.packagePath).toBe('frontend/src/design');
    expect(a.families).toEqual(['shell','navigation','controls','forms','data','feedback']);
    expect(criteria.find(c=>c.key===acceptance.key)?.config).toMatchObject({command:'npm run test:acceptance',adoptionFamilies:a.families});
    expect(criteria.some(c=>c.kind==='MANUAL_APPROVAL')).toBe(true);
    expect(compile(criteria)).toEqual(criteria);
  });
  it('constrói o contrato nativo a partir de um comando integrado sem mapa',()=>{
    const criteria=compile([acceptance]);
    expect(criteria.some(nativeAdoptionInventory)).toBe(true);
    expect(criteria.filter(c=>c.kind==='COMMAND')).toHaveLength(1);
  });
  it('preserva a migração faseada e não declara adoção concluída',()=>{
    const criteria=compile([{...map,config:{...map.config,adoption:{...map.config.adoption,mode:'pilot',pending:['data','feedback']}}},acceptance]);
    expect(adoptionOf(criteria.find(nativeAdoptionInventory)!.config)).toMatchObject({mode:'pilot',pending:['data','feedback'],families:['shell','navigation','controls','forms']});
  });
  it('não inventa teste integrado, nem aceita comando trivial ou pendência contraditória',()=>{
    expect(()=>compile([map])).toThrow(/COMMAND de aceitação integrada/);
    expect(()=>compile([map,{...acceptance,config:{...acceptance.config,command:'true'}}])).toThrow();
    expect(()=>compile([{...map,config:{...map.config,adoption:{...map.config.adoption,mode:'complete',pending:['data']}}},acceptance])).toThrow();
  });
  it('não altera planos sem adoção de Liquid Glass',()=>{
    const raw=[acceptance];expect(compileLiquidGlassAdoption(raw,{title:'Corrigir SQL',objective:'Consulta',steps:[]},area,undefined)).toBe(raw);
  });
});
