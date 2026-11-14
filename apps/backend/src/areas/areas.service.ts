import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Area } from '@prisma/client';
import * as path from 'node:path';
import { sha256 } from '../common/hash';
import { optString, reqString, slugify } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';
import { AREA_TEMPLATES, findTemplate } from './area-templates';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class AreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly artifacts: ArtifactStoreService,
  ) {}

  templates() {
    return AREA_TEMPLATES.map((t) => ({ key: t.key, name: t.name, kind: t.kind, description: t.description, instructions: t.instructions, baseFiles: Object.keys(t.baseFiles) }));
  }

  /** Garante a área Mercado (modelo pronto) com instruções e base de conhecimento. Idempotente. */
  async ensureDefaultAreas(): Promise<void> {
    const t = findTemplate('mercado')!;
    let area = await this.prisma.area.findUnique({ where: { slug: 'mercado' } });
    if (!area) {
      area = await this.prisma.area.create({ data: { slug: 'mercado', name: t.name, description: t.description, kind: 'MERCADO', template: 'mercado' } });
    }
    const v = await this.prisma.areaInstruction.count({ where: { areaId: area.id } });
    if (v === 0) {
      await this.prisma.areaInstruction.create({ data: { areaId: area.id, version: 1, text: t.instructions, sha256: sha256(t.instructions), author: 'sistema:modelo-mercado' } });
      await this.prisma.area.update({ where: { id: area.id }, data: { instructionsVersion: 1 } });
    }
    await this.workspace.ensureAreaBase('mercado', t.baseFiles);
  }

  list() {
    return this.prisma.area.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { projects: true } } } });
  }

  async resolve(slugOrId: string): Promise<Area> {
    const a = await this.prisma.area.findFirst({ where: { OR: [{ slug: slugOrId }, { id: slugOrId }] } });
    if (!a) throw new NotFoundException('Área não encontrada');
    return a;
  }

  async get(slugOrId: string) {
    const area = await this.resolve(slugOrId);
    const [instructions, projects] = await Promise.all([
      this.prisma.areaInstruction.findMany({ where: { areaId: area.id }, orderBy: { version: 'asc' } }),
      this.prisma.project.findMany({ where: { areaId: area.id }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { jobs: true, conversations: true } } } }),
    ]);
    return {
      ...area,
      instructions,
      currentInstruction: instructions[instructions.length - 1] ?? null,
      projects,
      basePath: this.workspace.areaDirs(area.slug).base,
      baseFiles: this.workspace.listAreaFiles(area.slug),
      baseHistory: await this.workspace.areaHistory(area.slug, 15),
    };
  }

  async create(body: any) {
    const name = reqString(body, 'name', 120);
    const template = findTemplate(optString(body, 'template', 40) ?? 'generica');
    if (!template) throw new BadRequestException(`Modelo desconhecido. Opções: ${AREA_TEMPLATES.map((t) => t.key).join(', ')}`);
    if (template.kind === 'MERCADO' && (await this.prisma.area.findFirst({ where: { kind: 'MERCADO' } }))) {
      throw new ConflictException('Já existe uma área de Mercado; crie projetos dentro dela');
    }
    const slug = slugify(optString(body, 'slug', 60) ?? name);
    if (!slug) throw new BadRequestException('Nome inválido');
    if (await this.prisma.area.findUnique({ where: { slug } })) throw new ConflictException(`Já existe a área ${slug}`);
    const extra = optString(body, 'instructions', 50000);
    const text = extra ? `${template.instructions}\n\n${extra}` : template.instructions;
    const author = optString(body, 'author', 100) ?? 'operador';
    await this.workspace.ensureAreaBase(slug, template.baseFiles);
    const area = await this.prisma.area.create({
      data: {
        slug,
        name,
        description: optString(body, 'description', 2000) ?? template.description,
        kind: template.kind,
        template: template.key,
        instructionsVersion: 1,
        instructions: { create: { version: 1, text, sha256: sha256(text), author, reason: `criada a partir do modelo ${template.key}` } },
      },
    });
    return this.get(area.id);
  }

  /** Nova versão das instruções permanentes (a anterior fica no histórico). */
  async newInstructions(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const text = reqString(body, 'text', 50000);
    const reason = reqString(body, 'reason', 2000);
    const version = area.instructionsVersion + 1;
    await this.prisma.$transaction([
      this.prisma.areaInstruction.create({ data: { areaId: area.id, version, text, sha256: sha256(text), author: optString(body, 'author', 100) ?? 'operador', reason } }),
      this.prisma.area.update({ where: { id: area.id }, data: { instructionsVersion: version } }),
    ]);
    return this.get(area.id);
  }

  async currentInstruction(areaId: string) {
    return this.prisma.areaInstruction.findFirst({ where: { areaId }, orderBy: { version: 'desc' } });
  }

  // ---------- Base de conhecimento ----------
  private checkPath(rel: string): string {
    const p = String(rel ?? '').trim().replace(/^\/+/, '');
    if (!p || p.includes('..') || p.split('/').some((x) => x === '.git' || x === '')) throw new BadRequestException('Caminho inválido');
    if (p.length > 300) throw new BadRequestException('Caminho muito longo');
    return p;
  }

  async readFile(slugOrId: string, rel: string) {
    const area = await this.resolve(slugOrId);
    const content = this.workspace.readAreaFile(area.slug, this.checkPath(rel));
    if (!content) throw new NotFoundException('Arquivo não encontrado na base da área');
    return content;
  }

  async writeFile(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const rel = this.checkPath(body?.path);
    let content: Buffer;
    if (typeof body?.contentBase64 === 'string') content = Buffer.from(body.contentBase64, 'base64');
    else if (typeof body?.content === 'string') content = Buffer.from(body.content, 'utf8');
    else throw new BadRequestException('Informe content (texto) ou contentBase64');
    if (content.length > MAX_FILE_BYTES) throw new BadRequestException('Arquivo maior que 10 MB');
    const commit = await this.workspace.writeAreaFile(area.slug, rel, content, optString(body, 'author', 100) ?? 'operador');
    return { path: rel, bytes: content.length, commit };
  }

  async deleteFile(slugOrId: string, rel: string, author = 'operador') {
    const area = await this.resolve(slugOrId);
    const p = this.checkPath(rel);
    if (!this.workspace.readAreaFile(area.slug, p)) throw new NotFoundException('Arquivo não encontrado na base da área');
    return { path: p, commit: await this.workspace.writeAreaFile(area.slug, p, null, author) };
  }

  /**
   * Importa uma pasta inteira (padrões, guias, identidade visual...) para a base da área, num único commit.
   * Ignora node_modules, .git e arquivos de sistema. Limites: 3000 arquivos, 10 MB por arquivo.
   */
  async importFiles(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const lista = Array.isArray(body?.files) ? body.files : null;
    if (!lista || !lista.length) throw new BadRequestException('Envie files: [{path, contentBase64}]');
    if (lista.length > 3000) throw new BadRequestException('Máximo de 3000 arquivos por envio');
    const prefixo = optString(body, 'prefix', 120);
    const files: Array<{ path: string; content: Buffer }> = [];
    const ignorados: string[] = [];
    for (const f of lista) {
      const bruto = String(f?.path ?? '').replace(/\\/g, '/');
      if (/(^|\/)(node_modules|\.git|__pycache__|\.venv)(\/|$)/.test(bruto) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(bruto)) {
        ignorados.push(bruto);
        continue;
      }
      const rel = this.checkPath(prefixo ? `${prefixo.replace(/\/+$/, '')}/${bruto}` : bruto);
      if (typeof f?.contentBase64 !== 'string') throw new BadRequestException(`Arquivo sem conteúdo: ${rel}`);
      const content = Buffer.from(f.contentBase64, 'base64');
      if (content.length > MAX_FILE_BYTES) {
        ignorados.push(`${rel} (maior que 10 MB)`);
        continue;
      }
      files.push({ path: rel, content });
    }
    if (!files.length) throw new BadRequestException('Nenhum arquivo válido para importar');
    const author = optString(body, 'author', 100) ?? 'operador';
    const commit = await this.workspace.importAreaFiles(area.slug, files, author, optString(body, 'message', 200) ?? `importa ${files.length} arquivo(s)`);
    return { importados: files.length, bytes: files.reduce((n, f) => n + f.content.length, 0), ignorados, commit };
  }

  /** Promove um artefato produzido por um job da área para a base de conhecimento. */
  async fromArtifact(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const art = await this.prisma.artifact.findFirst({ where: { id: reqString(body, 'artifactId', 60) }, include: { project: true } });
    if (!art || art.project.areaId !== area.id) throw new BadRequestException('O artefato não pertence a um projeto desta área');
    const { content } = await this.artifacts.read(art.projectId, art.id);
    const rel = this.checkPath(optString(body, 'path', 300) ?? path.basename(art.name));
    const commit = await this.workspace.writeAreaFile(area.slug, rel, content, optString(body, 'author', 100) ?? 'operador');
    return { path: rel, bytes: content.length, commit, origem: { projectId: art.projectId, artifactId: art.id, sha256: art.sha256 } };
  }
}
