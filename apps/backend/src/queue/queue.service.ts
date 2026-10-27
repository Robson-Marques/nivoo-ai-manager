import { Injectable } from '@nestjs/common';
import { Prisma, QueueTask, QueueTaskType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Tx = Prisma.TransactionClient;

export interface ClaimedTask extends QueueTask {
  /** Worker que detinha o lease anterior (recuperação após queda). */
  previousLockedBy: string | null;
  recovered: boolean;
}

const MAX_CLAIMS = 20;

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

  async claim(workerId: string, leaseMs: number): Promise<ClaimedTask | null> {
    // Tarefas que excederam o número de reivindicações viram DEAD (evita loop de quedas).
    await this.prisma.$executeRaw`
      UPDATE "QueueTask" SET status = 'DEAD', "lastError" = 'excedeu número máximo de reivindicações', "updatedAt" = now()
      WHERE status = 'RUNNING' AND "lockedUntil" < now() AND claims >= ${MAX_CLAIMS}`;
    const rows = await this.prisma.$queryRaw<Array<QueueTask & { prev_locked_by: string | null; prev_status: string }>>`
      WITH c AS (
        SELECT id, "lockedBy" AS prev_locked_by, status::text AS prev_status
        FROM "QueueTask"
        WHERE (status = 'QUEUED' AND "runAt" <= now())
           OR (status = 'RUNNING' AND "lockedUntil" < now())
        ORDER BY "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "QueueTask" t
      SET status = 'RUNNING', "lockedBy" = ${workerId},
          "lockedUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
          claims = t.claims + 1, "updatedAt" = now()
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

  async requeue(taskId: string, workerId: string, runAt: Date, lastError?: string): Promise<void> {
    await this.prisma.queueTask.updateMany({
      where: { id: taskId, lockedBy: workerId, status: 'RUNNING' },
      data: { status: 'QUEUED', runAt, lockedBy: null, lockedUntil: null, lastError },
    });
  }

  async cancelForJob(tx: Tx | PrismaService, jobId: string): Promise<number> {
    const r = await tx.queueTask.updateMany({
      where: { jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', lockedUntil: null },
    });
    return r.count;
  }
}
