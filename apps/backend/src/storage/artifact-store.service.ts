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

  /**
   * Resultados de trabalhos (o que a IA gravou em out/: relatórios, inventários, planos), a versão mais recente de
   * cada arquivo. Ficam fora do repositório do projeto, mas são o resultado que o usuário pediu.
   */
  async resultadosDosTrabalhos(projectId: string, jobIds: string[]): Promise<Artifact[]> {
    if (!jobIds.length) return [];
    const todos = await this.prisma.artifact.findMany({
      where: { projectId, jobId: { in: jobIds }, kind: { in: ['FILE', 'METRICS', 'REPORT'] } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const vistos = new Set<string>();
    return todos.filter((a) => {
      const k = `${a.jobId}/${a.name}`;
      if (a.name.startsWith('prompts/') || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  /** Copia os resultados para <destino>/<id curto do trabalho>/<nome> (limite total), para a IA ler. Devolve os caminhos relativos a <destino>. */
  async copiarResultados(projectId: string, jobIds: string[], destino: string, limiteBytes = 40 * 1024 * 1024): Promise<string[]> {
    const copiados: string[] = [];
    let total = 0;
    fs.mkdirSync(destino, { recursive: true }); // resolveInside confere o caminho real: o destino precisa existir
    for (const a of await this.resultadosDosTrabalhos(projectId, jobIds)) {
      if (total + a.sizeBytes > limiteBytes) continue;
      try {
        const alvo = resolveInside(destino, path.join(String(a.jobId).slice(0, 8), a.name));
        fs.mkdirSync(path.dirname(alvo), { recursive: true });
        fs.copyFileSync(resolveInside(appConfig().artifactsRoot, a.storagePath), alvo);
        total += a.sizeBytes;
        copiados.push(path.relative(destino, alvo));
      } catch {
        /* arquivo de resultado ausente: segue com os outros */
      }
    }
    return copiados;
  }

  /**
   * Resultados de um trabalho concluído na pasta DEFINITIVA do projeto: <projeto>/resultados/<data>-<trabalho>-<id>/.
   * Idempotente (não duplica se a pasta do trabalho já existe). Some só quando o projeto é excluído.
   */
  async guardarNaPastaDoProjeto(projetoRoot: string, job: { id: string; projectId: string; title: string; finishedAt?: Date | null }): Promise<string | null> {
    const base = path.join(projetoRoot, 'resultados');
    const curto = job.id.slice(0, 8);
    if (fs.existsSync(base) && fs.readdirSync(base).some((d) => d.endsWith(`-${curto}`))) return null;
    const slug = (job.title || 'trabalho').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'trabalho';
    const nome = `${(job.finishedAt ?? new Date()).toISOString().slice(0, 10)}-${slug}-${curto}`;
    const tmp = path.join(base, `.${nome}.tmp`);
    fs.rmSync(tmp, { recursive: true, force: true });
    const copiados = await this.copiarResultados(job.projectId, [job.id], tmp);
    if (!copiados.length) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return null;
    }
    fs.renameSync(path.join(tmp, curto), path.join(base, nome));
    fs.rmSync(tmp, { recursive: true, force: true });
    return `resultados/${nome}`;
  }
}
