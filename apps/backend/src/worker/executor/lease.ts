import type { Prisma } from '@prisma/client';
import type { ClaimedTask } from '../../queue/queue.service';

export class LostStepLease extends Error{
  constructor(){super('Lease da etapa perdido; nenhuma gravação de resultado autorizada.');this.name='LostStepLease';}
}
/** Caller holds the transaction until its state mutation completes.
 * Claim generation is required even when a worker ID is reused. */
export async function assertStepLease(tx:Prisma.TransactionClient,task:Pick<ClaimedTask,'id'|'claims'|'jobId'|'stepId'>,workerId:string):Promise<void>{
  const rows=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM "QueueTask" WHERE id=${task.id} AND "lockedBy"=${workerId}
      AND claims=${task.claims} AND status='RUNNING'
      AND "jobId" IS NOT DISTINCT FROM ${task.jobId}::text AND "stepId" IS NOT DISTINCT FROM ${task.stepId}::text
      AND "lockedUntil" > (clock_timestamp() AT TIME ZONE 'UTC')
    FOR UPDATE
  `;
  if(rows.length!==1)throw new LostStepLease();
}

/** Short database-only mutation. Lock order is job advisory lock, then queue
 * row, matching OrchestratorService; no filesystem/network work in callback. */
export type StepLease={task:ClaimedTask;workerId:string};
export async function withStepLease<T>(prisma:import('../../prisma/prisma.service').PrismaService,lease:StepLease,write:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
  if(!lease.task.jobId||!lease.task.stepId)throw new LostStepLease();
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${lease.task.jobId}))) AS l`;
    await assertStepLease(tx,lease.task,lease.workerId);
    return write(tx);
  });
}

/** Evaluation uses the same claim fence with a null step identity. */
export type EvaluationLease={task:ClaimedTask;workerId:string;signal:AbortSignal};
export async function assertEvaluationLease(tx:Prisma.TransactionClient,lease?:EvaluationLease):Promise<void>{
  if(!lease)return;
  if(lease.signal.aborted||lease.task.type!=='EVALUATE_JOB'||!lease.task.jobId||lease.task.stepId!==null)throw new LostStepLease();
  await assertStepLease(tx,lease.task,lease.workerId);
}
