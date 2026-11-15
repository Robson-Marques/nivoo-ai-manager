import { DiagnosticoService } from './diagnostico/diagnostico.service';
import { Module } from '@nestjs/common';
import { AreasService } from './areas/areas.service';
import { ConversationsService } from './conversations/conversations.service';
import { ApprovalsService } from './jobs/approvals.service';
import { CompletionService } from './jobs/completion.service';
import { JobsService } from './jobs/jobs.service';
import { LogService } from './jobs/log.service';
import { OrchestratorService } from './jobs/orchestrator.service';
import { MemoryService } from './memory/memory.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectProfileService } from './projects/project-profile.service';
import { ProjectsService } from './projects/projects.service';
import { GitService } from './git/git.service';
import { ProvidersModule } from './providers/providers.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';

const services = [ConversationsService, AreasService, ApprovalsService, CompletionService, JobsService, LogService, OrchestratorService, MemoryService, ProjectProfileService, ProjectsService, GitService, DiagnosticoService];

/** Serviços compartilhados entre API e worker. */
@Module({
  imports: [PrismaModule, QueueModule, StorageModule, ProvidersModule],
  providers: services,
  exports: [...services, PrismaModule, QueueModule, StorageModule, ProvidersModule],
})
export class CoreModule {}
