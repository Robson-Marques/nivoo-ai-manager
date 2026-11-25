import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

/** Fence every durable review write with the queue claim, not merely the
 * worker name. Lock message before task (same ordering as cancellation).
 * Never hold database locks during AI calls. */
export function goldfishMessageWriter(prisma:PrismaService,identity:{messageId:string;taskId:string;workerId:string;claims:number},signal:AbortSignal){
  return async(data:Prisma.ConversationMessageUpdateManyMutationInput):Promise<boolean>=>{
    if(signal.aborted)return false;
    return prisma.$transaction(async tx=>{
      const messages=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "ConversationMessage" WHERE id = ${identity.messageId} AND status = 'PENDENTE' FOR UPDATE`;
      if(!messages.length||signal.aborted)return false;
      const tasks=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "QueueTask" WHERE id = ${identity.taskId} AND "messageId" = ${identity.messageId} AND "lockedBy" = ${identity.workerId} AND claims = ${identity.claims} AND status = 'RUNNING' AND "lockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE`;
      if(!tasks.length||signal.aborted)return false;
      const r=await tx.conversationMessage.updateMany({where:{id:identity.messageId,status:'PENDENTE'},data});
      return r.count===1;
    });
  };
}
