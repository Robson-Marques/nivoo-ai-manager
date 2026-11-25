import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configureHttp } from './app-setup';
import { AppModule } from './app.module';
import { appConfig } from './config';


async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'], bodyParser: false });
  configureHttp(app);
  app.enableShutdownHooks();
  // Serve o frontend compilado (apps/web/dist), se existir.
  const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    const express = app.getHttpAdapter().getInstance();
    const serveStatic = require('express').static;
    express.use(serveStatic(webDist,{setHeaders:(res:any,file:string)=>{
      if(path.extname(file)==='.html')res.setHeader('Cache-Control','no-cache, must-revalidate');
    }}));
    express.get(/^\/(?!api\/).*/, (_req: any, res: any) => {
      res.setHeader('Cache-Control','no-cache, must-revalidate');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    app.enableCors();
  }
  // HOST=127.0.0.1 (padrão do instalador) expõe só localmente; acesso remoto via túnel SSH.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(appConfig().port, host);
  console.log(`API Nivoo em http://${host}:${appConfig().port}/api`);
}
bootstrap();
