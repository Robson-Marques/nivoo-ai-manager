import {approvalPresentation} from '../../src/jobs/visual-previews';
describe('Apresentação da aprovação',()=>{
  const approval={kind:'CRITERIO_SUBJETIVO',subjectId:'c',description:'Critério subjetivo: O responsável aprova a capacidade com base na aplicação em prévia e nas evidências da aceitação integrada.'};
  const job={project:{area:{template:'studio-workflow'}},criteria:[{id:'c',kind:'MANUAL_APPROVAL',config:{capability:{id:'clientes',contract:'docs/clientes.md',phase:'decision'}}}],steps:[]};
  it('não exige quadros de Motion para aceitar uma aplicação',()=>expect(approvalPresentation(approval,job)).toBe('application'));
  it('preserva a aprovação de quadros de Motion',()=>expect(approvalPresentation({...approval,description:'Aprovar duas prévias'}, {...job,project:{area:{template:'design-video'}},steps:[{provider:'local-shell',instructions:'nivoo-conferir-arte motion/a --saida out/qualidade/a'}]})).toBe('images'));
  it('não inventa prévia para decisões sem essa exigência',()=>expect(approvalPresentation({...approval,description:'Aceitar contrato'},job)).toBe('decision'));
});
