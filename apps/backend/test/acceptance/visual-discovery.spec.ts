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
  it('correção pontual segue diretamente ao planejador',async()=>{
    const {url}=await create('Manutenção visual');
    const a=(await h.http().post(url).send({content:'Corrigir endpoint'}).expect(201)).body;
    expect(a.messages.some((x:any)=>x.kind==='perfil-visual')).toBe(false);
    expect(a.messages.some((x:any)=>x.status==='PENDENTE')).toBe(true);
  });
});
