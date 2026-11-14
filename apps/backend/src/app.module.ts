import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiTokenGuard } from './common/auth.guard';
import { CoreModule } from './core.module';
import { GlobalJobsController, JobsController } from './jobs/jobs.controller';
import { AssetsController, ResearchController } from './market/market.controller';
import { MarketService } from './market/market.service';
import { AreasService } from './areas/areas.service';
import { AreasController } from './areas/areas.controller';
import { ConversationsController } from './conversations/conversations.controller';
import { MemoryController } from './memory/memory.controller';
import { ProjectsController } from './projects/projects.controller';
import { SystemController } from './system/system.controller';

@Module({
  imports: [CoreModule],
  controllers: [AreasController, ConversationsController, ProjectsController, AssetsController, ResearchController, MemoryController, JobsController, GlobalJobsController, SystemController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly market: MarketService,
    private readonly areas: AreasService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.market.ensureAssets();
    await this.areas.ensureDefaultAreas();
  }
}
