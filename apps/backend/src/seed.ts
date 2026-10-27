import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './core.module';
import { MarketService } from './market/market.service';

/** Cadastra WIN e WDO (idempotente). */
async function main() {
  const app = await NestFactory.createApplicationContext(CoreModule, { logger: ['warn', 'error'] });
  await app.get(MarketService).ensureAssets();
  console.log('Ativos WIN e WDO garantidos.');
  await app.close();
}
main();
