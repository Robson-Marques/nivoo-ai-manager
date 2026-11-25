import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceService } from '../../storage/workspace.service';
import { descreverAnexo } from '../../conversations/attachments';
import { writeContextArchive,excerpt } from '../context-archive';
import { memoryLine,sortMemory,fullMemoryDocument } from '../context-builder';
import { readMotionInvocation } from '../../jobs/motion/command';
import type { PlannerRequest } from './types';

const MAX_MEMORIA=12_000;
const MAX_ARQUIVOS=300;

/** Reads project facts, never decides how to execute a task. */
export async function collectPlannerContext(prisma:PrismaService,workspace:WorkspaceService,request:PlannerRequest) {
  const {conversationId,messageId,project,anexos,worktree}=request;
  const cutoff=request.messageCreatedAt?{createdAt:{lte:request.messageCreatedAt}}:{};
    const [memoria, historico] = await Promise.all([
      prisma.memoryEntry.findMany({ where: { projectId: project.id, supersededById: null, camada: 'PROJETO' } }),
      prisma.conversationMessage.findMany({ where: { conversationId, id: { not: messageId },...cutoff }, orderBy: [{ createdAt: 'desc' },{id:'desc'}], ...(worktree?{}:{take:20}) }),
    ]);
    const arquivos = (await workspace.listMainFiles(project.dirKey)).filter((f) => !f.path.startsWith('.'));
    // Contexto de execução pertence ao PROJETO, não à conversa atual.
    // Uma conversa nova deve saber quais trabalhos terminaram, falharam ou
    // deixaram composição pronta antes de propor reconstruí-la.
    const trabalhosRecentes = await prisma.job.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true, title: true, status: true, blockedReason: true,
        createdAt: true, steps: {
          orderBy: { order: 'asc' },
          select: { key: true, title: true, status: true, provider: true, instructions:true },
        },
      },
    });
    const indiceTrabalhos = trabalhosRecentes.map(j => {
      const etapas = j.steps.map(e => {
        const op=e.provider==='local-shell'?readMotionInvocation(e.instructions):null;
        return `${e.key}:${e.status}${op?.output?' [Motion: '+JSON.stringify(op)+']':''}`;
      }).join(', ');
      return `- ${j.title} [${j.id}] ${j.status}${j.blockedReason ? ` (${j.blockedReason})` : ''}; etapas: ${etapas}`;
    });
    let memTxt = '';
    let omitted=0;
    for (const m of sortMemory(memoria)) {
      const l = memoryLine(m) + '\n';
      if (memTxt.length + l.length > MAX_MEMORIA){omitted++;continue;}
      memTxt += l;
    }
    const memArchive=worktree?writeContextArchive(worktree,'memoria-planejador',fullMemoryDocument(memoria,[])):null;
    if(memArchive)memTxt+='\nMemória integral, inclusive conteúdo abreviado e '+omitted+' entrada(s) fora do prompt: '+memArchive;
    else if(omitted)memTxt+='\n'+omitted+' entrada(s) omitidas pelo orçamento.';
    const renderMessage=(m:typeof historico[number],full:boolean)=>{
      const deles=anexos.filter(a=>a.mensagem===m.id);
      const lista=deles.length?'\n[anexos: '+deles.map(a=>descreverAnexo(a)).join('; ')+']':'';
      return (m.role==='USUARIO'?'USUÁRIO':'IA')+': '+(m.kind==='plano'?'[plano proposto'+(m.jobId?', aprovado':'')+'] ':'')+(full?m.content:excerpt(m.content,1500))+lista;
    };

  const atual=request.entrega?null:await prisma.conversationMessage.findFirst({
    where:{conversationId,role:'USUARIO',...cutoff},orderBy:[{createdAt:'desc'},{id:'desc'}]
  });
  const past=historico.filter(m=>m.id!==atual?.id&&(m.content.trim()!==''||m.role==='USUARIO'||anexos.some(a=>a.mensagem===m.id)));
  const archive=worktree?writeContextArchive(worktree,'conversa-planejador',[...past].reverse().map(m=>renderMessage(m,true)).join('\n\n')):null;
  const recent=past.slice(0,worktree?8:20).reverse().map(m=>renderMessage(m,!worktree));
  const conversa=[...(archive?['Histórico integral anterior à mensagem atual: '+archive+'. Em retomadas e pedidos de continuidade, consulte as páginas relevantes antes de planejar.']:[]),...recent].join('\n\n');
  const deles=atual?anexos.filter(a=>a.mensagem===atual.id):[];
  const originalVisualRequest=atual?.kind==='perfil-visual-confirmado'?past.find(m=>m.role==='USUARIO'):undefined;
  const currentMessage=[
    ...(originalVisualRequest?['Pedido original confirmado: '+originalVisualRequest.content]:[]),
    atual?.content||'(sem texto: o usuário só enviou anexos)',
    ...(deles.length?['','Anexos desta mensagem (LEIA/VEJA cada um antes de responder; imagens: abra o arquivo com a sua ferramenta de leitura):',...deles.map(a=>'- '+descreverAnexo(a))]:[])
  ];
  const fileArchive=worktree&&arquivos.length>MAX_ARQUIVOS?writeContextArchive(worktree,'arquivos-projeto',arquivos.map(f=>f.path).join('\n')):null;
  const fileIndex=`Arquivos da pasta principal do projeto (diretório atual): ${arquivos.slice(0, MAX_ARQUIVOS).map((f) => f.path).join(', ') || 'vazia'}${arquivos.length > MAX_ARQUIVOS ? ` … e mais ${arquivos.length - MAX_ARQUIVOS}` : ''}${fileArchive?' — índice integral: '+fileArchive:''}`;
  return {fileIndex,indiceTrabalhos,memTxt,conversa,currentMessage};
}
