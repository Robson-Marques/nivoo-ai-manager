import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceService } from '../../storage/workspace.service';
import { descreverAnexo } from '../../conversations/attachments';
import { memoryLine,sortMemory } from '../context-builder';
import type { PlannerRequest } from './types';

const MAX_MEMORIA=15_000;
const MAX_ARQUIVOS=300;

/** Reads project facts, never decides how to execute a task. */
export async function collectPlannerContext(prisma:PrismaService,workspace:WorkspaceService,request:PlannerRequest) {
  const {conversationId,messageId,project,anexos}=request;
    const [memoria, historico] = await Promise.all([
      prisma.memoryEntry.findMany({ where: { projectId: project.id, supersededById: null, camada: 'PROJETO' } }),
      prisma.conversationMessage.findMany({ where: { conversationId, id: { not: messageId } }, orderBy: { createdAt: 'desc' }, take: 20 }),
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
          select: { key: true, title: true, status: true, provider: true },
        },
      },
    });
    const indiceTrabalhos = trabalhosRecentes.map(j => {
      const etapas = j.steps.map(e => `${e.key}:${e.status}`).join(', ');
      return `- ${j.title} [${j.id}] ${j.status}${j.blockedReason ? ` (${j.blockedReason})` : ''}; etapas: ${etapas}`;
    });
    let memTxt = '';
    for (const m of sortMemory(memoria)) {
      const l = memoryLine(m) + '\n';
      if (memTxt.length + l.length > MAX_MEMORIA) break;
      memTxt += l;
    }
    const conversa = historico
      .reverse()
      .map((m) => {
        const deles = anexos.filter((a) => a.mensagem === m.id);
        const lista = deles.length ? `\n[anexos: ${deles.map((a) => descreverAnexo(a)).join('; ')}]` : '';
        return `${m.role === 'USUARIO' ? 'USUÁRIO' : 'IA'}: ${m.kind === 'plano' ? `[plano proposto${m.jobId ? ', aprovado' : ''}] ` : ''}${m.content.slice(0, 3000)}${lista}`;
      })
      .join('\n\n');

  const atual=request.entrega?null:await prisma.conversationMessage.findFirst({
    where:{conversationId,role:'USUARIO'},orderBy:{createdAt:'desc'}
  });
  const deles=atual?anexos.filter(a=>a.mensagem===atual.id):[];
  const currentMessage=[
    atual?.content||'(sem texto: o usuário só enviou anexos)',
    ...(deles.length?['','Anexos desta mensagem (LEIA/VEJA cada um antes de responder; imagens: abra o arquivo com a sua ferramenta de leitura):',...deles.map(a=>'- '+descreverAnexo(a))]:[])
  ];
  const fileIndex=`Arquivos da pasta principal do projeto (diretório atual): ${arquivos.slice(0, MAX_ARQUIVOS).map((f) => f.path).join(', ') || 'vazia'}${arquivos.length > MAX_ARQUIVOS ? ` … e mais ${arquivos.length - MAX_ARQUIVOS}` : ''}`;
  return {fileIndex,indiceTrabalhos,memTxt,conversa,currentMessage};
}
