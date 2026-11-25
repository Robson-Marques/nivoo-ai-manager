import {visualDiscoveryIntent,visualDiscoveryQuestions,profileFromVisualAnswers,validateVisualSelection,visualDecisionText,visualDiscoveryReason} from '../../src/projects/visual-discovery';

describe('Assistente de definição visual',()=>{
  it('detecta criação de produto visual e não manutenção ou briefing já decidido',()=>{
    for(const s of ['Crie um ERP para um provedor de internet','Desenvolva um sistema de cadastro de clientes','Criar um site para a pizzaria','Quero um aplicativo de gestão','Montar um dashboard'])expect(visualDiscoveryIntent(s)).toBe(true);
    for(const s of ['Corrigir endpoint','Criar API','Criar script Python','Corrigir dashboard','Como criar um site?','Criar um vídeo','Crie um ERP Liquid Glass','Criar site, escolha por mim','Criar sistema sem perguntas','Criar software'])expect(visualDiscoveryIntent(s)).toBe(false);
  });
  it('não confunde histórico de conversa com definição visual',()=>{
    const input={software:true,profile:null,hasWork:false,answered:false,text:"Quero desenvolver um sistema completo de gerenciamento de clientes, com cadastro, edição, exclusão, pesquisa, filtros, dashboard com indicadores reais e banco de dados persistente.\n\nO sistema deverá funcionar em computadores e celulares, possuir uma interface profissional, validação de formulários e testes funcionais."};
    expect(visualDiscoveryIntent(input.text)).toBe(true);
    expect(visualDiscoveryReason(input)).toBe('ask');
    expect(visualDiscoveryReason({...input,profile:undefined})).toBe('ask');
    expect(visualDiscoveryReason({...input,profile:{schemaVersion:1,mode:'delegated'}})).toBe('profile-defined');
    expect(visualDiscoveryReason({...input,hasWork:true})).toBe('existing-work');
    expect(visualDiscoveryReason({...input,gitUrl:'https://example.com/repo'})).toBe('existing-repository');
    expect(visualDiscoveryReason({...input,software:false})).toBe('other-domain');
    expect(visualDiscoveryReason({...input,answered:true})).toBe('answered');
    expect(visualDiscoveryReason({...input,text:'Corrigir endpoint'})).toBe('not-new-ui');
  });
  it('recomenda sem impor, delega e valida respostas do chat existente',()=>{
    const q=visualDiscoveryQuestions('Criar ERP','p',0);
    expect(q).toHaveLength(4);
    expect(q[0].opcoes[0].id).toBe('corporate');
    expect(visualDiscoveryQuestions('Criar aplicativo','p',0)[0].opcoes[0].id).toBe('liquid-glass');
    const answer=(ids:string[])=>['Minhas respostas:',...q.map((x,i)=>(i+1)+'. '+x.pergunta+'\n→ '+x.opcoes.find(o=>o.id===ids[i])!.rotulo)].join('\n\n');
    expect(profileFromVisualAnswers(answer(['liquid-glass','both','geometric','system']),q,'p',0)).toEqual({schemaVersion:1,mode:'guided',styleId:'liquid-glass',usage:'both',fonts:{heading:'manrope',body:'inter',mono:'system-mono'},theme:'system'});
    expect(profileFromVisualAnswers(answer(['delegated','delegated','delegated','delegated']),q,'p',0)).toEqual({schemaVersion:1,mode:'delegated'});
    expect(profileFromVisualAnswers(answer(['corporate','both','delegated','light']),q,'p',0)?.mode).toBe('delegated');
    expect(profileFromVisualAnswers(answer(['corporate','both','native','light'])+'; outra fonte',q,'p',0)).toBeNull();
    expect(profileFromVisualAnswers(answer(['corporate','both','native','light']),q,'outro',0)).toBeNull();
    expect(profileFromVisualAnswers(answer(['corporate','both','native','light']),q,'p',1)).toBeNull();
    expect(profileFromVisualAnswers('Quero estilo personalizado',q,'p',0)).toBeNull();
    expect(validateVisualSelection({schemaVersion:1,mode:'guided',paletteId:'emerald',density:'compact'},'p',0,q)).toEqual({schemaVersion:1,mode:'guided',paletteId:'emerald',density:'compact'});
    expect(()=>validateVisualSelection({schemaVersion:1,mode:'guided',paletteId:'unknown'},'p',0,q)).toThrow();
    expect(()=>validateVisualSelection({schemaVersion:1,mode:'delegated'},'p',1,q)).toThrow();
    expect(visualDecisionText({schemaVersion:1,mode:'delegated'})).toContain('plano para aprovação');
  });
});
