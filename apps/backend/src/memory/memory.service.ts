import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MemoryCategory, Prisma } from '@prisma/client';
import { oneOf, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';

export const MEMORY_CATEGORIES = [
  'ESPECIFICACAO',
  'ARQUITETURA_RESTRICOES',
  'DECISAO_APROVADA',
  'EVIDENCIA',
  'PENDENCIA',
] as const;


export interface MemoryRefs {
  artifactIds?: string[];
  gitCommit?: string;
  parameters?: Record<string, unknown>;
  jobId?: string;
}

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(projectId: string, category?: string, includeSuperseded = false) {
    return this.prisma.memoryEntry.findMany({
      where: { projectId, ...(category ? { category: category as MemoryCategory } : {}), ...(includeSuperseded ? {} : { supersededById: null }) },
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** Evidência precisa apontar para algo verificável: artefatos (sha256) e o commit que os produziu. */
  async validateRefs(projectId: string, category: MemoryCategory, refs: MemoryRefs): Promise<void> {
    const artifactIds = refs.artifactIds ?? [];
    if (artifactIds.length) {
      const n = await this.prisma.artifact.count({ where: { id: { in: artifactIds }, projectId } });
      if (n !== artifactIds.length) throw new BadRequestException('Artefato referenciado inexistente ou de outro projeto');
    }
    if (category === 'EVIDENCIA') {
      const missing: string[] = [];
      if (!artifactIds.length) missing.push('artifactIds (resultados com sha256)');
      if (!refs.gitCommit) missing.push('gitCommit');
      if (missing.length) throw new BadRequestException(`EVIDENCIA exige referências verificáveis. Faltando: ${missing.join('; ')}`);
    }
  }

  async create(projectId: string, body: any) {
    const category = oneOf(body, 'category', MEMORY_CATEGORIES) as MemoryCategory;
    const refs = (body.references ?? {}) as MemoryRefs;
    await this.validateRefs(projectId, category, refs);
    return this.prisma.memoryEntry.create({
      data: {
        projectId,
        category,
        title: reqString(body, 'title', 300),
        content: reqString(body, 'content', 50000),
        references: refs as Prisma.InputJsonValue,
        author: optString(body, 'author', 100) ?? 'operador',
      },
    });
  }

  /** "Esquecer": a entrada sai da memória vigente (não entra mais em conversas e trabalhos), mas fica no histórico. */
  async forget(projectId: string, id: string, by = 'usuario') {
    const m = await this.prisma.memoryEntry.findFirst({ where: { id, projectId } });
    if (!m) throw new NotFoundException('Entrada de memória não encontrada');
    if (m.supersededById) return m;
    return this.prisma.$transaction(async (tx) => {
      const marca = await tx.memoryEntry.create({
        data: { projectId, category: m.category, title: `[esquecido] ${m.title}`, content: `Esquecido por ${by}.`, references: { esquecido: m.id }, version: m.version + 1, author: by, supersededById: m.id },
      });
      await tx.memoryEntry.update({ where: { id: m.id }, data: { supersededById: marca.id } });
      return marca;
    });
  }

  /** Nova versão de uma entrada; a anterior permanece consultável (supersededById). */
  async supersede(projectId: string, id: string, body: any) {
    const old = await this.prisma.memoryEntry.findFirst({ where: { id, projectId } });
    if (!old) throw new NotFoundException('Entrada de memória não encontrada');
    if (old.supersededById) throw new BadRequestException('Entrada já substituída');
    const refs = (body.references ?? old.references ?? {}) as MemoryRefs;
    await this.validateRefs(projectId, old.category, refs);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.memoryEntry.create({
        data: {
          projectId,
          category: old.category,
          title: optString(body, 'title', 300) ?? old.title,
          content: reqString(body, 'content', 50000),
          references: refs as Prisma.InputJsonValue,
          version: old.version + 1,
          author: optString(body, 'author', 100) ?? 'operador',
        },
      });
      await tx.memoryEntry.update({ where: { id: old.id }, data: { supersededById: created.id } });
      return created;
    });
  }
}
