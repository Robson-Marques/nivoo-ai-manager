import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiTokenGuard } from './common/auth.guard';
import { CoreModule } from './core.module';
import { GlobalJobsController, JobsController } from './jobs/jobs.controller';
import { AssetsController, ResearchController } from './market/market.controller';
import { MarketService } from './market/market.service';
import { MemoryController } from './memory/memory.controller';
import { ProjectsController } from './projects/projects.controller';
import { SystemController } from './system/system.controller';

@Module({
  imports: [CoreModule],
  controllers: [ProjectsController, AssetsController, ResearchController, MemoryController, JobsController, GlobalJobsController, SystemController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly market: MarketService) {}

  async onModuleInit(): Promise<void> {
    await this.market.ensureAssets();
  }
}
