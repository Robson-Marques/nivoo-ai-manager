import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './core.module';
import { AreasService } from './areas/areas.service';

/** Garante a base padrão ("Geral"). Idempotente; roda na instalação e em cada atualização. */
async function main() {
  const app = await NestFactory.createApplicationContext(CoreModule, { logger: ['warn', 'error'] });
  await app.get(AreasService).ensureDefaultAreas();
  console.log('Base padrão garantida.');
  await app.close();
}
main();
