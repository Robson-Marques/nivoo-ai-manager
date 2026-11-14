import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { findTemplate } from '../areas/area-templates';
import { AreasService } from '../areas/areas.service';
import { optString, reqString, slugify } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly areas: AreasService,
  ) {}

  async create(body: any) {
    const name = reqString(body, 'name', 200);
    const slug = slugify(optString(body, 'slug', 60) ?? name);
    if (!slug) throw new ConflictException('Nome inválido para slug');
    if (await this.prisma.project.findUnique({ where: { slug } })) throw new ConflictException(`Projeto ${slug} já existe`);
    // Todo projeto pertence a uma área (padrão: Mercado). A pasta fica dentro da pasta da área.
    // "tipo" (interface simples): web, imagem, video, generica, mercado — a área do tipo é criada na primeira vez.
    const tipo = optString(body, 'tipo', 40);
    if (tipo) {
      const t = findTemplate(tipo);
      if (!t) throw new BadRequestException(`Tipo desconhecido: ${tipo}`);
      if (!(await this.prisma.area.findUnique({ where: { slug: tipo } }))) {
        if (t.kind === 'MERCADO') await this.areas.ensureDefaultAreas();
        else await this.areas.create({ name: tipo === 'generica' ? 'Geral' : t.name, template: tipo, slug: tipo });
      }
    }
    const areaRef = tipo ?? optString(body, 'areaId', 60) ?? optString(body, 'area', 60) ?? 'mercado';
    const area = await this.prisma.area.findFirst({ where: { OR: [{ id: areaRef }, { slug: areaRef }] } });
    if (!area) throw new NotFoundException('Área não encontrada');
    const dirKey = `areas/${area.slug}/projetos/${slug}`;
    const dirs = await this.workspace.ensureProject(dirKey);
    const description = optString(body, 'description', 20000) ?? '';
    const project = await this.prisma.project.create({ data: { name, slug, description, areaId: area.id, dirKey, workspacePath: dirs.root } });
    if (description) {
      await this.prisma.memoryEntry.create({
        data: { projectId: project.id, category: 'ESPECIFICACAO', title: 'Especificação inicial', content: description, author: optString(body, 'author', 100) ?? 'operador' },
      });
    }
    return project;
  }

  list(area?: string) {
    return this.prisma.project.findMany({
      where: area ? { area: { OR: [{ id: area }, { slug: area }] } } : {},
      orderBy: { createdAt: 'desc' },
      include: { area: { select: { id: true, slug: true, name: true, kind: true } }, _count: { select: { researches: true, jobs: true, datasets: true } } },
    });
  }

  async get(id: string) {
    const p = await this.prisma.project.findUnique({
      where: { id },
      include: {
        area: { select: { id: true, slug: true, name: true, kind: true } },
        researches: { orderBy: { createdAt: 'desc' }, include: { assets: { include: { asset: true } }, _count: { select: { hypotheses: true, experiments: true, jobs: true } } } },
        datasets: { orderBy: { createdAt: 'desc' }, include: { asset: { select: { code: true } } } },
        _count: { select: { jobs: true, memory: true, artifacts: true } },
      },
    });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    const agg = await this.prisma.job.aggregate({ where: { projectId: id }, _sum: { costSpentUsd: true } });
    const conversa = await this.prisma.conversationMessage.aggregate({ where: { conversation: { projectId: id } }, _sum: { costUsd: true } });
    return { ...p, custoGastoUsd: Number(agg._sum.costSpentUsd ?? 0) + Number(conversa._sum.costUsd ?? 0) };
  }

  async files(id: string) {
    const p = await this.assertExists(id);
    return { pasta: p.workspacePath, arquivos: await this.workspace.listMainFiles(p.dirKey) };
  }

  async fileContent(id: string, file: string) {
    const p = await this.assertExists(id);
    const c = file ? await this.workspace.readMainFile(p.dirKey, String(file)) : null;
    if (!c) throw new NotFoundException('Arquivo não encontrado na pasta principal do projeto');
    return c;
  }

  async assertExists(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    return p;
  }
}
