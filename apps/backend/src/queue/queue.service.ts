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
      UPDATE "QueueTask" SET status = 'DEAD', "lastError" = 'worker caiu repetidamente processando esta tarefa', "updatedAt" = now()
      WHERE status = 'RUNNING' AND "lockedUntil" < now() AND recoveries >= ${MAX_RECOVERIES}
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
        WHERE ((status = 'QUEUED' AND "runAt" <= now())
           OR (status = 'RUNNING' AND "lockedUntil" < now()))
          AND type::text = ANY(${types}::text[])
        ORDER BY "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "QueueTask" t
      SET status = 'RUNNING', "lockedBy" = ${workerId},
          "lockedUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
          claims = t.claims + 1,
          recoveries = t.recoveries + CASE WHEN c.prev_status = 'RUNNING' THEN 1 ELSE 0 END,
          "updatedAt" = now()
      FROM c WHERE t.id = c.id
      RETURNING t.*, c.prev_locked_by, c.prev_status`;
    if (rows.length === 0) return null;
    const { prev_locked_by, prev_status, ...task } = rows[0];
    return { ...(task as QueueTask), previousLockedBy: prev_locked_by, recovered: prev_status === 'RUNNING' };
  }

  /** Renova o lease. Retorna false se o lease foi perdido (outro worker assumiu ou tarefa cancelada). */
  async heartbeat(taskId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "QueueTask" SET "lockedUntil" = now() + (${leaseMs}::int * interval '1 millisecond'), "updatedAt" = now()
      WHERE id = ${taskId} AND "lockedBy" = ${workerId} AND status = 'RUNNING'`;
    return n === 1;
  }

  async complete(taskId: string, workerId: string): Promise<void> {
    await this.prisma.queueTask.updateMany({
      where: { id: taskId, lockedBy: workerId, status: 'RUNNING' },
      data: { status: 'DONE', lockedUntil: null },
    });
  }

  async requeue(taskId: string, workerId: string, runAt: Date, lastError?: string, resourceWait = false): Promise<void> {
    await this.prisma.queueTask.updateMany({
      where: { id: taskId, lockedBy: workerId, status: 'RUNNING' },
      data: { status: 'QUEUED', runAt, lockedBy: null, lockedUntil: null, lastError, ...(resourceWait ? { resourceWaits: { increment: 1 } } : {}) },
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
