import { Injectable } from '@nestjs/common';
import { LogLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LogOpts {
  stepId?: string | null;
  attemptId?: string | null;
  level?: LogLevel;
  source?: string;
}

@Injectable()
export class LogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(jobId: string, message: string, opts: LogOpts = {}): Promise<void> {
    await this.prisma.logEntry.create({
      data: {
        jobId,
        message: message.slice(0, 20000),
        stepId: opts.stepId ?? null,
        attemptId: opts.attemptId ?? null,
        level: opts.level ?? 'INFO',
        source: opts.source ?? 'system',
      },
    });
  }

  async since(jobId: string, afterId: bigint, limit = 500) {
    const rows = await this.prisma.logEntry.findMany({
      where: { jobId, id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}
