import {createHarness,Harness,truncateAll} from '../support/harness';

describe('Chat — assistente de definição visual',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);});
  afterAll(async()=>{await h.close();});
  async function create(name:string,base='software'){
    const p=(await h.http().post('/api/projects').send({name,base}).expect(201)).body;
    const c=(await h.http().post('/api/projects/'+p.id+'/conversations').send({}).expect(201)).body;
    return {p,c,url:'/api/projects/'+p.id+'/conversations/'+c.id+'/messages'};
  }
  it('pergunta sem chamada de IA, persiste resposta explícita e enfileira somente planejamento',async()=>{
    const {p,c,url}=await create('Descoberta visual');
    const a=(await h.http().post(url).send({content:'Crie um ERP para um provedor de internet'}).expect(201)).body;
    const m=a.messages.find((x:any)=>x.kind==='perfil-visual');
    expect(m.status).toBe('PRONTA');
    expect(m.startedAt).toBeNull();
    expect(new Date(m.createdAt).getTime()).toBeGreaterThan(new Date(a.messages[0].createdAt).getTime());
    expect(m.perguntas).toHaveLength(4);
    expect(await h.prisma.queueTask.count({where:{messageId:m.id}})).toBe(0);
    const selection={schemaVersion:1,mode:'guided',styleId:'liquid-glass',paletteId:'emerald',theme:'dark',density:'compact'};
    const b=(await h.http().post(url).send({visualAnswer:{messageId:m.id,profile:selection}}).expect(201)).body;
    const updated=await h.prisma.project.findUniqueOrThrow({where:{id:p.id}});
    expect(updated.visualProfile).toEqual(selection);
    expect(updated.visualProfileRevision).toBe(1);
    expect(b.messages.filter((x:any)=>x.status==='PENDENTE')).toHaveLength(1);
    const confirmed=b.messages.find((x:any)=>x.kind==='perfil-visual-confirmado');
    expect(confirmed).toBeDefined();
    expect(new Date(confirmed.createdAt).getTime()).toBeGreaterThan(new Date(m.createdAt).getTime());
    expect(await h.prisma.job.count({where:{projectId:p.id}})).toBe(0);
    await h.http().post(url).send({visualAnswer:{messageId:m.id,profile:selection}}).expect(409);
  });
  it('apresenta a seleção para o pedido exato do teste mesmo depois de uma conversa preliminar',async()=>{
    const {p,c,url}=await create('Regressão visual');
    await h.prisma.conversationMessage.create({data:{conversationId:c.id,role:'USUARIO',content:'Olá'}});
    await h.prisma.conversationMessage.create({data:{conversationId:c.id,role:'ASSISTENTE',content:'Como posso ajudar?'}});
    const a=(await h.http().post(url).send({content:"Quero desenvolver um sistema completo de gerenciamento de clientes, com cadastro, edição, exclusão, pesquisa, filtros, dashboard com indicadores reais e banco de dados persistente.\n\nO sistema deverá funcionar em computadores e celulares, possuir uma interface profissional, validação de formulários e testes funcionais."}).expect(201)).body;
    const m=a.messages.at(-1);
    expect(m.kind).toBe('perfil-visual');
    expect(m.perguntas).toHaveLength(4);
    expect(await h.prisma.queueTask.count({where:{messageId:m.id}})).toBe(0);
    expect(await h.prisma.job.count({where:{projectId:p.id}})).toBe(0);
    const next=(await h.http().post(url).send({content:'Prefiro seguir a identidade própria que descrevi em texto.'}).expect(201)).body;
    expect(next.messages.some((m:any)=>m.kind==='perfil-visual-briefing')).toBe(true);
    expect(next.messages.at(-1).status).toBe('PENDENTE');
  });
  it('correção pontual segue diretamente ao planejador',async()=>{
    const {url}=await create('Manutenção visual');
    const a=(await h.http().post(url).send({content:'Corrigir endpoint'}).expect(201)).body;
    expect(a.messages.some((x:any)=>x.kind==='perfil-visual')).toBe(false);
    expect(a.messages.some((x:any)=>x.status==='PENDENTE')).toBe(true);
  });
  it('reabre a seleção visual ao pedir nova cara num software que já existe',async()=>{
    // Projeto existente (com repositório): um ajuste comum vai direto ao planejador, sem telas.
    const comum=await create('Ajuste em software existente');
    await h.prisma.project.update({where:{id:comum.p.id},data:{gitUrl:'https://example.com/app.git'}});
    const base=(await h.http().post(comum.url).send({content:'Adicionar um campo no cadastro de clientes'}).expect(201)).body;
    expect(base.messages.some((x:any)=>x.kind==='perfil-visual')).toBe(false);
    expect(base.messages.some((x:any)=>x.status==='PENDENTE')).toBe(true);
    // Outro projeto existente: pedido de nova cara reabre a seleção visual, com Liquid Glass recomendado.
    const red=await create('Redesign de software existente');
    await h.prisma.project.update({where:{id:red.p.id},data:{gitUrl:'https://example.com/app2.git'}});
    const a=(await h.http().post(red.url).send({content:'Quero dar uma nova cara ao sistema e migrar para Liquid Glass'}).expect(201)).body;
    const m=a.messages.find((x:any)=>x.kind==='perfil-visual');
    expect(m).toBeDefined();
    expect(m.perguntas).toHaveLength(4);
    expect(m.perguntas[0].opcoes[0].id).toBe('liquid-glass');
    expect(await h.prisma.queueTask.count({where:{messageId:m.id}})).toBe(0);
  });
});
