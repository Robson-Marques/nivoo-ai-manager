import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BlockedReason } from '../common/status';
import { reqString, optString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { LogService } from './log.service';
import { OrchestratorService } from './orchestrator.service';
import { WorkspaceService } from '../storage/workspace.service';
import { isVisualApproval, requiredPreviewCount, visualPreviews } from './visual-previews';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly logs: LogService,
    private readonly workspace: WorkspaceService,
  ) {}

  list(projectId?: string, status?: string) {
    return this.prisma.approval.findMany({
      where: { ...(projectId ? { projectId } : {}), ...(status ? { status: status as any } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
  }

  async decide(approvalId: string, body: any) {
    const decision = body?.decision === 'APROVADO' ? 'APROVADO' : body?.decision === 'REJEITADO' ? 'REJEITADO' : null;
    if (!decision) throw new ConflictException('decision deve ser APROVADO ou REJEITADO');
    const decidedBy = reqString(body, 'decidedBy', 100);
    let reason = optString(body, 'reason', 2000) ?? null;
    const a = await this.prisma.approval.findUnique({ where: { id: approvalId } });
    if (!a) throw new NotFoundException('Aprovação não encontrada');
    if (a.status !== 'PENDENTE') throw new ConflictException(`Aprovação já decidida (${a.status})`);
    if (body?.projectId && body.projectId !== a.projectId) throw new NotFoundException('Aprovação não pertence ao projeto');
    if (decision === 'APROVADO' && isVisualApproval(a.description)) {
      const job = await this.prisma.job.findFirst({
        where: { id: a.jobId ?? '', projectId: a.projectId },
        include: { project: { select: { dirKey: true } }, steps: true },
      });
      if (!job) throw new NotFoundException('Trabalho não encontrado');
      const root = await this.workspace.ensureJobWorktree(job.project.dirKey, job.id);
      const previews = visualPreviews(root, job.steps);
      const required = requiredPreviewCount(a.description);
      if (previews.length < required) {
        throw new ConflictException(`Não é possível aprovar: ${previews.length} de ${required} prévias foram produzidas. O Nivoo deve gerar e apresentar todas antes de pedir aprovação.`);
      }
      if (body?.previewsPresented !== true) {
        throw new ConflictException('Abra e confira todas as prévias no painel antes de aprovar.');
      }
      reason = [reason, `NIVOO_PREVIEWS_PRESENTED:${required}`].filter(Boolean).join('; ');
    }
    await this.prisma.approval.update({ where: { id: a.id }, data: { status: decision, decidedBy, reason, decidedAt: new Date() } });

    const jobId = a.jobId!;
    await this.logs.log(jobId, `Aprovação ${a.kind} ${decision} por ${decidedBy}${reason ? `: ${reason}` : ''}`, { source: 'aprovacao' });

    if (a.kind === 'ACAO_DESTRUTIVA') {
      await this.prisma.$transaction(async (tx) => {
        await OrchestratorService.lockJob(tx, jobId);
        if (decision === 'APROVADO') {
          await tx.step.updateMany({ where: { id: a.subjectId, status: 'AGUARDANDO_APROVACAO' }, data: { status: 'PENDENTE', statusDetail: 'ação destrutiva aprovada' } });
          await tx.job.updateMany({ where: { id: jobId, status: 'AGUARDANDO_APROVACAO' }, data: { status: 'EXECUTANDO', statusDetail: null } });
        } else {
          await tx.step.updateMany({ where: { id: a.subjectId }, data: { status: 'BLOQUEADO', statusDetail: 'ação destrutiva rejeitada' } });
          await tx.job.updateMany({
            where: { id: jobId, status: { in: ['AGUARDANDO_APROVACAO', 'EXECUTANDO'] } },
            data: { status: 'BLOQUEADO', blockedReason: BlockedReason.APROVACAO_REJEITADA, statusDetail: 'ação destrutiva rejeitada' },
          });
        }
      });
      if (decision === 'APROVADO') await this.orchestrator.scheduleReady(jobId);
    }

    if (a.kind === 'CRITERIO_SUBJETIVO') {
      // A decisão é registrada; o verificador do backend refaz a avaliação completa.
      const job = await this.prisma.job.findUnique({ where: { id: jobId } });
      if (job?.status === 'AGUARDANDO_APROVACAO') {
        await this.queue.enqueue(this.prisma, 'EVALUATE_JOB', jobId, null);
      }
    }
    return this.prisma.approval.findUnique({ where: { id: a.id } });
  }
}
