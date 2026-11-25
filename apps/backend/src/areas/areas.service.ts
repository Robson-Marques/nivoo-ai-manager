import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Area } from '@prisma/client';
import { sha256 } from '../common/hash';
import { optString, reqString, slugify } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { knowledgePath, parseKnowledgeUpload, toTextFiles } from '../common/knowledge-upload';
import { AREA_TEMPLATES, AREAS_INSTALADAS, DEFAULT_AREA, findTemplate } from './area-templates';

@Injectable()
export class AreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  templates() {
    return AREA_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, instructions: t.instructions, baseFiles: Object.keys(t.baseFiles) }));
  }

  /** Garante a base padrão ("Geral"), onde ficam os projetos sem base escolhida. Idempotente. */
  /**
   * Garante o modelo padrão ("Geral") e os modelos prontos instalados. Um modelo que
   * já existe não é tocado: o usuário pode ter editado as regras e os materiais.
   */
  async ensureDefaultAreas(): Promise<void> {
    for (const key of [DEFAULT_AREA, ...AREAS_INSTALADAS]) {
      const t = findTemplate(key)!;
      if (await this.prisma.area.findUnique({ where: { slug: key } })) {
        await this.workspace.ensureKnowledge(this.workspace.areaDirs(key).base, t.baseFiles); // pasta pode faltar (ex.: base migrada)
        continue;
      }
      await this.create({ name: t.name, template: t.key, slug: t.key, author: 'sistema' }).catch((e) => {
        if (!(e instanceof ConflictException)) throw e; // criada em paralelo (API e worker)
      });
    }
  }

  list() {
    return this.prisma.area.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { projects: true } } } });
  }

  async resolve(slugOrId: string): Promise<Area> {
    const a = await this.prisma.area.findFirst({ where: { OR: [{ slug: slugOrId }, { id: slugOrId }] } });
    if (!a) throw new NotFoundException('Modelo não encontrado');
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
      basePath: this.base(area.slug),
      baseFiles: this.workspace.listKnowledge(this.base(area.slug)),
      baseHistory: await this.workspace.knowledgeHistory(this.base(area.slug), 15),
    };
  }

  async create(body: any) {
    const name = reqString(body, 'name', 120);
    const template = findTemplate(optString(body, 'template', 40) ?? DEFAULT_AREA);
    if (!template) throw new BadRequestException(`Base desconhecida. Opções: ${AREA_TEMPLATES.map((t) => t.key).join(', ')}`);
    const slug = slugify(optString(body, 'slug', 60) ?? name);
    if (!slug) throw new BadRequestException('Nome inválido');
    if (await this.prisma.area.findUnique({ where: { slug } })) throw new ConflictException(`Já existe um modelo com este nome (${slug})`);
    // Texto escrito pelo usuário vale exatamente como está; sem texto, usa o da base pronta.
    const text = optString(body, 'instructions', 50000) ?? template.instructions;
    const author = optString(body, 'author', 100) ?? 'operador';
    await this.workspace.ensureKnowledge(this.workspace.areaDirs(slug).base, template.baseFiles);
    const area = await this.prisma.area.create({
      data: {
        slug,
        name,
        description: optString(body, 'description', 2000) ?? template.description,
        template: template.key,
        instructionsVersion: 1,
        instructions: { create: { version: 1, text, sha256: sha256(text), author, reason: `criada a partir da base pronta ${template.key}` } },
      },
    });
    return this.get(area.id);
  }

  /** Nova versão das instruções permanentes (a anterior fica no histórico). */
  async newInstructions(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const text = reqString(body, 'text', 50000);
    const reason = optString(body, 'reason', 2000) ?? 'editado na tela de modelos';
    const version = area.instructionsVersion + 1;
    await this.prisma.$transaction([
      this.prisma.areaInstruction.create({ data: { areaId: area.id, version, text, sha256: sha256(text), author: optString(body, 'author', 100) ?? 'operador', reason } }),
      this.prisma.area.update({ where: { id: area.id }, data: { instructionsVersion: version } }),
    ]);
    return this.get(area.id);
  }

  /** Nome e descrição do modelo. */
  async update(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const data: Record<string, string> = {};
    const name = optString(body, 'name', 120);
    if (name) data.name = name;
    const description = optString(body, 'description', 2000);
    if (description !== undefined) data.description = description;
    await this.prisma.area.update({ where: { id: area.id }, data });
    return this.get(area.id);
  }

  private base(slug: string): string {
    return this.workspace.areaDirs(slug).base;
  }

  // ---------- Pasta de padrões da base ----------
  async readFile(slugOrId: string, rel: string) {
    const area = await this.resolve(slugOrId);
    const content = this.workspace.readKnowledge(this.base(area.slug), knowledgePath(rel));
    if (!content) throw new NotFoundException('Arquivo não encontrado na base');
    return content;
  }

  async deleteFile(slugOrId: string, rel: string, author = 'operador') {
    const area = await this.resolve(slugOrId);
    const p = knowledgePath(rel);
    if (!this.workspace.readKnowledge(this.base(area.slug), p)) throw new NotFoundException('Arquivo não encontrado na base');
    return { path: p, commit: await this.workspace.writeKnowledge(this.base(area.slug), [{ path: p, content: null }], author, `remove ${p}`) };
  }

  /** Envia arquivos ou uma pasta inteira (padrões, guias, identidade visual...) para a base, num único commit. */
  async importFiles(slugOrId: string, body: any) {
    const area = await this.resolve(slugOrId);
    const parsed = parseKnowledgeUpload(body);
    const { files, convertidos, recusados } = await toTextFiles(parsed.files);
    const ignorados = [...parsed.ignorados, ...recusados];
    const author = optString(body, 'author', 100) ?? 'operador';
    const commit = !files.length ? null : await this.workspace.writeKnowledge(this.base(area.slug), files, author, optString(body, 'message', 200) ?? `importa ${files.length} arquivo(s)`);
    return { importados: files.length, bytes: files.reduce((n, f) => n + f.content.length, 0), ignorados, convertidos, commit };
  }
}
