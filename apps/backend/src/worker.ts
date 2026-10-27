import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { WorkerRunnerService } from './worker/worker-runner.service';

/** Processo worker independente: executa jobs com o navegador fechado e a API parada. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
  const runner = app.get(WorkerRunnerService);
  runner.start();
  const shutdown = async (sig: string) => {
    console.log(`Worker recebeu ${sig}; finalizando loop (tarefas em andamento serão retomadas por lease)`);
    await runner.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
bootstrap();
