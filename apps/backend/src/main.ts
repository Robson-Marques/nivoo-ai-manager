import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppModule } from './app.module';
import { appConfig } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Serve o frontend compilado (apps/web/dist), se existir.
  const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    const express = app.getHttpAdapter().getInstance();
    const serveStatic = require('express').static;
    express.use(serveStatic(webDist));
    express.get(/^\/(?!api\/).*/, (_req: any, res: any) => res.sendFile(path.join(webDist, 'index.html')));
  } else {
    app.enableCors();
  }
  // HOST=127.0.0.1 (padrão do instalador) expõe só localmente; acesso remoto via túnel SSH.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(appConfig().port, host);
  console.log(`API Nivoo em http://${host}:${appConfig().port}/api`);
}
bootstrap();
