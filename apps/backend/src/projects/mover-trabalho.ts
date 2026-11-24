import { PrismaService } from '../prisma/prisma.service';
import { aiConnectionIds } from '../accounts/connections';
import { nativeImageTarget } from '../providers/codex-image-assets';
import { OrchestratorService } from '../jobs/orchestrator.service';

/**
 * Trocou a IA do projeto (ex.: acabou o crédito de uma): o trabalho ainda não terminado passa para a
 * nova IA e, se estava esperando a IA anterior voltar, continua já. Cada sessão reconstrói o contexto
 * do projeto (regras, conhecimento, memória, pasta, notas e checkpoints), então nada depende da IA anterior.
 */
export async function moverTrabalhoParaIa(prisma: PrismaService, projectId: string, provider: string,automatic?:{from:string;jobId?:string}): Promise<void> {
  const ai = aiConnectionIds();
  const jobs = await prisma.job.findMany({
    where: { projectId,...(automatic?.jobId?{id:automatic.jobId}:{}), status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO', 'BLOQUEADO', 'FALHOU'] } },
    select: { id: true, defaultProvider: true },
  });
  for (const j of jobs) {
    await prisma.$transaction(async tx=>{
      await OrchestratorService.lockJob(tx,j.id);
      const current=await tx.job.findUnique({where:{id:j.id},include:{steps:true}});
      if(!current||current.status==='CONCLUIDO')return;
      const eligible=current.steps.filter(s=>{
        const id=s.provider??current.defaultProvider;
        const opts=(s.providerOptions??{}) as Record<string,unknown>;
        return !['CONCLUIDO','EXECUTANDO'].includes(s.status)&&ai.includes(id)&&
          (!automatic||id===automatic.from)&&!nativeImageTarget(opts.visualAsset)&&!opts.model;
      });
      if(!eligible.length)return;
      // Materialize an explicit provider for affected steps only. Do not rewrite
      // the default underneath running, completed or model-pinned steps.
      await tx.step.updateMany({where:{id:{in:eligible.map(s=>s.id)}},data:{provider}});
      await tx.queueTask.updateMany({where:{jobId:j.id,stepId:{in:eligible.map(s=>s.id)},type:'RUN_STEP',status:'QUEUED'},data:{runAt:new Date(),resourceWaits:0}});
    });
  }
}


/**
 * IAs que acabaram de ficar sem crédito/limite/login (id → até quando). A conexão só mostra o login; sem esta
 * memória, duas reservas sem crédito trocariam uma pela outra sem parar. Depois do prazo, voltam a valer.
 */
const ESPERA_SEM_CREDITO_MS = 30 * 60_000;
const semCredito = new Map<string, number>();

export function marcarSemCredito(id: string, agora = Date.now()): void {
  semCredito.set(id, agora + ESPERA_SEM_CREDITO_MS);
}

export function estaSemCredito(id: string, agora = Date.now()): boolean {
  const ate = semCredito.get(id);
  if (ate === undefined) return false;
  if (ate > agora) return true;
  semCredito.delete(id);
  return false;
}

/**
 * IA reserva: se a IA do projeto ficou sem crédito/limite/login, escolhe a próxima da lista de reserva do
 * projeto que esteja conectada AGORA, passa o projeto e o trabalho em andamento para ela e devolve o id.
 * Sem reserva disponível: null (o trabalho espera a IA voltar e a tela oferece trocar).
 */
export async function trocarParaReserva(
  prisma: PrismaService,
  registry: { has(id: string): boolean; status(id: string, maxAgeMs?: number): Promise<{ available: boolean; label: string }> },
  projectId: string,
  indisponivel: string,
  jobId?:string,
): Promise<{ id: string; nome: string; anterior: string } | null> {
  marcarSemCredito(indisponivel);
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { provider: true, aiReserva: true } });
  if (!p || p.provider !== indisponivel) return null;
  const reserva = (Array.isArray(p.aiReserva) ? p.aiReserva : []).map(String).filter((id) => id !== indisponivel && registry.has(id) && !estaSemCredito(id));
  for (const id of reserva) {
    const st = await registry.status(id, 0);
    if (!st.available) continue;
    const anterior = (await registry.status(indisponivel, 60_000)).label;
    // Só troca se ninguém trocou antes (worker e conversa podem perceber ao mesmo tempo).
    const r = await prisma.project.updateMany({ where: { id: projectId, provider: indisponivel }, data: { provider: id } });
    if (!r.count) return null;
    // A reserve changes the project preference for future work, not unrelated jobs.
    if(jobId)await moverTrabalhoParaIa(prisma,projectId,id,{from:indisponivel,jobId});
    return { id, nome: st.label, anterior };
  }
  return null;
}
