import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import { sha256File } from '../common/hash';
import { resolveInside } from '../common/path-guard';
import { BlockedReason } from '../common/status';
import { WorkspaceService } from '../storage/workspace.service';
import { reqString, optString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { LogService } from './log.service';
import { OrchestratorService } from './orchestrator.service';

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
    const reason = optString(body, 'reason', 2000) ?? null;
    const a = await this.prisma.approval.findUnique({ where: { id: approvalId } });
    if (!a) throw new NotFoundException('Aprovação não encontrada');
    if (a.status !== 'PENDENTE') throw new ConflictException(`Aprovação já decidida (${a.status})`);
    if (body?.projectId && body.projectId !== a.projectId) throw new NotFoundException('Aprovação não pertence ao projeto');
    if (a.kind === 'LIBERAR_DATASET_RESERVADO' && decision === 'APROVADO' && a.subjectHash) {
      // Confere o ARQUIVO real (não só o hash registrado): a liberação vale só para o conteúdo solicitado.
      const ds = await this.prisma.dataset.findUnique({ where: { id: a.subjectId }, include: { project: true } });
      let atual = 'sem-hash';
      if (ds) {
        const abs = resolveInside(this.workspace.projectDirs(ds.project.slug).data, ds.uri);
        if (fs.existsSync(abs)) atual = await sha256File(abs);
      }
      if (!ds || `${ds.uri}:${atual}` !== a.subjectHash || (ds.sha256 && ds.sha256 !== atual)) {
        throw new ConflictException('O conjunto de dados mudou desde a solicitação; peça uma nova liberação');
      }
    }
    await this.prisma.approval.update({ where: { id: a.id }, data: { status: decision, decidedBy, reason, decidedAt: new Date() } });

    if (a.kind === 'LIBERAR_DATASET_RESERVADO') {
      if (decision === 'APROVADO') await this.prisma.dataset.update({ where: { id: a.subjectId }, data: { released: true } });
      return this.prisma.approval.findUnique({ where: { id: a.id } });
    }
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
