import { Prisma,type Job,type Step } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SESSION_CONTEXT_DIR,WorkspaceService } from '../../storage/workspace.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ArtifactStoreService } from '../../storage/artifact-store.service';
import { copiarAnexosParaSessao } from '../../conversations/attachments';
import { jobsDaConversa } from '../../conversations/jobs-da-conversa';
import { mediaEnabledForArea,type AreaScope } from '../../specialties/media/scope';
import { conversaComoTexto } from './conversation';
import { restoreMotionResume,validMotionResumeId } from '../../jobs/motion/fps-resume';
import { resolveInside } from '../../common/path-guard';
import type { ExecutionLog } from './types';

type SessionJob=Job&{project:{dirKey:string;area:AreaScope&{slug:string}}};

/** Materializes existing facts and assets; never dispatches a provider or changes job state. */
export async function prepareExecutionWorkspace(prisma:PrismaService,workspace:WorkspaceService,artifacts:ArtifactStoreService,job:SessionJob,step:Step,providerId:string,isAi:boolean,worktree:string,knowledgeDir:string,L:ExecutionLog){
    // Etapa determinística de importação: disponibiliza os anexos do chat no
    // worktree para o binário nivoo-importar-imagem. Não abre sessão de IA.
    if (!isAi && providerId === 'local-shell' && /\bnivoo-importar-imagem\b/.test(step.instructions)) {
      const origemImportacao = await prisma.conversationMessage.findFirst({
        where: { jobId: job.id }, select: { conversationId: true },
      });
      if (origemImportacao) {
        const mensagens = await prisma.conversationMessage.findMany({
          where: { conversationId: origemImportacao.conversationId, role: 'USUARIO',
            NOT: { attachments: { equals: Prisma.DbNull } } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, conversationId: true, attachments: true },
        });
        const anexos = copiarAnexosParaSessao(
          workspace.projectDirs(job.project.dirKey).root, worktree, mensagens,
        );
        await L(`Importação local: ${anexos.length} anexo(s) disponível(is) em contexto/anexos/; execução sem IA`);
      }
    }
    // Defesa em profundidade: o conhecimento original do projeto (fora do workspace) não pode ser alterado
    // durante a tentativa. A impressão digital é tirada ANTES de qualquer escrita do próprio worker.
    const protectedBefore = isAi ? workspace.dirFingerprint(knowledgeDir) : null;
    let repoHarness: string[] = [];
    let docsPendentes = new Map<string, Buffer>();
    if (isAi) {
      // Padrões da base e conhecimento do projeto, renovados a cada sessão (leitura; fora do git).
      const ctx = workspace.prepareSessionContext(job.project.area.slug, job.project.dirKey, worktree);
      if (ctx.skipped) await L(`Contexto: ${ctx.skipped} arquivo(s) de referência não copiados por exceder o limite de tamanho`, 'WARN');
      // Anexos da conversa que originou este trabalho (imagens e documentos enviados no chat).
      const origem = await prisma.conversationMessage.findFirst({ where: { jobId: job.id }, select: { conversationId: true } });
      if (origem) {
        const comAnexos = await prisma.conversationMessage.findMany({
          where: { conversationId: origem.conversationId, role: 'USUARIO', NOT: { attachments: { equals: Prisma.DbNull } } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, conversationId: true, attachments: true },
        });
        const anexos = copiarAnexosParaSessao(workspace.projectDirs(job.project.dirKey).root, worktree, comAnexos);
        if (anexos.length) await L(`Anexos da conversa disponíveis para a IA: ${anexos.map((a) => a.caminho).join(', ')}`);
        // A conversa inteira que gerou o trabalho: o pedido do usuário (ex.: "as 16 seções") fica disponível em
        // cada sessão — antes só o resumo do objetivo chegava e a IA perguntava ao usuário o que ele já tinha dito.
        const conversa = await prisma.conversationMessage.findMany({
          where: { conversationId: origem.conversationId },
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, kind: true, createdAt: true, attachments: true },
        });
        fs.writeFileSync(path.join(worktree, SESSION_CONTEXT_DIR, 'conversa-do-pedido.md'), conversaComoTexto(conversa));
        // Resultados dos OUTROS trabalhos desta conversa (ex.: o plano de limpeza que este trabalho vai executar).
        const outros = (await jobsDaConversa(prisma, origem.conversationId)).filter((id) => id !== job.id);
        const resultados = await artifacts.copiarResultados(job.projectId, outros, path.join(worktree, SESSION_CONTEXT_DIR, 'resultados'));
        if (resultados.length) await L(`Resultados de trabalhos anteriores da conversa disponíveis para a IA: ${resultados.length} arquivo(s) em contexto/resultados/`);
        if (mediaEnabledForArea(job.project.area) || step.instructions.includes('[NIVOO_MOTION_CORE_CONTRACT_V1]')) {
          // Ordena por criação: o recuperador dá prioridade aos trabalhos mais recentes.
          const trabalhosAnteriores = await prisma.job.findMany({
            where: { projectId: job.projectId, id: { in: outros } },
            orderBy: { createdAt: 'asc' }, select: { id: true },
          });
          // Fontes anteriores são auxiliares: falha de leitura em um worktree antigo
          // não pode derrubar a tentativa atual nem iniciar novas sessões para reparar cache.
          try {
            const fontes = workspace.copiarFontesMotionAnteriores(job.project.dirKey, trabalhosAnteriores.map(x => x.id), worktree);
            if (fontes.arquivos) await L(`Fontes motion editáveis recuperadas: ${fontes.arquivos} arquivo(s) de ${fontes.trabalhos.join(', ')} em contexto/fontes-anteriores/; trabalhos originais preservados`);
            if (fontes.ignorados) await L(`Fontes anteriores: ${fontes.ignorados} item(ns) omitidos por segurança/tamanho; não presumir que a fonte esteja completa`, 'WARN');
          } catch (e: any) {
            await L(`Recuperação auxiliar das fontes motion anteriores indisponível: ${String(e?.message ?? e).slice(0, 300)}; preservando a etapa e os arquivos atuais`, 'WARN');
          }
        }
      }
      // Instruções de agente do próprio repositório: cópia legível em contexto/repositorio/, restauradas depois.
      repoHarness = await workspace.hideRepoHarness(worktree);
      // Documentos de instrução escritos por uma sessão anterior que ainda não viraram commit (a sessão acabou sem
      // concluir a etapa): são do trabalho. Saem da pasta durante esta sessão (cópia legível em contexto/repositorio/)
      // e voltam depois — antes a limpeza abaixo os apagava.
      const naoVersionados = workspace.docsNoTrabalho(worktree).filter((f) => !repoHarness.includes(f));
      docsPendentes = workspace.capturarDocsEditados(worktree, naoVersionados);
      for (const [rel, conteudo] of docsPendentes) {
        const dest = path.join(worktree, SESSION_CONTEXT_DIR, 'repositorio', WorkspaceService.sessionPath(rel));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, conteudo);
      }
      const planted = workspace.sanitizeHarnessFiles(worktree).filter((f) => !repoHarness.includes(f) && !docsPendentes.has(f) && !f.startsWith('contexto/'));
      if (planted.length) await L(`Arquivos de harness removidos antes da sessão (não fazem parte do trabalho): ${planted.join(', ')}`, 'WARN');
    }
    const sourceJob=(step.providerOptions as Record<string,unknown>|null)?.motionSourceJobId;
    if(!isAi&&providerId==='local-shell'&&sourceJob!==undefined){
      if(!validMotionResumeId(sourceJob)||sourceJob===job.id)throw new Error('Origem Motion de retomada inválida.');
      const origin=await prisma.conversationMessage.findFirst({where:{jobId:job.id},select:{conversationId:true}});
      const allowed=origin?await jobsDaConversa(prisma,origin.conversationId):[];
      const prior=await prisma.job.findFirst({where:{id:sourceJob,projectId:job.projectId},select:{id:true,status:true}});
      if(!prior||!allowed.includes(sourceJob)||!['BLOQUEADO','FALHOU','CONCLUIDO'].includes(prior.status))throw new Error('Origem Motion não pertence a um trabalho anterior desta conversa e projeto.');
      const original=resolveInside(workspace.projectDirs(job.project.dirKey).worktrees,sourceJob);
      restoreMotionResume(original,worktree,sourceJob,step.instructions);
      await L('Composição original recuperada do trabalho '+sourceJob.slice(0,8)+'; renderização local sem nova sessão de IA.');
    }
    // As etapas locais também podem consumir arquivos de trabalhos anteriores.
    // Antes só as sessões de IA recebiam contexto/resultados/, portanto um plano
    // de recuperação com local-shell falhava em "cp: arquivo inexistente", mesmo
    // quando o artefato já estava guardado no catálogo do Nivoo.
    if (!isAi) {
      const origem = await prisma.conversationMessage.findFirst({
        where: { jobId: job.id }, select: { conversationId: true },
      });
      if (origem) {
        const outros = (await jobsDaConversa(prisma, origem.conversationId))
          .filter(id => id !== job.id);
        const resultados = await artifacts.copiarResultados(
          job.projectId, outros, path.join(worktree, SESSION_CONTEXT_DIR, 'resultados'),
        );
        if (resultados.length) {
          await L(`Resultados anteriores disponíveis também ao executor local: ${resultados.length} arquivo(s) em contexto/resultados/`);
        }
      }
    }

  return {protectedBefore,repoHarness,docsPendentes};
}
