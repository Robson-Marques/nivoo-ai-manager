import { DiagnosticoController } from './diagnostico/diagnostico.controller';
import { SshController } from './ssh/ssh.controller';
import { McpController } from './mcp/mcp.controller';
import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiTokenGuard } from './common/auth.guard';
import { CoreModule } from './core.module';
import { GlobalJobsController, JobsController } from './jobs/jobs.controller';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { LoginSessionsService } from './accounts/login-sessions.service';
import { AreasService } from './areas/areas.service';
import { AreasController } from './areas/areas.controller';
import { GitController } from './git/git.controller';
import { ConversationsController } from './conversations/conversations.controller';
import { MemoryController } from './memory/memory.controller';
import { ProjectsController } from './projects/projects.controller';
import { SystemController } from './system/system.controller';

@Module({
  imports: [CoreModule],
  controllers: [AccountsController, AreasController, GitController, ConversationsController, ProjectsController, MemoryController, JobsController, GlobalJobsController, SystemController, McpController, SshController, DiagnosticoController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }, AccountsService, LoginSessionsService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly areas: AreasService) {}

  async onModuleInit(): Promise<void> {
    await this.areas.ensureDefaultAreas();
  }
}
