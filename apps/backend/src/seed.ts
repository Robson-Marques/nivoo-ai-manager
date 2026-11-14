import 'reflect-metadata';
import * as fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './core.module';
import { AreasService } from './areas/areas.service';
import { convertStoredDocuments } from './common/knowledge-upload';
import { PrismaService } from './prisma/prisma.service';
import { WorkspaceService } from './storage/workspace.service';

/**
 * Roda na instalação e em cada atualização (idempotente): garante o modelo padrão ("Geral") e converte em
 * texto os documentos (PDF, Office...) guardados antes de "tudo que entra vira texto".
 */
async function main() {
  const app = await NestFactory.createApplicationContext(CoreModule, { logger: ['warn', 'error'] });
  await app.get(AreasService).ensureDefaultAreas();
  console.log('Base padrão garantida.');
  const prisma = app.get(PrismaService);
  const ws = app.get(WorkspaceService);
  const pastas = [
    ...(await prisma.area.findMany({ select: { slug: true, name: true } })).map((a) => ({ dir: ws.areaDirs(a.slug).base, nome: `modelo ${a.name}` })),
    ...(await prisma.project.findMany({ select: { dirKey: true, name: true } })).map((p) => ({ dir: ws.projectDirs(p.dirKey).knowledge, nome: `projeto ${p.name}` })),
  ];
  let total = 0;
  for (const p of pastas) {
    if (!fs.existsSync(p.dir)) continue;
    const r = await convertStoredDocuments(p.dir, ws);
    total += r.convertidos;
    for (const f of r.falhas) console.warn(`Não converti (${p.nome}): ${f}`);
  }
  if (total) console.log(`${total} documento(s) guardado(s) convertido(s) em texto.`);
  await app.close();
}
main();
