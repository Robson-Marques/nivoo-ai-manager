import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { appConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';

const WORKER_STALE_MS = 30_000;

@Controller()
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
  ) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }

  @Get('system/workers')
  async workers() {
    const rows = await this.prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 50 });
    const now = Date.now();
    return rows.map((w) => ({ ...w, online: now - w.lastSeenAt.getTime() < WORKER_STALE_MS }));
  }

  /**
   * Conectores: status visto pelo host da API e por cada worker online.
   * A execução depende do que o WORKER enxerga (logins CLI ficam no host do worker).
   */
  @Get('providers')
  async providers() {
    const apiView = await this.registry.statusAll();
    const configs = await this.prisma.providerConfig.findMany();
    const workers = (await this.workers()).filter((w) => w.online);
    return apiView.map((s) => ({
      ...s,
      config: configs.find((c) => c.id === s.id) ?? { id: s.id, enabled: true, settings: {} },
      workers: workers.map((w) => ({ workerId: w.id, hostname: w.hostname, status: (w.providers as any)?.[s.id] ?? null })),
    }));
  }

  @Post('providers/:id/check')
  async check(@Param('id') id: string) {
    this.registry.invalidate(id);
    return this.registry.status(id, 0);
  }

  /** Configuração não secreta. Segredos (chaves de API) ficam só no .env do host. */
  @Patch('providers/:id')
  async configure(@Param('id') id: string, @Body() body: any) {
    this.registry.get(id);
    const settings = body?.settings ?? {};
    for (const k of Object.keys(settings)) {
      if (/key|token|secret|password|senha|cookie/i.test(k)) {
        throw new BadRequestException('Segredos não podem ser gravados no banco; use o arquivo .env do host');
      }
    }
    const row = await this.prisma.providerConfig.upsert({
      where: { id },
      create: { id, enabled: body?.enabled !== false, settings: settings as Prisma.InputJsonValue },
      update: { ...(body?.enabled !== undefined ? { enabled: !!body.enabled } : {}), settings: settings as Prisma.InputJsonValue },
    });
    this.registry.invalidate(id);
    return row;
  }

  @Get('system/config')
  config() {
    const c = appConfig();
    return {
      workspacesRoot: c.workspacesRoot,
      artifactsRoot: c.artifactsRoot,
      leaseMs: c.leaseMs,
      financialOperations: 'PROIBIDAS nesta versão',
      apiTokenRequired: !!process.env.NIVOO_API_TOKEN,
    };
  }

  /** Painel Mercado: visão consolidada. */
  @Get('dashboard')
  async dashboard() {
    const [assets, projects, jobsByStatus, recentJobs, pendingApprovals, researches, workers, validated, rejected] = await Promise.all([
      this.prisma.marketAsset.findMany({ orderBy: { code: 'asc' }, include: { _count: { select: { datasets: true, researches: true } } } }),
      this.prisma.project.count(),
      this.prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.job.findMany({ orderBy: { updatedAt: 'desc' }, take: 10, include: { project: { select: { id: true, name: true } } } }),
      this.prisma.approval.findMany({ where: { status: 'PENDENTE' }, orderBy: { requestedAt: 'desc' }, take: 20 }),
      this.prisma.research.findMany({ orderBy: { updatedAt: 'desc' }, take: 10, include: { project: { select: { id: true, name: true } }, assets: { include: { asset: { select: { code: true } } } }, _count: { select: { hypotheses: true, experiments: true } } } }),
      this.workers(),
      this.prisma.memoryEntry.count({ where: { category: 'RESULTADO_VALIDADO', supersededById: null } }),
      this.prisma.memoryEntry.count({ where: { category: 'HIPOTESE_REJEITADA', supersededById: null } }),
    ]);
    return {
      assets,
      projects,
      jobsByStatus: Object.fromEntries(jobsByStatus.map((g) => [g.status, g._count._all])),
      recentJobs,
      pendingApprovals,
      researches,
      workersOnline: workers.filter((w) => w.online).length,
      validatedResults: validated,
      rejectedHypotheses: rejected,
    };
  }
}
