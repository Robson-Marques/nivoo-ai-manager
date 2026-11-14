import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { MAX_KNOWLEDGE_FILE_BYTES } from '../common/knowledge-upload';
import { extractText } from '../common/text-extract';
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

  /** Converte PDF, Word ou texto em texto puro (ex.: para colar nas regras de um modelo). Nada é gravado. */
  @Post('extract-text')
  async extractText(@Body() body: any) {
    const name = String(body?.name ?? '');
    if (typeof body?.contentBase64 !== 'string' || !name) throw new BadRequestException('Envie name e contentBase64');
    const content = Buffer.from(body.contentBase64, 'base64');
    if (content.length > MAX_KNOWLEDGE_FILE_BYTES) throw new BadRequestException('Arquivo maior que 10 MB');
    return { texto: await extractText(name, content) };
  }

  @Get('system/config')
  config() {
    const c = appConfig();
    return {
      workspacesRoot: c.workspacesRoot,
      artifactsRoot: c.artifactsRoot,
      leaseMs: c.leaseMs,
      apiTokenRequired: !!process.env.NIVOO_API_TOKEN,
    };
  }
}
