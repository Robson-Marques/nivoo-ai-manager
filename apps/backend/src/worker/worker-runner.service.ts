import { registrarErro } from '../diagnostico/erros';
import { Injectable, Logger } from '@nestjs/common';
import * as os from 'node:os';
import { armazenamentoDisponivel } from '../common/disk-guard';
import { appConfig } from '../config';
import { CompletionService } from '../jobs/completion.service';
import { LogService } from '../jobs/log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { QueueTaskType } from '@prisma/client';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { StepExecutorService } from './step-executor.service';
import { PlannerService } from './planner.service';
import { avisarConversaQueParou } from '../conversations/jobs-da-conversa';

/**
 * Loop do worker: reivindica tarefas da fila persistente, mantém heartbeat do lease e
 * publica o status dos conectores vistos neste host. Independente do navegador e da API.
 * Duas faixas em paralelo: trabalhos (etapas e avaliação, um de cada vez — o worktree do job não é
 * compartilhado) e conversa (respostas do chat), para o chat não ficar esperando um trabalho longo.
 */
const FAIXAS: Array<{ nome: string; tipos: QueueTaskType[] }> = [
  { nome: 'trabalho', tipos: ['RUN_STEP', 'EVALUATE_JOB'] },
  { nome: 'conversa', tipos: ['PLAN_MESSAGE'] },
];

@Injectable()
export class WorkerRunnerService {
  private readonly logger = new Logger('Worker');
  private readonly errosSeguidos = new Map<string, { assinatura: string; total: number }>();

  /** Erro interno repetido: a tarefa sai da fila e o trabalho/mensagem mostra o motivo (diagnóstico tem o resto). */
  private async desistirDaTarefa(task: ClaimedTask, motivo: string): Promise<void> {
    const texto = `mesmo erro interno do Nivoo repetido 5 vezes: ${motivo.slice(0, 500)}. Execução interrompida para preservar recursos e o checkpoint; verifique o diagnóstico antes de retomar.`;
    await this.queue.complete(task.id, this.workerId);
    if (task.jobId) {
      await this.prisma.$transaction([
        this.prisma.step.updateMany({ where: { jobId: task.jobId, status: 'EXECUTANDO' }, data: { status: 'BLOQUEADO', statusDetail: texto } }),
        this.prisma.attempt.updateMany({ where: { jobId: task.jobId, status: 'EXECUTANDO' }, data: { status: 'INTERROMPIDA', endedAt: new Date(), error: texto } }),
        this.prisma.job.updateMany({ where: { id: task.jobId, status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO'] } }, data: { status: 'BLOQUEADO', blockedReason: 'FALHA_INTERNA', statusDetail: texto } }),
      ]);
      await this.logs.log(task.jobId, `Trabalho parado: ${texto}`, { level: 'ERROR', source: `worker:${this.workerId}` }).catch(() => undefined);
      await avisarConversaQueParou(this.prisma, task.jobId, texto);
    }
    if (task.messageId) {
      await this.prisma.conversationMessage.updateMany({ where: { id: task.messageId, status: 'PENDENTE' }, data: { status: 'ERRO', kind: 'erro', content: `A IA não conseguiu responder: ${texto}` } });
    }
  }
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
    this.loopPromise = Promise.all(FAIXAS.map((f, i) => this.loop(f.tipos, i === 0))).then(() => undefined);
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

  private async loop(tipos: QueueTaskType[], publicaSinal: boolean): Promise<void> {
    const { leaseMs, pollMs } = appConfig();
    let lastProviderPublish = 0;
    if (publicaSinal) this.logger.log(`Worker ${this.workerId} iniciado`);
    while (this.running) {
      try {
        // Verificar armazenamento ANTES de claim, log de banco e resposta da IA.
        const config = appConfig();
        const disco = armazenamentoDisponivel(['/', config.workspacesRoot, config.artifactsRoot]);
        if (!disco.ok) {
          if (publicaSinal) this.logger.error(`DISCO QUASE CHEIO: somente ${Math.round((disco.livre ?? 0) / (1024 * 1024))} MiB livres em ${disco.pasta}. Worker suspenso; libere espaço antes de continuar. Nada será removido automaticamente.`);
          await sleep(30_000);
          continue;
        }
        if (publicaSinal) {
          const withProviders = Date.now() - lastProviderPublish > 60_000;
          await this.publishHeartbeat(withProviders);
          if (withProviders) lastProviderPublish = Date.now();
        }
        const task = await this.queue.claim(this.workerId, leaseMs, tipos);
        if (!task) {
          await sleep(pollMs);
          continue;
        }
        await this.process(task, leaseMs);
      } catch (e: any) {
        if (/ENOSPC|no space left on device/i.test(String(e?.message ?? e))) {
          this.running = false;
          this.logger.error('DISCO CHEIO (ENOSPC): parando o worker; não tentar persistir logs nem repetir tarefas com disco lotado.');
          break;
        }
        this.logger.error(`Erro no loop: ${e?.stack ?? e}`);
        registrarErro('worker', `erro no loop do worker: ${e?.message ?? e}`, e);
        await sleep(pollMs * 2);
      }
    }
    if (publicaSinal) this.logger.log(`Worker ${this.workerId} parado`);
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
      this.errosSeguidos.delete(task.id);
    } catch (e: any) {
      if (/ENOSPC|no space left on device/i.test(String(e?.message ?? e))) {
        this.running = false;
        ctrl.abort();
        // Não há espaço sequer para gravar logs/artefatos. Não refile a
        // tarefa: ela será recuperada pelo lease quando o operador liberar espaço.
        this.logger.error(`DISCO CHEIO (ENOSPC) na tarefa ${task.id}. Worker parado, sem novas tentativas automáticas. Preserve os dados e libere armazenamento.`);
        return;
      }
      this.logger.error(`Falha processando tarefa ${task.id}: ${e?.stack ?? e}`);
      registrarErro('worker', `falha na tarefa ${task.type} ${task.id}${task.jobId ? ` (trabalho ${task.jobId})` : ''}: ${e?.message ?? e}`, e);
      if (task.jobId) {
        await this.logs.log(task.jobId, `Erro interno do worker: ${e?.message ?? e}`, { level: 'ERROR', source: `worker:${this.workerId}` }).catch(() => undefined);
      }
      // O mesmo erro interno várias vezes seguidas: parar e mostrar o motivo, em vez de repetir a cada 10 s para
      // sempre com o trabalho "executando" na tela.
      const assinatura = `${e?.code ?? ''}:${String(e?.message ?? e)}`
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
        .replace(/\b\d{2}:\d{2}:\d{2}\b/g, '<hora>')
        .replace(/\s+/g, ' ').trim().slice(0, 600);
      const anterior = this.errosSeguidos.get(task.id);
      const n = anterior?.assinatura === assinatura ? anterior.total + 1 : 1;
      this.errosSeguidos.set(task.id, { assinatura, total: n });
      if (n >= 5) {
        this.errosSeguidos.delete(task.id);
        await this.desistirDaTarefa(task, String(e?.message ?? e)).catch(() => undefined);
      } else {
        await this.queue.requeue(task.id, this.workerId, new Date(Date.now() + 10_000 * n), String(e?.message ?? e)).catch(() => undefined);
      }
    } finally {
      clearInterval(hb);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
