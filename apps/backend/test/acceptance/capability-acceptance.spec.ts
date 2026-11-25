import { createHarness, Harness, truncateAll, waitFor } from '../support/harness';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Capability: avaliação real respeita as fases',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);h.worker.start();});
  afterAll(()=>h.close());
  it('não executa aceitação nem solicita decisão enquanto a estrutura falha',async()=>{
    const p=(await h.http().post('/api/projects').send({name:'Capability fases',base:'studio-workflow'}).expect(201)).body;
    const url='/api/projects/'+p.id+'/jobs';
    const ref=(phase:string)=>({id:'fixture.capability.clientes',contract:'docs/clientes.md',phase});
    const body={
      title:'Fixture de aceitação',objective:'Exercitar a ordem de avaliação do Nivoo em um contrato de teste.',
      defaultProvider:'local-shell',
      steps:[{key:'a',title:'Construção',instructions:"mkdir -p docs && printf 'in-progress\\n' > docs/clientes.md"}],
      criteria:[
        {key:'decisao',description:'Aceitação da capacidade de teste',kind:'MANUAL_APPROVAL',config:{capability:ref('decision')}},
        {key:'integrado',description:'Comando de teste integrado da fixture',kind:'COMMAND',config:{capability:ref('acceptance'),command:"grep -qx 'structurally-complete' docs/clientes.md && printf 'executado\\n' > out/aceitacao-fixture.txt"}},
        {key:'estrutura',description:'Dependência estrutural da fixture',kind:'COMMAND',config:{capability:ref('structural'),command:"grep -qx 'structurally-complete' docs/clientes.md"}},
      ],
    };
    const j=(await h.http().post(url).send(body).expect(201)).body;
    const state=async(status:string)=>waitFor(async()=>{
      const r=(await h.http().get(url+'/'+j.id).expect(200)).body;
      return r.status===status?r:null;
    },60000);
    await h.http().post(url+'/'+j.id+'/start').expect(201);
    const blocked=await state('BLOQUEADO');
    expect(blocked.criteria.find((x:any)=>x.key==='estrutura').status).toBe('REPROVADO');
    expect(blocked.criteria.find((x:any)=>x.key==='integrado').status).toBe('PENDENTE');
    expect(blocked.criteria.find((x:any)=>x.key==='integrado').checks).toHaveLength(0);
    expect(blocked.criteria.find((x:any)=>x.key==='decisao').status).toBe('PENDENTE');
    expect(blocked.approvals).toHaveLength(0);
    const wt=path.join(p.workspacePath,'worktrees',j.id);
    expect(fs.existsSync(path.join(wt,'out/aceitacao-fixture.txt'))).toBe(false);
    await h.http().post(url+'/'+j.id+'/steps').send({steps:[{key:'b',title:'Completar estrutura da fixture',dependsOn:['a'],instructions:"printf 'structurally-complete\\n' > docs/clientes.md"}]}).expect(201);
    await h.http().post(url+'/'+j.id+'/resume').send({}).expect(201);
    const waiting=await state('AGUARDANDO_APROVACAO');
    expect(waiting.criteria.find((x:any)=>x.key==='estrutura').status).toBe('APROVADO');
    expect(waiting.criteria.find((x:any)=>x.key==='integrado').status).toBe('APROVADO');
    expect(fs.readFileSync(path.join(wt,'out/aceitacao-fixture.txt'),'utf8')).toContain('executado');
    const approval=waiting.approvals.find((x:any)=>x.kind==='CRITERIO_SUBJETIVO');
    expect(approval.status).toBe('PENDENTE');
    await h.http().post('/api/approvals/'+approval.id+'/decide').send({decision:'APROVADO',decidedBy:'operador'}).expect(201);
    const done=await state('CONCLUIDO');
    expect(done.criteria.every((x:any)=>x.status==='APROVADO')).toBe(true);
  });
});
