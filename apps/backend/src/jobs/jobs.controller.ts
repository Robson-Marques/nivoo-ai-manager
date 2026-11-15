import { Body, Controller, Get, Headers, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { ApprovalsService } from './approvals.service';
import { JobsService } from './jobs.service';
import { LogService } from './log.service';
import { WorkspaceService } from '../storage/workspace.service';

@Controller('projects/:pid')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly logs: LogService,
    private readonly artifacts: ArtifactStoreService,
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Get('jobs')
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.jobs.list(pid);
  }

  @Post('jobs')
  create(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.jobs.create(pid, body);
  }

  @Get('jobs/:jid')
  get(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    return this.jobs.get(pid, jid);
  }

  /** Arquivos que o trabalho criou/alterou/apagou na pasta principal (para abrir pela tela). */
  @Get('jobs/:jid/arquivos')
  async arquivos(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    const job = await this.prisma.job.findFirst({ where: { id: jid, projectId: pid }, include: { project: { select: { dirKey: true } } } });
    if (!job) throw new NotFoundException('Trabalho não encontrado');
    return job.mergedCommit ? this.workspace.arquivosDoCommit(job.project.dirKey, job.mergedCommit) : [];
  }

  @Get('jobs/:jid/report')
  report(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    return this.jobs.report(pid, jid);
  }

  @Post('jobs/:jid/start')
  start(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    return this.jobs.start(pid, jid);
  }

  @Post('jobs/:jid/interrupt')
  interrupt(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.interrupt(pid, jid, body?.by);
  }

  @Post('jobs/:jid/resume')
  resume(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.resume(pid, jid, body?.by);
  }

  @Post('jobs/:jid/evaluate')
  evaluate(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    return this.jobs.requestEvaluation(pid, jid);
  }

  @Get('jobs/:jid/revisao')
  revisao(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    return this.jobs.revisao(pid, jid);
  }

  @Post('jobs/:jid/aceitar-revisao')
  aceitarRevisao(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.aceitarRevisao(pid, jid, body?.por);
  }

  @Post('jobs/:jid/responder-revisao')
  responderRevisao(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.responderRevisao(pid, jid, body);
  }

  @Post('jobs/:jid/objective')
  objective(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.newObjectiveVersion(pid, jid, body);
  }

  @Post('jobs/:jid/steps')
  addSteps(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.addSteps(pid, jid, body);
  }

  @Post('jobs/:jid/criteria')
  addCriteria(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.addCriteria(pid, jid, body);
  }

  @Patch('jobs/:jid/limits')
  limits(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Body() body: any) {
    return this.jobs.updateLimits(pid, jid, body);
  }

  @Get('jobs/:jid/logs')
  async jobLogs(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string, @Query('after') after?: string) {
    await this.jobs.get(pid, jid);
    return this.logs.since(jid, BigInt(after ?? '0'));
  }

  /** Tempo real: SSE com logs novos e snapshot de estado. Fechar o navegador não afeta a execução. */
  @Sse('jobs/:jid/events')
  events(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Param('jid', ParseUUIDPipe) jid: string,
    @Query('after') after?: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      // Ao reconectar, o navegador envia Last-Event-ID: continua de onde parou, sem reenviar o histórico.
      const parse = (v?: string) => (v && /^\d+$/.test(v) ? BigInt(v) : 0n);
      let cursor = parse(after) > parse(lastEventId) ? parse(after) : parse(lastEventId);
      let lastState = '';
      let closed = false;
      const tick = async () => {
        if (closed) return;
        try {
          const job = await this.prisma.job.findFirst({
            where: { id: jid, projectId: pid },
            select: { status: true, blockedReason: true, statusDetail: true, costSpentUsd: true, activeSeconds: true, updatedAt: true, steps: { select: { key: true, status: true, attemptCount: true } } },
          });
          if (!job) {
            sub.error(new Error('Job não encontrado neste projeto'));
            return;
          }
          const state = JSON.stringify(job);
          if (state !== lastState) {
            lastState = state;
            sub.next({ type: 'state', data: job });
          }
          const rows = await this.logs.since(jid, cursor, 500);
          if (rows.length) {
            cursor = BigInt(rows[rows.length - 1].id);
            sub.next({ type: 'logs', id: rows[rows.length - 1].id, data: rows });
          }
        } catch (e) {
          /* erro transitório; continua */
        }
        if (!closed) timer = setTimeout(tick, 1000);
      };
      let timer = setTimeout(tick, 0);
      return () => {
        closed = true;
        clearTimeout(timer);
      };
    });
  }

  @Get('artifacts')
  async listArtifacts(@Param('pid', ParseUUIDPipe) pid: string, @Query('jobId') jobId?: string) {
    return this.prisma.artifact.findMany({ where: { projectId: pid, ...(jobId ? { jobId } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Get('artifacts/:aid')
  async download(@Param('pid', ParseUUIDPipe) pid: string, @Param('aid', ParseUUIDPipe) aid: string, @Res() res: Response) {
    const { artifact, content } = await this.artifacts.read(pid, aid);
    res.setHeader('Content-Type', artifact.mimeType);
    res.setHeader('X-Content-SHA256', artifact.sha256);
    // Conteúdo gerado por agentes: nunca executa scripts no contexto da aplicação.
    res.setHeader('Content-Security-Policy', 'sandbox; default-src \'none\'; img-src data:; style-src \'unsafe-inline\'');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(artifact.name.split('/').pop() ?? 'artefato')}"`);
    res.send(content);
  }
}

@Controller()
export class GlobalJobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Get('jobs')
  all(@Query('status') status?: string) {
    return this.jobs.listAll(status);
  }

  @Get('approvals')
  listApprovals(@Query('projectId') projectId?: string, @Query('status') status?: string) {
    return this.approvals.list(projectId, status);
  }

  @Post('approvals/:id/decide')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.approvals.decide(id, body);
  }
}
