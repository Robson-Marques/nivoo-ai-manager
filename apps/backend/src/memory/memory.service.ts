import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MemoryCategory, Prisma } from '@prisma/client';
import { oneOf, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';

export const MEMORY_CATEGORIES = [
  'ESPECIFICACAO',
  'ARQUITETURA_RESTRICOES',
  'DECISAO_APROVADA',
  'HIPOTESE_INVESTIGACAO',
  'EVIDENCIA',
  'HIPOTESE_REJEITADA',
  'RESULTADO_VALIDADO',
  'PENDENCIA',
] as const;

/** Categorias que exigem referências reproduzíveis (dados, código, parâmetros, resultados). */
const NEEDS_REFERENCES: MemoryCategory[] = ['EVIDENCIA', 'RESULTADO_VALIDADO'];

export interface MemoryRefs {
  artifactIds?: string[];
  experimentIds?: string[];
  datasetIds?: string[];
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

  async validateRefs(projectId: string, category: MemoryCategory, refs: MemoryRefs): Promise<void> {
    const artifactIds = refs.artifactIds ?? [];
    const experimentIds = refs.experimentIds ?? [];
    const datasetIds = refs.datasetIds ?? [];
    if (artifactIds.length) {
      const n = await this.prisma.artifact.count({ where: { id: { in: artifactIds }, projectId } });
      if (n !== artifactIds.length) throw new BadRequestException('Artefato referenciado inexistente ou de outro projeto');
    }
    if (experimentIds.length) {
      const n = await this.prisma.experiment.count({ where: { id: { in: experimentIds }, projectId } });
      if (n !== experimentIds.length) throw new BadRequestException('Experimento referenciado inexistente ou de outro projeto');
    }
    if (datasetIds.length) {
      const n = await this.prisma.dataset.count({ where: { id: { in: datasetIds }, projectId } });
      if (n !== datasetIds.length) throw new BadRequestException('Dataset referenciado inexistente ou de outro projeto');
    }
    if (NEEDS_REFERENCES.includes(category)) {
      const missing: string[] = [];
      if (!artifactIds.length) missing.push('artifactIds (resultados com sha256)');
      if (!experimentIds.length && !datasetIds.length) missing.push('experimentIds ou datasetIds (dados)');
      if (!refs.gitCommit && !experimentIds.length) missing.push('gitCommit (código) ou experimento com commit');
      if (!refs.parameters && !experimentIds.length) missing.push('parameters ou experimento com parâmetros');
      if (missing.length) {
        throw new BadRequestException(`${category} exige referências reproduzíveis. Faltando: ${missing.join('; ')}`);
      }
      if (category === 'RESULTADO_VALIDADO' && experimentIds.length) {
        const done = await this.prisma.experiment.count({ where: { id: { in: experimentIds }, status: 'CONCLUIDO', codeRef: { not: null } } });
        if (done !== experimentIds.length) throw new BadRequestException('RESULTADO_VALIDADO exige experimentos CONCLUIDOS (verificados) com commit registrado');
      }
    }
  }

  async create(projectId: string, body: any) {
    const category = oneOf(body, 'category', MEMORY_CATEGORIES) as MemoryCategory;
    const refs = (body.references ?? {}) as MemoryRefs;
    await this.validateRefs(projectId, category, refs);
    const researchId = optString(body, 'researchId', 60);
    if (researchId && !(await this.prisma.research.findFirst({ where: { id: researchId, projectId } }))) {
      throw new BadRequestException('Pesquisa não pertence ao projeto');
    }
    return this.prisma.memoryEntry.create({
      data: {
        projectId,
        researchId,
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
        data: { projectId, researchId: m.researchId, category: m.category, title: `[esquecido] ${m.title}`, content: `Esquecido por ${by}.`, references: { esquecido: m.id }, version: m.version + 1, author: by, supersededById: m.id },
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
          researchId: old.researchId,
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
