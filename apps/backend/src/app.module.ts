import { DesignStudioController } from './design-studio/design-studio.controller';
import { VideoStudioController } from './video-studio/video-studio.controller';
import { StudioProductionsController } from './video-studio/standalone.controller';
import { StandaloneStudioEditorController } from './video-studio/standalone-editor.controller';
import { VideoStudioService } from './video-studio/video-studio.service';
import { AuthController } from './auth/auth.controller';
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
import { ArquivadosController, ConversationsController } from './conversations/conversations.controller';
import { MemoryController } from './memory/memory.controller';
import { ProjectsController } from './projects/projects.controller';
import { SystemController } from './system/system.controller';
import { PreviaController } from './previa/previa.controller';
import { PreviaService } from './previa/previa.service';

@Module({
  imports: [CoreModule],
  controllers: [DesignStudioController, VideoStudioController, StudioProductionsController, StandaloneStudioEditorController, AuthController, AccountsController, AreasController, GitController, ConversationsController, ArquivadosController, ProjectsController, MemoryController, JobsController, GlobalJobsController, SystemController, McpController, SshController, DiagnosticoController, PreviaController],
  providers: [VideoStudioService, { provide: APP_GUARD, useClass: ApiTokenGuard }, AccountsService, LoginSessionsService, PreviaService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly areas: AreasService) {}

  async onModuleInit(): Promise<void> {
    await this.areas.ensureDefaultAreas();
  }
}
