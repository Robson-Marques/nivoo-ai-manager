/**
 * Apoio aos testes de integração REAL (Claude Code CLI / Codex CLI).
 * Nada aqui simula provedores: os jobs rodam em processos worker reais que chamam os CLIs oficiais.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { appConfig } from '../../src/config';
import { Harness } from './harness';

export const REAL = process.env.NIVOO_RUN_CLI_INTEGRATION === '1';

export async function requireProvider(h: Harness, id: string): Promise<void> {
  const s = (await h.http().post(`/api/providers/${id}/check`).expect(201)).body;
  if (!s.available) {
    throw new Error(`BLOQUEIO: ${id} indisponível neste host — ${s.errors.join('; ')}. Veja docs/ESTADO.md (procedimento).`);
  }
}

export function readArtifact(projectId: string, storagePath: string): string {
  return fs.readFileSync(path.join(appConfig().artifactsRoot, storagePath), 'utf8');
}

/** Exporta as evidências do job (do banco) para docs/evidencias quando NIVOO_EVIDENCE_DIR estiver definido. */
export async function exportEvidence(h: Harness, jobId: string, name: string, extra: Record<string, unknown> = {}) {
  const job = await h.prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      objectives: true,
      steps: { orderBy: { order: 'asc' } },
      attempts: { orderBy: { startedAt: 'asc' } },
      criteria: { include: { checks: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      artifacts: { orderBy: { createdAt: 'asc' } },
      checkpoints: { orderBy: { seq: 'asc' } },
    },
  });
  const memory = await h.prisma.memoryEntry.findMany({ where: { projectId: job.projectId }, orderBy: { createdAt: 'asc' } });
  const objective = job.objectives[0];
  const prompts = job.artifacts.filter((a) => a.kind === 'PROMPT');
  const bundle = {
    geradoEm: new Date().toISOString(),
    teste: name,
    job: { id: job.id, titulo: job.title, status: job.status, motivo: job.blockedReason, detalhe: job.statusDetail, custoUsd: Number(job.costSpentUsd), tempoAtivoSeg: job.activeSeconds },
    objetivo: job.objectives.map((o) => ({ versao: o.version, sha256: o.sha256, texto: o.text })),
    etapas: job.steps.map((s) => ({ key: s.key, provider: s.provider ?? job.defaultProvider, status: s.status, detalhe: s.statusDetail, opcoes: s.providerOptions })),
    sessoes: job.attempts.map((a) => ({
      etapa: job.steps.find((s) => s.id === a.stepId)?.key,
      numero: a.number,
      conector: a.provider,
      worker: a.workerId,
      status: a.status,
      sessionId: a.sessionId,
      termino: a.stopReason,
      turnos: a.numTurns,
      custoUsd: Number(a.costUsd),
      notasImportadas: a.notesIngested,
      progresso: a.treeBefore !== a.treeAfter,
      erro: a.error?.slice(0, 500) ?? null,
      inicio: a.startedAt,
      fim: a.endedAt,
    })),
    prompts: prompts.map((p) => {
      const text = readArtifact(job.projectId, p.storagePath);
      return {
        nome: p.name,
        sha256: p.sha256,
        bytes: p.sizeBytes,
        contemObjetivoV1Integro: text.includes(objective.text) && text.includes(objective.sha256),
        contemNotasDoAgente: /autor agente:/.test(text),
      };
    }),
    criterios: job.criteria.map((c) => ({ key: c.key, kind: c.kind, status: c.status, evidencia: c.checks[0]?.evidence ?? null })),
    artefatos: job.artifacts.filter((a) => a.kind !== 'PROMPT').map((a) => ({ nome: a.name, tipo: a.kind, sha256: a.sha256, bytes: a.sizeBytes })),
    checkpoints: job.checkpoints.map((c) => ({ seq: c.seq, rotulo: c.label, commit: c.gitCommit })),
    memoria: memory.map((m) => ({ categoria: m.category, titulo: m.title, autor: m.author, conteudo: m.content.slice(0, 400), referencias: m.references })),
    ...extra,
  };
  const dir = process.env.NIVOO_EVIDENCE_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(bundle, null, 2));
  }
  return bundle;
}

export function sha(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

export const SINTETICO = path.join(__dirname, 'sintetico');
