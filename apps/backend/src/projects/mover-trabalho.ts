import { PrismaService } from '../prisma/prisma.service';
import { aiConnectionIds } from '../accounts/connections';
import { chooseReserve,reservePin,type ReserveRequirements,type ReserveRegistry,type ReserveCandidate,reserveCompatibility } from '../providers/reserve-policy';
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

export type ReserveSwitch=ReserveCandidate&{anterior:string};
export async function findProjectReserve(prisma:PrismaService,registry:ReserveRegistry,projectId:string,from:string,requirements:ReserveRequirements,opts:{resourceFailure:boolean;includeCurrent?:boolean;onSkip?:(id:string,reason:string)=>void}):Promise<ReserveSwitch|null>{
  if(opts.resourceFailure)marcarSemCredito(from);
  if(reservePin(requirements))return null;
  const p=await prisma.project.findUnique({where:{id:projectId},select:{provider:true,aiReserva:true,aiModels:true}});
  if(!p||(!opts.includeCurrent&&p.provider!==from))return null;
  const choice=await chooseReserve({project:p,registry,from,requirements,knownIds:aiConnectionIds(),cooling:estaSemCredito,includeCurrent:opts.includeCurrent,onSkip:opts.onSkip});
  if(!choice)return null;
  const anterior=await registry.status(from,60000).then(s=>s.label).catch(()=>from);
  return {...choice,anterior};
}

/** Planner preference changes only if the expected connection is still
 * current. Step-level fallback never mutates project preference or siblings. */
export async function trocarParaReserva(prisma:PrismaService,registry:ReserveRegistry,projectId:string,from:string,requirements:ReserveRequirements={},opts:{resourceFailure:boolean;onSkip?:(id:string,reason:string)=>void}={resourceFailure:true}):Promise<ReserveSwitch|null>{
  const choice=await findProjectReserve(prisma,registry,projectId,from,requirements,opts);
  if(!choice)return null;
  const updated=await prisma.project.updateMany({where:{id:projectId,provider:from},data:{provider:choice.id}});
  return updated.count?choice:null;
}

export async function trocarEtapaParaReserva(prisma:PrismaService,registry:ReserveRegistry,projectId:string,jobId:string,stepId:string,from:string,requirements:ReserveRequirements,opts:{resourceFailure:boolean;taskId:string;workerId:string;claims:number;signal:AbortSignal;onSkip?:(id:string,reason:string)=>void}):Promise<ReserveSwitch|null>{
  if(opts.signal.aborted)return null;
  const choice=await findProjectReserve(prisma,registry,projectId,from,requirements,{...opts,includeCurrent:true});
  if(!choice||opts.signal.aborted)return null;
  return prisma.$transaction(async tx=>{
    await OrchestratorService.lockJob(tx,jobId);
    const active=await tx.queueTask.findFirst({where:{id:opts.taskId,jobId,stepId,lockedBy:opts.workerId,claims:opts.claims,status:'RUNNING',lockedUntil:{gt:new Date()}},select:{id:true}});
    if(!active||opts.signal.aborted)return null;
    const job=await tx.job.findUnique({where:{id:jobId},select:{projectId:true,defaultProvider:true,status:true,approvedScope:true}});
    const step=await tx.step.findUnique({where:{id:stepId}});
    if(!job||job.projectId!==projectId||!['EXECUTANDO','AGUARDANDO_RECURSO'].includes(job.status)||!step||step.jobId!==jobId||!['PENDENTE','EXECUTANDO','AGUARDANDO_RECURSO'].includes(step.status)||(step.provider??job.defaultProvider)!==from)return null;
    if(JSON.stringify(step.providerOptions??{})!==JSON.stringify(requirements.options??{}))return null;
    if(reservePin({...requirements,pinnedReview:!!(job.approvedScope as {egmResolution?:unknown}|null)?.egmResolution}))return null;
    const p=await tx.project.findUnique({where:{id:projectId},select:{provider:true,aiReserva:true,aiModels:true}});
    if(!p||!(p.provider===choice.id||Array.isArray(p.aiReserva)&&p.aiReserva.includes(choice.id))||reserveCompatibility(choice.id,p,choice.status,requirements)!==null)return null;
    const updated=await tx.step.updateMany({where:{id:stepId,provider:step.provider,status:step.status},data:{provider:choice.id,status:'PENDENTE',statusDetail:'continua com '+choice.nome}});
    return updated.count?choice:null;
  });
}
