import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { StepExecutorService } from './worker/step-executor.service';
import { WorkerRunnerService } from './worker/worker-runner.service';

@Module({
  imports: [CoreModule],
  providers: [StepExecutorService, WorkerRunnerService],
  exports: [WorkerRunnerService, StepExecutorService],
})
export class WorkerModule {}
