import { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttp } from '../../src/app-setup';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WorkerModule } from '../../src/worker.module';
import { WorkerRunnerService } from '../../src/worker/worker-runner.service';

export const BACKEND_DIR = path.resolve(__dirname, '..', '..');

export interface Harness {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  worker: WorkerRunnerService;
  close: () => Promise<void>;
}

/** API real (Nest + PostgreSQL) em processo; o worker em processo só roda se `startWorker()` for chamado. */
export async function createHarness(): Promise<Harness> {
  const mod = await Test.createTestingModule({ imports: [AppModule, WorkerModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ logger: ['error'], bodyParser: false });
  configureHttp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const worker = app.get(WorkerRunnerService);
  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma,
    worker,
    close: async () => {
      await worker.stop();
      await app.close();
    },
  };
}

export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "QueueTask", "LogEntry", "CriterionCheck", "AcceptanceCriterion", "Attempt", "Checkpoint", "Artifact",
      "Approval", "Step", "JobObjectiveVersion", "Job", "MemoryEntry", "ConversationMessage", "Conversation",
      "ProjectRule", "Project", "AreaInstruction", "Area", "ProviderConfig", "WorkerHeartbeat" CASCADE`);
  // Conexões de IA ficam num arquivo ao lado dos workspaces: cada suíte começa sem nenhuma.
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.rmSync(path.join(path.dirname(process.env.NIVOO_WORKSPACES_ROOT!), 'conexoes.json'), { force: true });
  // A base padrão ("Geral") é recriada como na inicialização da API.
  const { AreasService } = await import('../../src/areas/areas.service');
  const svc = new AreasService(prisma, new (await import('../../src/storage/workspace.service')).WorkspaceService());
  await svc.ensureDefaultAreas();
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30000, everyMs = 200): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`waitFor: tempo esgotado (${timeoutMs} ms)${last ? `; último erro: ${last}` : ''}`);
}

/** Processo real (dist/worker.js ou dist/main.js) com o ambiente de teste. */
export function spawnNode(script: 'worker.js' | 'main.js', env: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, [path.join(BACKEND_DIR, 'dist', script)], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  (child as any).output = () => out;
  return child;
}

export function killHard(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

export async function createProject(h: Harness, name: string) {
  const res = await h.http().post('/api/projects').send({ name, description: `Projeto de teste ${name}` }).expect(201);
  return res.body as { id: string; slug: string; dirKey: string; workspacePath: string };
}
