import {validateAdoptionCriteria,requireAdoptionContract,adoptionSummaries} from '../../src/jobs/workflow/adoption-contract';
import {verifyAdoptionCoverage} from '../../src/jobs/workflow/adoption-evidence';
const make=(mode='complete',pending:string[]=[])=>[
  {key:'estrutura',kind:'COMMAND',config:{command:'node verify-structure.js',capability:{id:'app',contract:'docs/cap.md',phase:'structural'},adoption:{artifact:'biblioteca',source:'https://example.test/library',revision:'1.0',mode,manifest:'docs/adocao.json',families:['forms','controls'],pending}}},
  {key:'aceite',kind:'COMMAND',config:{command:'npm run test:acceptance',capability:{id:'app',contract:'docs/cap.md',phase:'acceptance'},adoptionFamilies:['forms','controls']}},
  {key:'decisao',kind:'MANUAL_APPROVAL',config:{capability:{id:'app',contract:'docs/cap.md',phase:'decision'}}}
];
describe('Contrato de adoção',()=>{
  it('não permite concluir com famílias sem cobertura ou pendências escondidas',()=>{
    const c=make();
    expect(()=>validateAdoptionCriteria(c)).not.toThrow();
    expect(()=>validateAdoptionCriteria(make('complete',['data']))).toThrow();
    expect(()=>validateAdoptionCriteria(make().map(x=>x.key==='aceite'?{...x,config:{...x.config,adoptionFamilies:['forms']}}:x))).toThrow();
    expect(()=>validateAdoptionCriteria(make().slice(0,2))).toThrow();
  });
  it('explicita adoção parcial e impede conclusão integral por simples ausência do contrato',()=>{
    const c=make('pilot',['data']);
    expect(()=>validateAdoptionCriteria(c)).not.toThrow();
    expect(adoptionSummaries(c)[0]).toContain('INCOMPLETA');
    expect(()=>requireAdoptionContract({title:'Adotar biblioteca',objective:'Adotar biblioteca original',steps:[],criteria:[]},{template:'software'})).toThrow();
  });
  it('exige o contrato do Liquid Glass em uma entrega nova, mesmo se o plano omitir Capability',()=>{
    const profile={schemaVersion:1,mode:'guided',styleId:'liquid-glass'};
    const plan={title:'Implementar o sistema de gestão de clientes',objective:'Criar sistema com dashboard e formulários',steps:[],criteria:[]};
    expect(()=>requireAdoptionContract(plan,{template:'studio-workflow'},profile)).toThrow();
    expect(()=>requireAdoptionContract({...plan,title:'Corrigir SQL',objective:'Corrigir consulta',steps:[]},{template:'studio-workflow'},profile)).not.toThrow();
  });
  it('exige evidência por família da conferência existente',()=>{
    expect(verifyAdoptionCoverage('Tests: 10 passed',['forms'])).toEqual(['forms']);
    expect(verifyAdoptionCoverage('# NIVOO_ADOPTION_EVIDENCE {"family":"forms","passed":true,"scenario":"Salvar e consultar"}',['forms','controls'])).toEqual(['controls']);
  });
});
