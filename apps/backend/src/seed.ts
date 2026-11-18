import 'reflect-metadata';
import * as fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './core.module';
import { AreasService } from './areas/areas.service';
import { convertStoredDocuments } from './common/knowledge-upload';
import { removerGeminiConta } from './accounts/remover-gemini-conta';
import { PrismaService } from './prisma/prisma.service';
import { WorkspaceService } from './storage/workspace.service';
import { limparLicoes } from './worker/limpar-licoes';
import { MODELO_DESLIGADO } from './providers/gemini-video.provider';
import { findTemplate, LINHA_VIDEO_ANTIGA, LINHA_VIDEO_COMPLETO } from './areas/area-templates';

/**
 * Roda na instalação e em cada atualização (idempotente): garante o modelo padrão ("Geral") e converte em
 * texto os documentos (PDF, Office...) guardados antes de "tudo que entra vira texto".
 */
const LINHA_STUDIO_ANTIGA = '- A IA só lê e edita arquivos. Não executa terminal, testes, build, lint, commit,';
const LINHA_STUDIO_NOVA = '- A IA só lê e edita arquivos (ler com comandos de leitura — ls, cat, rg — é\n  permitido: o ChatGPT só lê arquivos assim). Não executa testes, build, lint, commit,';

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
  const removidas = await removerGeminiConta(prisma);
  if (removidas.length) console.log(`Conexão(ões) "Gemini (conta)" removida(s): ${removidas.join(', ')}.`);

  // Studio Workflow já instalado: "não executa terminal" deixava o ChatGPT sem ler nenhum arquivo.
  const studio = await prisma.area.findUnique({ where: { slug: 'studio-workflow' } });
  const regraStudio = studio ? await prisma.areaInstruction.findFirst({ where: { areaId: studio.id }, orderBy: { version: 'desc' } }) : null;
  if (studio && regraStudio?.text.includes(LINHA_STUDIO_ANTIGA)) {
    await app.get(AreasService).newInstructions(studio.id, { text: regraStudio.text.replace(LINHA_STUDIO_ANTIGA, LINHA_STUDIO_NOVA), author: 'sistema', reason: 'Comandos de leitura permitidos (o ChatGPT só lê arquivos assim)' });
    console.log('Modelo "Studio Workflow": regra de leitura por comandos atualizada.');
  }
  // Modelo de vídeo já instalado: a regra antiga ("juntar ainda não é feito") vira a nova, numa versão nova.
  const video = await prisma.area.findUnique({ where: { slug: 'video-veo' } });
  const regra = video ? await prisma.areaInstruction.findFirst({ where: { areaId: video.id }, orderBy: { version: 'desc' } }) : null;
  if (video && regra?.text.includes(LINHA_VIDEO_ANTIGA)) {
    await app.get(AreasService).newInstructions(video.id, { text: regra.text.replace(LINHA_VIDEO_ANTIGA, LINHA_VIDEO_COMPLETO), author: 'sistema', reason: 'O sistema agora junta as cenas no vídeo completo' });
    console.log('Modelo "Vídeo com IA (Omni)": regras de vídeo e locução atualizadas.');
  }
  // Agentes de vídeo já instalados recebem a integração do Kokoro e os nomes atuais do Omni. O slug técnico
  // `video-veo` é preservado para não quebrar projetos existentes.
  for (const slug of ['video-veo', 'design-video']) {
    const area = await prisma.area.findUnique({ where: { slug } });
    const template = findTemplate(slug);
    if (!area || !template) continue;
    const atual = await prisma.areaInstruction.findFirst({ where: { areaId: area.id }, orderBy: { version: 'desc' } });
    if (!atual?.text.includes('Kokoro local')) {
      await app.get(AreasService).newInstructions(area.id, { text: template.instructions, author: 'sistema', reason: 'Omni para vídeo e Kokoro local selecionável para locução' });
    }
    if (area.name !== template.name || area.description !== template.description) {
      await prisma.area.update({ where: { id: area.id }, data: { name: template.name, description: template.description } });
    }
  }
  // Modelo de vídeo escolhido que o Google desligou (Veo na API do Gemini): volta para o automático.
  for (const p of await prisma.project.findMany({ select: { id: true, aiModels: true } })) {
    const m = { ...((p.aiModels ?? {}) as Record<string, string>) };
    if (m['gemini-video'] && MODELO_DESLIGADO.test(m['gemini-video'])) {
      delete m['gemini-video'];
      await prisma.project.update({ where: { id: p.id }, data: { aiModels: m } });
    }
  }
  const apagadas = await limparLicoes(prisma);
  if (apagadas) console.log(`${apagadas} lição(ões) que eram erro de infraestrutura ou repetidas foram removidas.`);
  await app.close();
}
main();
