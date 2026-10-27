import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Artifact } from '@prisma/client';
import { appConfig } from '../config';
import { sha256, sha256File } from '../common/hash';
import { resolveInside } from '../common/path-guard';
import { PrismaService } from '../prisma/prisma.service';

export interface ArtifactMeta {
  projectId: string;
  jobId?: string | null;
  stepId?: string | null;
  attemptId?: string | null;
  name: string;
  kind: string;
  mimeType?: string;
}

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.py': 'text/x-python',
  '.png': 'image/png',
  '.html': 'text/html',
};

/** Armazenamento de artefatos endereçado por conteúdo, separado por projeto. */
@Injectable()
export class ArtifactStoreService {
  constructor(private readonly prisma: PrismaService) {}

  private target(projectId: string, hash: string): { abs: string; rel: string } {
    const rel = path.join(projectId, hash.slice(0, 2), hash);
    const abs = resolveInside(appConfig().artifactsRoot, rel);
    return { abs, rel };
  }

  async storeContent(meta: ArtifactMeta, content: string | Buffer): Promise<Artifact> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const hash = sha256(buf);
    const { abs, rel } = this.target(meta.projectId, hash);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
    }
    return this.prisma.artifact.create({
      data: {
        projectId: meta.projectId,
        jobId: meta.jobId ?? null,
        stepId: meta.stepId ?? null,
        attemptId: meta.attemptId ?? null,
        name: meta.name,
        kind: meta.kind,
        storagePath: rel,
        sha256: hash,
        sizeBytes: buf.length,
        mimeType: meta.mimeType ?? MIME[path.extname(meta.name)] ?? 'application/octet-stream',
      },
    });
  }

  async storeFile(meta: ArtifactMeta, file: string): Promise<Artifact> {
    const hash = await sha256File(file);
    const { abs, rel } = this.target(meta.projectId, hash);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(file, abs);
    }
    const size = fs.statSync(file).size;
    return this.prisma.artifact.create({
      data: {
        projectId: meta.projectId,
        jobId: meta.jobId ?? null,
        stepId: meta.stepId ?? null,
        attemptId: meta.attemptId ?? null,
        name: meta.name,
        kind: meta.kind,
        storagePath: rel,
        sha256: hash,
        sizeBytes: size,
        mimeType: meta.mimeType ?? MIME[path.extname(meta.name)] ?? 'application/octet-stream',
      },
    });
  }

  /**
   * Registra como artefatos os arquivos novos/alterados em outDir (relativos a ele).
   * Arquivos idênticos (mesmo nome e sha256 já registrados no job) não são duplicados.
   */
  async collectOutputs(meta: Omit<ArtifactMeta, 'name' | 'kind'>, outDir: string): Promise<Artifact[]> {
    if (!fs.existsSync(outDir)) return [];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue; // nunca segue links para fora do workspace
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) files.push(p);
      }
    };
    walk(outDir);
    const created: Artifact[] = [];
    for (const f of files.sort()) {
      const name = path.relative(outDir, f).split(path.sep).join('/');
      const hash = await sha256File(f);
      const existing = await this.prisma.artifact.findFirst({
        where: { projectId: meta.projectId, jobId: meta.jobId ?? null, name, sha256: hash },
      });
      if (existing) continue;
      const kind = name === 'metrics.json' || name.endsWith('.metrics.json') ? 'METRICS' : 'FILE';
      created.push(await this.storeFile({ ...meta, name, kind }, f));
    }
    return created;
  }

  async read(projectId: string, artifactId: string): Promise<{ artifact: Artifact; content: Buffer }> {
    const artifact = await this.prisma.artifact.findFirst({ where: { id: artifactId, projectId } });
    if (!artifact) throw new NotFoundException('Artefato não encontrado neste projeto');
    const abs = resolveInside(appConfig().artifactsRoot, artifact.storagePath);
    return { artifact, content: fs.readFileSync(abs) };
  }
}
