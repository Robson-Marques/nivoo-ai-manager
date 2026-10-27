import { Injectable } from '@nestjs/common';
import { ExecStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, Tx } from '../queue/queue.service';

/** Agenda etapas prontas e a avaliação final. Serializado por job via advisory lock. */
@Injectable()
export class OrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  static async lockJob(tx: Tx, jobId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${jobId}))) AS l`;
  }

  async scheduleReady(jobId: string): Promise<{ enqueuedSteps: string[]; evaluate: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const job = await tx.job.findUnique({ where: { id: jobId }, include: { steps: true } });
      if (!job) return { enqueuedSteps: [], evaluate: false };
      const runnable: ExecStatus[] = ['EXECUTANDO', 'AGUARDANDO_RECURSO'];
      if (!runnable.includes(job.status)) return { enqueuedSteps: [], evaluate: false };
      const done = new Set(job.steps.filter((s) => s.status === 'CONCLUIDO').map((s) => s.key));
      if (job.steps.length > 0 && done.size === job.steps.length) {
        const t = await this.queue.enqueue(tx, 'EVALUATE_JOB', jobId, null);
        return { enqueuedSteps: [], evaluate: !!t };
      }
      if (job.steps.length === 0) {
        const t = await this.queue.enqueue(tx, 'EVALUATE_JOB', jobId, null);
        return { enqueuedSteps: [], evaluate: !!t };
      }
      const enqueued: string[] = [];
      for (const s of job.steps.sort((a, b) => a.order - b.order)) {
        if (s.status !== 'PENDENTE') continue;
        if (!s.dependsOn.every((d) => done.has(d))) continue;
        const t = await this.queue.enqueue(tx, 'RUN_STEP', jobId, s.id);
        if (t) enqueued.push(s.key);
      }
      return { enqueuedSteps: enqueued, evaluate: false };
    });
  }
}
