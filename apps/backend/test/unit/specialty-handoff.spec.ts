import {specialtyHandoff} from '../../src/jobs/workflow/specialty-handoff';
const scope={version:1,projectId:'p',conversationId:'c',planMessageId:'m',cutoff:'2026-11-25T10:00:00Z',approvedAt:'2026-11-25T10:01:00Z',approvedBy:'operador',areaTemplate:'studio-workflow',alignment:'Status: especialidade não catalogada',request:{id:'u',content:'Desenvolver cadastro de clientes',kind:null},visual:{revision:1,profile:null}};
const files=[{status:'A',path:'docs/prompt-framework/catalogo-especialidades.md'},{status:'A',path:'docs/prompt-framework/especialidades/customer-management.md'}];
describe('Retomada após especialidade',()=>{
  it('identifica a entrega intermediária real do método',()=>expect(specialtyHandoff(scope,'p',files)).toEqual(scope));
  it('não confunde documentação avulsa, software ou outro projeto com lacuna aprovada',()=>{
    expect(specialtyHandoff(scope,'p',[...files,{status:'A',path:'src/index.ts'}])).toBeNull();
    expect(specialtyHandoff({...scope,alignment:'Status: alinhado'},'p',files)).toBeNull();
    expect(specialtyHandoff(scope,'other',files)).toBeNull();
    expect(specialtyHandoff({...scope,areaTemplate:'software'},'p',files)).toBeNull();
  });
});
