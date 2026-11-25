import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import { ConversationsService } from '../../src/conversations/conversations.service';
import { WorkspaceService } from '../../src/storage/workspace.service';
import { ArtifactStoreService } from '../../src/storage/artifact-store.service';
import { prepareExecutionWorkspace } from '../../src/worker/executor/workspace';
import { bindPlanningSource } from '../../src/jobs/approved-scope';
import { createHarness,Harness,truncateAll } from '../support/harness';

describe('Escopo aprovado no chat',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);});
  afterAll(()=>h.close());
  const plan={
    title:'Cadastro de clientes',objective:'Consultar e cadastrar clientes; exclusão fora do escopo',
    defaultProvider:'local-shell',
    steps:[{key:'cadastro',title:'Cadastro',instructions:'echo cadastro > cadastro.txt'}],
    criteria:[{key:'cadastro',kind:'FILE_EXISTS',description:'Cadastro implementado',config:{path:'cadastro.txt'}}],
  };
  async function fixture(){
    const p=(await h.http().post('/api/projects').send({name:'Escopo '+Date.now()+Math.random(),base:'studio-workflow'}).expect(201)).body;
    const c=(await h.http().post('/api/projects/'+p.id+'/conversations').send({}).expect(201)).body;
    const project=await h.prisma.project.findUniqueOrThrow({where:{id:p.id}});
    const cutoff=new Date(Date.now()-10000);
    const u=await h.prisma.conversationMessage.create({data:{conversationId:c.id,role:'USUARIO',content:'Cadastrar clientes sem exclusão',createdAt:new Date(cutoff.getTime()-1000)}});
    const msg=await h.prisma.conversationMessage.create({data:{conversationId:c.id,role:'ASSISTENTE',kind:'plano',content:'Relatório de alinhamento: cadastro sem exclusão',createdAt:cutoff,plan:bindPlanningSource(plan as unknown as Prisma.InputJsonValue,{projectId:p.id,areaId:project.areaId,cutoff:cutoff.toISOString(),visualRevision:project.visualProfileRevision})}});
    await h.prisma.conversationMessage.create({data:{conversationId:c.id,role:'USUARIO',content:'PEDIDO_POSTERIOR_NAO_APROVADO: excluir todos os clientes',createdAt:new Date(cutoff.getTime()+1000)}});
    return {p,c,msg,u};
  }
  it('exige Fazer no Studio e mantém o pedido anterior ao corte durante a execução',async()=>{
    const {p,c,msg,u}=await fixture();
    const service=h.app.get(ConversationsService);
    await expect(service.approve(p.id,c.id,msg.id,{decidedBy:'Nivoo (seguindo o seu pedido)'},true)).rejects.toThrow('gate Fazer');
    expect(await h.prisma.job.count({where:{projectId:p.id}})).toBe(0);
    const r=await h.http().post('/api/projects/'+p.id+'/conversations/'+c.id+'/messages/'+msg.id+'/approve').send({decidedBy:'operador',start:false}).expect(201);
    const jid=r.body.messages.find((m:any)=>m.id===msg.id).jobId;
    const job=await h.prisma.job.findUniqueOrThrow({where:{id:jid},include:{project:{include:{area:true}},steps:true}});
    expect(job.approvedScope).toMatchObject({planMessageId:msg.id,alignment:msg.content,request:{id:u.id,content:u.content},visual:{revision:0}});
    const ws=h.app.get(WorkspaceService);
    const worktree=await ws.ensureJobWorktree(job.project.dirKey,job.id);
    await prepareExecutionWorkspace(h.prisma,ws,h.app.get(ArtifactStoreService),job,job.steps[0],'claude-code-cli',true,worktree,ws.projectDirs(job.project.dirKey).knowledge,async()=>{});
    const history=fs.readFileSync(path.join(worktree,'contexto/conversa-do-pedido.md'),'utf8');
    expect(history).toContain(u.content);
    expect(history).not.toContain('PEDIDO_POSTERIOR_NAO_APROVADO');
  });
  it('não aceita um plano criado antes da alteração do perfil visual',async()=>{
    const {p,c,msg}=await fixture();
    await h.prisma.project.update({where:{id:p.id},data:{visualProfileRevision:{increment:1}}});
    await h.http().post('/api/projects/'+p.id+'/conversations/'+c.id+'/messages/'+msg.id+'/approve').send({decidedBy:'operador',start:false}).expect(409);
    expect(await h.prisma.job.count({where:{projectId:p.id}})).toBe(0);
  });
});
