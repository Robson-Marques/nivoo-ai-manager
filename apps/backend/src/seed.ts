import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './core.module';
import { MarketService } from './market/market.service';
import { AreasService } from './areas/areas.service';

/** Cadastra WIN e WDO (idempotente). */
async function main() {
  const app = await NestFactory.createApplicationContext(CoreModule, { logger: ['warn', 'error'] });
  await app.get(MarketService).ensureAssets();
  await app.get(AreasService).ensureDefaultAreas();
  console.log('Ativos WIN e WDO e área Mercado garantidos.');
  await app.close();
}
main();
