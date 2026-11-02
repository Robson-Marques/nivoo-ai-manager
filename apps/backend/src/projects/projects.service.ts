import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { optString, reqString, slugify } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async create(body: any) {
    const name = reqString(body, 'name', 200);
    const slug = slugify(optString(body, 'slug', 60) ?? name);
    if (!slug) throw new ConflictException('Nome inválido para slug');
    if (await this.prisma.project.findUnique({ where: { slug } })) throw new ConflictException(`Projeto ${slug} já existe`);
    const dirs = await this.workspace.ensureProject(slug);
    const description = optString(body, 'description', 20000) ?? '';
    const project = await this.prisma.project.create({ data: { name, slug, description, workspacePath: dirs.root } });
    if (description) {
      await this.prisma.memoryEntry.create({
        data: { projectId: project.id, category: 'ESPECIFICACAO', title: 'Especificação inicial', content: description, author: optString(body, 'author', 100) ?? 'operador' },
      });
    }
    return project;
  }

  list() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { researches: true, jobs: true, datasets: true } } },
    });
  }

  async get(id: string) {
    const p = await this.prisma.project.findUnique({
      where: { id },
      include: {
        researches: { orderBy: { createdAt: 'desc' }, include: { assets: { include: { asset: true } }, _count: { select: { hypotheses: true, experiments: true, jobs: true } } } },
        datasets: { orderBy: { createdAt: 'desc' }, include: { asset: { select: { code: true } } } },
        _count: { select: { jobs: true, memory: true, artifacts: true } },
      },
    });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    const agg = await this.prisma.job.aggregate({ where: { projectId: id }, _sum: { costSpentUsd: true } });
    return { ...p, custoGastoUsd: agg._sum.costSpentUsd ?? 0 };
  }

  async assertExists(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Projeto não encontrado');
    return p;
  }
}
