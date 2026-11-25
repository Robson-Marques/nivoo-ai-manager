import { bindPlanningSource,readPlanningSource,readApprovedScope,approvedScopeDocument,approvedConversationFilter,type ApprovedScope } from '../../src/jobs/approved-scope';
const source={projectId:'p',areaId:'a',cutoff:'2026-11-25T10:00:00.000Z',visualRevision:3};
describe('Escopo aprovado e origem do plano',()=>{
  it('vincula a origem real e substitui metadados não confiáveis do modelo',()=>{
    const plan=bindPlanningSource({objective:'Cadastrar clientes',planningSource:{projectId:'outro'}},source);
    expect(readPlanningSource(plan)).toEqual(source);
    expect(readPlanningSource({planningSource:{...source,cutoff:'erro'}})).toBeNull();
  });
  it('preserva o alinhamento, pedido e revisão visual da aprovação, sem usar mensagens posteriores',()=>{
    const scope:ApprovedScope={version:1,projectId:'p',conversationId:'c',planMessageId:'m',cutoff:source.cutoff,approvedAt:'2026-11-25T11:00:00Z',approvedBy:'operador',areaTemplate:'studio-workflow',alignment:'Cadastro completo, sem exclusão',request:{id:'u',content:'Cadastrar clientes',kind:null},visual:{revision:3,profile:null}};
    expect(readApprovedScope(scope,'outro')).toBeNull();
    expect(readApprovedScope(scope,'p')).toEqual(scope);
    expect(approvedConversationFilter(scope)).toEqual({conversationId:'c',createdAt:{lte:new Date(source.cutoff)}});
    expect(approvedScopeDocument(scope)).toContain('Cadastro completo, sem exclusão');
    expect(approvedScopeDocument(scope)).toContain('Cadastrar clientes');
    expect(approvedScopeDocument(scope)).toContain('revisão 3');
  });
});
