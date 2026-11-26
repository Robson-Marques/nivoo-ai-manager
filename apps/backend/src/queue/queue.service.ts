import { Injectable } from '@nestjs/common';
import { Prisma, QueueTask, QueueTaskType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Tx = Prisma.TransactionClient;

export interface ClaimedTask extends QueueTask {
  /** Worker que detinha o lease anterior (recuperação após queda). */
  previousLockedBy: string | null;
  recovered: boolean;
}

/** Quantas vezes uma tarefa pode ser recuperada de um worker que caiu antes de ser considerada problemática. */
const MAX_RECOVERIES = 5;

/**
 * "Agora" em UTC, no mesmo formato das colunas `DateTime` do Prisma (`timestamp without time zone`, gravadas
 * em UTC). NUNCA usar `now()` contra essas colunas: `now()` vira hora LOCAL da sessão do PostgreSQL
 * (ex.: America/Sao_Paulo, -3 h) e a fila deixava tarefas novas paradas por 3 horas.
 */
const AGORA_UTC = Prisma.raw(`(clock_timestamp() AT TIME ZONE 'UTC')`);

/**
 * Fila persistente em PostgreSQL. Reivindicação com FOR UPDATE SKIP LOCKED e lease renovável.
 * Tarefas cujo lease expirou (worker morto) são reivindicadas novamente.
 */
@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    tx: Tx | PrismaService,
    type: QueueTaskType,
    jobId: string,
    stepId: string | null,
    runAt: Date = new Date(),
  ): Promise<QueueTask | null> {
    const existing = await tx.queueTask.findFirst({
      where: { type, jobId, stepId, status: { in: ['QUEUED', 'RUNNING'] } },
    });
    if (existing) return null;
    return tx.queueTask.create({ data: { type, jobId, stepId, runAt } });
  }

  /**
   * Reivindica a próxima tarefa pronta. `types` restringe a uma "faixa" (ex.: respostas do chat não esperam
   * atrás de um trabalho longo).
   */
  async claim(workerId: string, leaseMs: number, types: QueueTaskType[] = ['RUN_STEP', 'EVALUATE_JOB', 'PLAN_MESSAGE']): Promise<ClaimedTask | null> {
    // Loop de quedas: a tarefa derrubou o worker MAX_RECOVERIES vezes. Vira DEAD e o job é BLOQUEADO
    // com motivo explícito (nunca fica parado em EXECUTANDO sem ninguém processar).
    const dead = await this.prisma.$queryRaw<Array<{ jobId: string | null; stepId: string | null; messageId: string | null }>>`
      UPDATE "QueueTask" SET status = 'DEAD', "lastError" = 'worker caiu repetidamente processando esta tarefa', "updatedAt" = ${AGORA_UTC}
      WHERE status = 'RUNNING' AND "lockedUntil" < ${AGORA_UTC} AND recoveries >= ${MAX_RECOVERIES}
      RETURNING "jobId", "stepId", "messageId"`;
    for (const d of dead) {
      if (d.jobId) await this.blockForInfrastructure(d.jobId, d.stepId);
      else if (d.messageId) {
        await this.prisma.conversationMessage.updateMany({
          where: { id: d.messageId, status: 'PENDENTE' },
          data: { status: 'ERRO', kind: 'erro', content: 'O worker caiu repetidamente ao processar esta mensagem. Veja os logs do worker e envie de novo.' },
        });
      }
    }
    const rows = await this.prisma.$queryRaw<Array<QueueTask & { prev_locked_by: string | null; prev_status: string }>>`
      WITH c AS (
        SELECT id, "lockedBy" AS prev_locked_by, status::text AS prev_status
        FROM "QueueTask"
        WHERE ((status = 'QUEUED' AND "runAt" <= ${AGORA_UTC})
           OR (status = 'RUNNING' AND "lockedUntil" < ${AGORA_UTC}))
          AND type::text = ANY(${types}::text[])
        ORDER BY "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "QueueTask" t
      SET status = 'RUNNING', "lockedBy" = ${workerId},
          "lockedUntil" = ${AGORA_UTC} + (${leaseMs}::int * interval '1 millisecond'),
          claims = t.claims + 1,
          recoveries = t.recoveries + CASE WHEN c.prev_status = 'RUNNING' THEN 1 ELSE 0 END,
          "updatedAt" = ${AGORA_UTC}
      FROM c WHERE t.id = c.id
      RETURNING t.*, c.prev_locked_by, c.prev_status`;
    if (rows.length === 0) return null;
    const { prev_locked_by, prev_status, ...task } = rows[0];
    return { ...(task as QueueTask), previousLockedBy: prev_locked_by, recovered: prev_status === 'RUNNING' };
  }

  /** A generation is required even when the same worker ID is reused after restart. */
  async heartbeat(taskId: string, workerId: string, claims: number, leaseMs: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "QueueTask" SET "lockedUntil" = ${AGORA_UTC} + (${leaseMs}::int * interval '1 millisecond'), "updatedAt" = ${AGORA_UTC}
      WHERE id = ${taskId} AND "lockedBy" = ${workerId} AND claims = ${claims}
        AND status = 'RUNNING' AND "lockedUntil" > ${AGORA_UTC}`;
    return n === 1;
  }

  async complete(taskId: string, workerId: string, claims: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "QueueTask" SET status = 'DONE', "lockedUntil" = NULL,
        "internalErrorSignature" = NULL, "internalErrorCount" = 0, "updatedAt" = ${AGORA_UTC}
      WHERE id = ${taskId} AND "lockedBy" = ${workerId} AND claims = ${claims}
        AND status = 'RUNNING' AND "lockedUntil" > ${AGORA_UTC}`;
    return n === 1;
  }

  async requeue(taskId: string, workerId: string, claims: number, runAt: Date, lastError?: string, resourceWait = false): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "QueueTask" SET status = 'QUEUED', "runAt" = ${runAt}, "lockedBy" = NULL,
        "lockedUntil" = NULL, "lastError" = ${lastError ?? null},
        "resourceWaits" = "resourceWaits" + ${resourceWait ? 1 : 0},
        "internalErrorSignature" = NULL, "internalErrorCount" = 0, "updatedAt" = ${AGORA_UTC}
      WHERE id = ${taskId} AND "lockedBy" = ${workerId} AND claims = ${claims}
        AND status = 'RUNNING' AND "lockedUntil" > ${AGORA_UTC}`;
    return n === 1;
  }

  /** Persist the error series and its retry/terminal transition together.
   * Lock order matches OrchestratorService: job advisory lock before queue row. */
  async recordInternalFailure(task: ClaimedTask, workerId: string, signature: string, reason: string): Promise<'lost'|'retry'|'blocked'> {
    return this.prisma.$transaction(async tx => {
      if (task.jobId) await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${task.jobId}))) AS l`;
      const rows = await tx.$queryRaw<Array<{internalErrorSignature:string|null;internalErrorCount:number}>>`
        SELECT "internalErrorSignature", "internalErrorCount" FROM "QueueTask"
        WHERE id = ${task.id} AND "lockedBy" = ${workerId} AND claims = ${task.claims}
          AND status = 'RUNNING' AND "lockedUntil" > ${AGORA_UTC}
        FOR UPDATE`;
      if (rows.length !== 1) return 'lost';
      const count = rows[0].internalErrorSignature === signature ? rows[0].internalErrorCount + 1 : 1;
      const terminal = count >= 5;
      const detail = terminal
        ? 'Mesmo erro interno do Nivoo repetido 5 vezes: ' + reason.slice(0,500) + '. Execução interrompida; arquivos e checkpoint preservados.'
        : reason.slice(0,2000);
      await tx.queueTask.update({where:{id:task.id},data:{
        status:terminal?'DEAD':'QUEUED', lockedBy:null, lockedUntil:null,
        internalErrorSignature:signature, internalErrorCount:count, lastError:detail,
        ...(terminal?{}:{runAt:new Date(Date.now()+10_000*count)})
      }});
      if (!terminal) return 'retry';
      if(task.jobId){
        const job=await tx.job.updateMany({where:{id:task.jobId,status:{in:['PENDENTE','EXECUTANDO','AGUARDANDO_RECURSO']}},data:{status:'BLOQUEADO',blockedReason:'FALHA_INTERNA',statusDetail:detail}});
        if(job.count){
          await tx.step.updateMany({where:{jobId:task.jobId,...(task.stepId?{id:task.stepId}:{}),status:'EXECUTANDO'},data:{status:'BLOQUEADO',statusDetail:detail}});
          await tx.attempt.updateMany({where:{jobId:task.jobId,...(task.stepId?{stepId:task.stepId}:{}),status:'EXECUTANDO'},data:{status:'INTERROMPIDA',endedAt:new Date(),error:detail}});
          await tx.logEntry.create({data:{jobId:task.jobId,stepId:task.stepId,level:'ERROR',source:'fila',message:detail}});
        }
      }
      if(task.messageId)await tx.conversationMessage.updateMany({where:{id:task.messageId,status:'PENDENTE'},data:{status:'ERRO',kind:'erro',content:'A IA não conseguiu responder: '+detail,completedAt:new Date()}});
      return 'blocked';
    });
  }

  private async blockForInfrastructure(jobId: string, stepId: string | null): Promise<void> {
    const detail = `a tarefa derrubou o worker ${MAX_RECOVERIES} vezes; verifique os logs do worker antes de retomar`;
    await this.prisma.$transaction([
      this.prisma.attempt.updateMany({ where: { jobId, ...(stepId ? { stepId } : {}), status: 'EXECUTANDO' }, data: { status: 'INTERROMPIDA', endedAt: new Date(), error: 'worker caiu repetidamente' } }),
      ...(stepId ? [this.prisma.step.updateMany({ where: { id: stepId, status: 'EXECUTANDO' }, data: { status: 'BLOQUEADO', statusDetail: detail } })] : []),
      this.prisma.job.updateMany({
        where: { id: jobId, status: { in: ['EXECUTANDO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'BLOQUEADO', blockedReason: 'FALHA_INFRAESTRUTURA', statusDetail: detail },
      }),
      this.prisma.logEntry.create({ data: { jobId, stepId, level: 'ERROR', source: 'fila', message: `Job BLOQUEADO (FALHA_INFRAESTRUTURA): ${detail}` } }),
    ]);
  }

  async cancelForJob(tx: Tx | PrismaService, jobId: string): Promise<number> {
    const r = await tx.queueTask.updateMany({
      where: { jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', lockedUntil: null },
    });
    return r.count;
  }
}
