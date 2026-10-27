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
  await app.listen(appConfig().port);
  console.log(`API Nivoo em http://localhost:${appConfig().port}/api`);
}
bootstrap();
