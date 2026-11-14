import { Injectable, Logger } from '@nestjs/common';
import * as os from 'node:os';
import { appConfig } from '../config';
import { CompletionService } from '../jobs/completion.service';
import { LogService } from '../jobs/log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { StepExecutorService } from './step-executor.service';
import { PlannerService } from './planner.service';

/**
 * Loop do worker: reivindica tarefas da fila persistente, mantém heartbeat do lease e
 * publica o status dos conectores vistos neste host. Independente do navegador e da API.
 */
@Injectable()
export class WorkerRunnerService {
  private readonly logger = new Logger('Worker');
  private running = false;
  private loopPromise: Promise<void> | null = null;
  readonly workerId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly executor: StepExecutorService,
    private readonly completion: CompletionService,
    private readonly registry: ProviderRegistry,
    private readonly logs: LogService,
    private readonly planner: PlannerService,
  ) {
    this.workerId = appConfig().workerId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async publishHeartbeat(withProviders: boolean): Promise<void> {
    const providers = withProviders ? Object.fromEntries((await this.registry.statusAll(60_000)).map((s) => [s.id, s])) : undefined;
    await this.prisma.workerHeartbeat.upsert({
      where: { id: this.workerId },
      create: { id: this.workerId, hostname: os.hostname(), pid: process.pid, providers: (providers ?? {}) as object },
      update: { lastSeenAt: new Date(), pid: process.pid, ...(providers ? { providers: providers as object } : {}) },
    });
  }

  private async loop(): Promise<void> {
    const { leaseMs, pollMs } = appConfig();
    let lastProviderPublish = 0;
    this.logger.log(`Worker ${this.workerId} iniciado`);
    while (this.running) {
      try {
        const withProviders = Date.now() - lastProviderPublish > 60_000;
        await this.publishHeartbeat(withProviders);
        if (withProviders) lastProviderPublish = Date.now();
        const task = await this.queue.claim(this.workerId, leaseMs);
        if (!task) {
          await sleep(pollMs);
          continue;
        }
        await this.process(task, leaseMs);
      } catch (e: any) {
        this.logger.error(`Erro no loop: ${e?.stack ?? e}`);
        await sleep(pollMs * 2);
      }
    }
    this.logger.log(`Worker ${this.workerId} parado`);
  }

  async process(task: ClaimedTask, leaseMs: number): Promise<void> {
    const ctrl = new AbortController();
    const hbEvery = Math.max(200, Math.floor(leaseMs / 4));
    const hb = setInterval(async () => {
      try {
        const ok = await this.queue.heartbeat(task.id, this.workerId, leaseMs);
        await this.prisma.workerHeartbeat.update({ where: { id: this.workerId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
        if (!ok && !ctrl.signal.aborted) {
          this.logger.warn(`Lease perdido para tarefa ${task.id}; abortando execução`);
          ctrl.abort();
        }
      } catch {
        /* falha transitória de banco: tenta no próximo ciclo */
      }
    }, hbEvery);
    try {
      if (task.recovered && task.jobId) {
        await this.logs.log(task.jobId, `Tarefa ${task.type} recuperada por ${this.workerId} (lease anterior de ${task.previousLockedBy} expirou)`, {
          level: 'WARN',
          source: `worker:${this.workerId}`,
        });
      }
      if (task.type === 'RUN_STEP') {
        await this.executor.run(task, this.workerId, ctrl.signal);
      } else if (task.type === 'EVALUATE_JOB' && task.jobId) {
        await this.completion.evaluate(task.jobId);
        await this.queue.complete(task.id, this.workerId);
      } else if (task.type === 'PLAN_MESSAGE' && task.messageId) {
        await this.planner.handle(task, this.workerId, ctrl.signal);
      } else {
        await this.queue.complete(task.id, this.workerId);
      }
    } catch (e: any) {
      this.logger.error(`Falha processando tarefa ${task.id}: ${e?.stack ?? e}`);
      if (task.jobId) {
        await this.logs.log(task.jobId, `Erro interno do worker: ${e?.message ?? e}`, { level: 'ERROR', source: `worker:${this.workerId}` }).catch(() => undefined);
      }
      await this.queue.requeue(task.id, this.workerId, new Date(Date.now() + 10_000), String(e?.message ?? e)).catch(() => undefined);
    } finally {
      clearInterval(hb);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
