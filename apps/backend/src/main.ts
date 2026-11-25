import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configureHttp } from './app-setup';
import { AppModule } from './app.module';
import { appConfig } from './config';
import { PreviaService } from './previa/previa.service';
import { modoCaminho } from './previa/previa-path';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'], bodyParser: false });
  if(modoCaminho()){
    const previa=app.get(PreviaService);
    const express=app.getHttpAdapter().getInstance();
    express.use((req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
      if(req.url==='/previa'||req.url?.startsWith('/previa/')){void previa.atenderCaminho(req,res);return;}
      next();
    });
    app.getHttpServer().on('upgrade',(req:IncomingMessage,socket:Socket,head:Buffer)=>{
      if(req.url?.startsWith('/previa/'))previa.atenderUpgradeCaminho(req,socket,head);
      else socket.destroy();
    });
  }
  configureHttp(app);
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
